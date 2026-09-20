/**
 * REST client. Adds bearer token, handles 401 → refresh → retry once.
 * Streaming lives in src/lib/api/stream.ts (offscreen-buffered for >30s safety).
 *
 * Backend URL resolution is centralized in src/config/backend.ts. This module
 * never reads chrome.storage directly and never knows about env vars.
 */

import { getBackendUrl } from '@/config/backend';
import {
  describeStoredSession,
  getAccessToken,
  getCurrentUser,
  getStoredAccessToken,
  getVerifiedCurrentUser,
  refreshAccessToken,
} from '@/lib/auth/flow';
import { getOrCreateGuestSignature } from '@/lib/auth/guest-signature';
import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  OrganizationNotSelectedError,
  getActiveOrganizationId,
  holdForActiveOrganizationId,
  isOrganizationNoMembershipsError,
  isOrganizationNotSelectedError,
} from '@/lib/org/active-org';
import { applyOrganizationContextHeader } from '@ai-matrx/agents/matrx';
import type { z } from 'zod';

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: string; status: number };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * Status sentinel for "the server replied 2xx but the body failed local
 * validation / parsing". Distinct from 0 (network-down) — callers branching
 * on `status === 0` to say "check your connection" were misdiagnosing server
 * shape bugs as the user's wifi (audit P2-22).
 */
export const STATUS_INVALID_BODY = -1;

/**
 * Status sentinel for "this request was never sent, because no organization
 * is selected". Every authenticated request to the platform carries BOTH the
 * user and the organization it acts in; the server's AuthMiddleware refuses
 * one without an organization, so sending it anyway would burn a round-trip
 * to earn a 400 the user cannot interpret. We refuse before I/O and hand the
 * UI a remedy instead (law 4: nothing fails silently).
 */
export const STATUS_NO_ORGANIZATION = -2;

export type PrivateRequestError =
  | 'deadline_exceeded'
  | 'identity_changed'
  | 'network_error'
  | 'http_error'
  | 'response_too_large'
  | 'invalid_response';
export type PrivateApiResult<T> = { ok: true; data: T } | { ok: false; error: PrivateRequestError };
export interface PrivateExpectedActor {
  userId: string;
  organizationId: string;
  sessionId: string;
}
export interface PrivatePostOptions<T> {
  path: string;
  body: unknown;
  expectedActor: PrivateExpectedActor;
  deadlineMs: number;
  schema: z.ZodType<T>;
  /** Synchronous owned-executor/policy generation fence; never an authorization substitute. */
  isCurrent?: () => boolean;
  signal?: AbortSignal;
}
const PRIVATE_RESPONSE_CAP_BYTES = 4 * 1024;
// Local-browser callbacks may wait for a deliberate human approval or desktop
// bridge hop. The original grant deadline remains the hard upper bound.
const PRIVATE_MAX_REQUEST_MS = 30_000;
const PRIVATE_JSON_MAX_DEPTH = 8;
const PRIVATE_PATHS = new Set([
  '/browser-manager/local/verify',
  '/browser-manager/local/transport/verify',
  '/browser-manager/local/ack',
  '/browser-manager/local/approval',
  '/browser-manager/local/commands/claim',
  '/browser-manager/local/commands/complete',
]);
const PRIVATE_CLAIM_RESPONSE_CAP_BYTES = 48 * 1024;
const PRIVATE_REQUEST_CAP_BYTES = 32 * 1024;

/**
 * Status sentinel for "this request was never sent, because a signed-in
 * session has no readable bearer yet". 🚨 THE GUEST-DOWNGRADE DEFECT
 * (2026-09-19): a fresh install signed in, the side panel mounted its chat
 * surfaces, and the FIRST calls (`/mandates/extend.browser_chat/resolution`,
 * `/api/compute-targets/`) went out a beat before the bearer was readable.
 * `buildHeaders` silently fell back to the GUEST fingerprint, the server
 * correctly answered 401, and the agent picker showed "the server refused to
 * resolve it" for the whole session. A signed-in surface never speaks as a
 * guest: when the stored profile says signed in and no bearer can be read,
 * the request waits briefly for the session to settle and is then REFUSED
 * with this status and a remedy — never downgraded.
 */
export const STATUS_SESSION_NOT_READY = -3;

export class SessionNotReadyError extends Error {
  readonly remedy = 'Wait a moment and try again. If this keeps happening, sign out and back in.';
  constructor() {
    super('You are signed in, but your session is not ready yet, so this request was not sent.');
    this.name = 'SessionNotReadyError';
  }
}

/**
 * How a signed-in request waits for a readable bearer before refusing.
 * `getAccessToken()` is null for a signed-in install ONLY when the stored
 * token is outside its freshness margin AND the refresh call returned nothing
 * (no refresh material, or a non-terminal refresh failure such as a 5xx or a
 * rate limit — a terminal 400/401 signs the install out and removes the
 * profile). Each re-ask below is therefore a real refresh attempt against
 * Supabase, so they are FEW and SPACED, never a tight poll. Internal timing,
 * not a knob.
 */
const SESSION_REASK_ATTEMPTS = 2;
const SESSION_REASK_SPACING_MS = 1_000;

/**
 * The bearer for this request, or `null` ONLY when nobody is signed in on this
 * install. When a profile is stored (signed in) but no bearer is readable,
 * re-ask a bounded number of times; if it never comes, log WHY (facts, never
 * the token) and throw `SessionNotReadyError`.
 */
export async function readSessionBearer(): Promise<string | null> {
  const first = await getAccessToken();
  if (first) return first;
  const profile = await getCurrentUser();
  if (!profile) return null;
  for (let attempt = 0; attempt < SESSION_REASK_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SESSION_REASK_SPACING_MS));
    const token = await getAccessToken();
    if (token) return token;
    if (!(await getCurrentUser())) return null; // signed out while waiting (terminal refresh failure)
  }
  const failure = new SessionNotReadyError();
  log.error('api', 'signed in, but no bearer became readable — refusing to send as a guest', {
    userId: profile.id,
    session: await describeStoredSession(),
    remedy: failure.remedy,
  });
  throw failure;
}

/**
 * The only paths an authenticated caller may reach without an organization —
 * liveness, and the sign-in/identity surface a client uses BEFORE it can know
 * its organization. Deliberately tiny: every addition here is a hole in the
 * contract, so a new entry needs a reason that survives being read aloud.
 */
const ORG_EXEMPT_PATH_PREFIXES = ['/health', '/auth/'] as const;

function isOrgExemptPath(path: string): boolean {
  return ORG_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * The organization-context header NAME, derived from the package kernel that
 * writes it rather than typed a second time here. `rawRequest` reads the
 * header back to decide whether the request may be sent at all, and two
 * independent spellings of one header is exactly how a rename turns a
 * fail-closed check into a silent fail-open. Pinned by `ai-protocol.test.ts`.
 *
 * The probe id is a real UUID because the kernel VALIDATES what it binds.
 */
export const ORGANIZATION_CONTEXT_HEADER = Object.keys(
  applyOrganizationContextHeader({}, '00000000-0000-4000-8000-000000000000'),
)[0] as string;

function bearerFromHeaders(headers: Record<string, string>): string | null {
  const authorization = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1];
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length);
}

/**
 * Default per-request deadline. NO call site passed an AbortSignal before
 * 2026-06-10, so a stalled (not failed) connection hung postToolResults,
 * the chat-send compute-target resolve, the turn-boundary inbox, and file
 * uploads forever (audit P1-2). Callers with longer legitimate work pass
 * their own signal.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export async function getApiBaseUrl(): Promise<string> {
  return getBackendUrl();
}

/**
 * Compatibility shim — backend.ts already invalidates its cache via
 * chrome.storage.onChanged whenever the env or override changes, so callers
 * no longer need to manually flush. Retained as a no-op for any leftover
 * imports.
 */
export function clearApiBaseCache(): void {
  /* no-op: backend.ts owns invalidation via chrome.storage.onChanged */
}

/**
 * THE ONE header path for every authenticated backend call this extension
 * makes. Exported because `@ai-matrx/agents/catalog` needs a `transport` port
 * to resolve a Mandate's default row through `GET /mandates/{key}/resolution`,
 * and a second spelling of the auth/organization headers is exactly how one
 * caller quietly stops carrying an organization (see the note below).
 */
export async function buildHeaders(
  extra: Record<string, string> = {},
  bound?: { token: string | null; organizationId: string | null },
): Promise<Record<string, string>> {
  const token = bound?.token ?? (await readSessionBearer());
  // Authorization context belongs to this transport. HTTP header names are
  // case-insensitive, so filtering only the canonical spellings would let a
  // caller make fetch use a different bearer/org than the one we verified.
  const safeExtra = Object.fromEntries(
    Object.entries(extra).filter(([name]) => {
      const normalized = name.toLowerCase();
      return ![
        'authorization',
        ORGANIZATION_CONTEXT_HEADER.toLowerCase(),
        'x-fingerprint-id',
      ].includes(normalized);
    }),
  );
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...safeExtra,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    // Identity and organization travel together on EVERY request. Resolved
    // per request (never cached into a token) so switching organizations
    // takes effect on the next call instead of the next sign-in.
    //
    // The HEADER ITSELF is the package's (`applyOrganizationContextHeader`,
    // @ai-matrx/agents 0.6.0 — the org-context kernel moved in under C22).
    // The header name is not this client's to spell: one repo typing
    // 'X-Organization-Id' by hand is how a rename becomes a silent
    // fail-open. WHAT this client still owns is the POLICY of when an
    // organization is required — see the exempt-path refusal in rawRequest,
    // which is extension-shaped (guest-fingerprint identity, an ApiResult
    // sentinel and a plain-language remedy rather than a thrown error).
    //
    // The kernel is FAIL-CLOSED: it validates the id and throws
    // `OrganizationContextError` on a malformed one rather than binding it. A
    // corrupt stored org id used to be sent anyway and earned an opaque server
    // 400; now the header is simply not bound, and rawRequest's existing
    // no-organization refusal below turns that into a plain-language remedy.
    // The throw is caught HERE and never escapes: an exception out of
    // rawRequest breaks the ApiResult contract and wedges callers (audit P1-3).
    const organizationId = bound?.organizationId ?? (await getActiveOrganizationId());
    if (organizationId) {
      try {
        headers = applyOrganizationContextHeader(headers, organizationId);
      } catch (err) {
        log.error(
          'api',
          'stored organization id is malformed — refusing to bind it; the request will be refused with a remedy',
          err,
        );
      }
    }
  } else {
    // Nobody is signed in on this install (readSessionBearer refuses, rather
    // than returning null, for a signed-in session without a bearer) — fall
    // back to the guest fingerprint so the server's AuthMiddleware can resolve
    // us to a stable anonymous auth.users row.
    const sig = await getOrCreateGuestSignature();
    headers['X-Fingerprint-ID'] = sig;
  }
  return headers;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retryOn401?: boolean;
  /** Suppress the per-request error log line. Caller still gets the structured ApiResult. */
  silent?: boolean;
  /** Fail closed unless the actual bearer subject and canonical org still match. */
  expectedActor?: { userId: string; organizationId: string };
}

export interface ApiRequestOptions {
  silent?: boolean;
  expectedActor?: { userId: string; organizationId: string };
  headers?: Record<string, string>;
}

async function buildExpectedActorHeaders(
  expectedActor: NonNullable<RequestOptions['expectedActor']>,
  extra: Record<string, string> | undefined,
): Promise<Record<string, string> | null> {
  // A token/org can change while /auth/v1/user verifies the bearer. Retry once
  // from a fresh snapshot, then fail closed rather than dispatching as a new
  // identity or organization.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await readSessionBearer(); // same session rule; SessionNotReadyError surfaces as STATUS_SESSION_NOT_READY
    if (!token) return null;
    const verified = await getVerifiedCurrentUser(token);
    const [tokenAfterVerification, orgAfterVerification] = await Promise.all([
      getAccessToken(),
      getActiveOrganizationId(),
    ]);
    if (tokenAfterVerification !== token) continue;
    if (
      verified?.id !== expectedActor.userId ||
      orgAfterVerification !== expectedActor.organizationId
    )
      return null;
    // Immediately before fetch, confirm neither half of the authority pair
    // changed after the slow verified-user read.
    const [tokenAtDispatch, orgAtDispatch] = await Promise.all([
      getAccessToken(),
      getActiveOrganizationId(),
    ]);
    if (tokenAtDispatch !== token || orgAtDispatch !== orgAfterVerification) continue;
    return buildHeaders(extra, { token, organizationId: orgAtDispatch });
  }
  return null;
}

function privateFailure(error: PrivateRequestError): PrivateApiResult<never> {
  return { ok: false, error };
}

async function withPrivateAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let refuse = (): void => {};
  const aborted = new Promise<never>((_, reject) => {
    refuse = () => reject(new Error());
    if (signal.aborted) refuse();
    else signal.addEventListener('abort', refuse, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', refuse);
  }
}

/** Current verified identity for private consumers; never returns a bearer. */
export async function getPrivateExpectedActor(
  deadlineMs = Date.now() + PRIVATE_MAX_REQUEST_MS,
): Promise<PrivateApiResult<PrivateExpectedActor>> {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= Date.now())
    return privateFailure('deadline_exceeded');
  const deadline = Math.min(deadlineMs, Date.now() + PRIVATE_MAX_REQUEST_MS);
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  try {
    const [token, organizationId] = await withPrivateAbort(
      Promise.all([getAccessToken(), getActiveOrganizationId()]),
      signal,
    );
    if (!token || !organizationId) return privateFailure('identity_changed');
    const sessionId = sessionIdFromBearer(token);
    if (!sessionId) return privateFailure('identity_changed');
    const user = await withPrivateAbort(getVerifiedCurrentUser(token), signal);
    if (!user?.id) return privateFailure('identity_changed');
    const expected = { userId: user.id, organizationId, sessionId };
    if (!(await withPrivateAbort(privateIdentityMatches(expected, token), signal)))
      return privateFailure('identity_changed');
    if (signal.aborted || Date.now() >= deadline) return privateFailure('deadline_exceeded');
    return { ok: true, data: expected };
  } catch {
    return privateFailure(signal.aborted ? 'deadline_exceeded' : 'identity_changed');
  }
}

function sessionIdFromBearer(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const parsed: unknown = JSON.parse(decoded);
    const sessionId =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).session_id
        : null;
    return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}

async function privateIdentityMatches(
  expected: PrivateExpectedActor,
  token: string,
): Promise<boolean> {
  const [currentToken, organizationId] = await Promise.all([
    getAccessToken(),
    getActiveOrganizationId(),
  ]);
  return (
    currentToken === token &&
    organizationId === expected.organizationId &&
    sessionIdFromBearer(currentToken ?? '') === expected.sessionId
  );
}

async function buildPrivateHeaders(
  expected: PrivateExpectedActor,
): Promise<Record<string, string> | null> {
  const token = await getAccessToken();
  if (!token || sessionIdFromBearer(token) !== expected.sessionId) return null;
  const user = await getVerifiedCurrentUser(token);
  if (user?.id !== expected.userId || !(await privateIdentityMatches(expected, token))) return null;
  const headers = await buildHeaders({}, { token, organizationId: expected.organizationId });
  return (await privateIdentityMatches(expected, token)) ? headers : null;
}

function invalidUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/** Closed JSON parser: rejects duplicate keys, invalid Unicode, excessive depth, and nonfinite numbers. */
export function parseStrictPrivateJson(source: string): unknown | null {
  let p = 0;
  const invalid = Symbol('invalid');
  const ws = (): void => {
    while (/[ \n\r\t]/.test(source[p] ?? '')) p++;
  };
  const string = (): string | null => {
    if (source[p++] !== '"') return null;
    let out = '';
    while (p < source.length) {
      const c = source[p++];
      if (c === '"') return invalidUnicode(out) ? null : out;
      if (c === '\\') {
        const e = source[p++];
        if (e === '"' || e === '\\' || e === '/') out += e;
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'n') out += '\n';
        else if (e === 'r') out += '\r';
        else if (e === 't') out += '\t';
        else if (e === 'u') {
          const hex = source.slice(p, p + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          out += String.fromCharCode(Number.parseInt(hex, 16));
          p += 4;
        } else return null;
      } else {
        if (c === undefined || c < ' ') return null;
        out += c;
      }
    }
    return null;
  };
  const value = (depth: number): unknown | typeof invalid => {
    if (depth > PRIVATE_JSON_MAX_DEPTH) return invalid;
    ws();
    const start = source[p];
    if (start === '"') {
      const parsed = string();
      return parsed === null ? invalid : parsed;
    }
    if (start === '{') {
      p++;
      ws();
      const out: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (source[p] === '}') {
        p++;
        return out;
      }
      while (p < source.length) {
        ws();
        const key = string();
        if (key === null || keys.has(key)) return invalid;
        keys.add(key);
        ws();
        if (source[p++] !== ':') return invalid;
        const next = value(depth + 1);
        if (next === invalid) return invalid;
        out[key] = next;
        ws();
        const sep = source[p++];
        if (sep === '}') return out;
        if (sep !== ',') return invalid;
      }
      return invalid;
    }
    if (start === '[') {
      p++;
      ws();
      const out: unknown[] = [];
      if (source[p] === ']') {
        p++;
        return out;
      }
      while (p < source.length) {
        const next = value(depth + 1);
        if (next === invalid) return invalid;
        out.push(next);
        ws();
        const sep = source[p++];
        if (sep === ']') return out;
        if (sep !== ',') return invalid;
      }
      return invalid;
    }
    const token = source
      .slice(p)
      .match(/^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) return invalid;
    p += token.length;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    const number = Number(token);
    return Number.isFinite(number) ? number : invalid;
  };
  const out = value(0);
  ws();
  return out === invalid || p !== source.length ? null : out;
}

async function readPrivateResponse(
  response: Response,
  signal: AbortSignal,
  capBytes: number,
): Promise<{ value: string } | { tooLarge: true } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await withPrivateAbort(reader.read(), signal);
      if (item.done) break;
      size += item.value.byteLength;
      if (size > capBytes) {
        return { tooLarge: true };
      }
      chunks.push(item.value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { value: new TextDecoder('utf-8', { fatal: true }).decode(joined) };
  } catch {
    return null;
  } finally {
    // Cancellation is best effort: a stalled underlying cancel must not hold
    // the result past its deadline. The fetch signal also aborts the network.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Sealed POST path for private lifecycle envelopes: no retries, logs, redirects, or reflected bodies. */
export async function privatePost<T>(opts: PrivatePostOptions<T>): Promise<PrivateApiResult<T>> {
  if (
    !PRIVATE_PATHS.has(opts.path) ||
    !Number.isSafeInteger(opts.deadlineMs) ||
    opts.deadlineMs <= Date.now()
  )
    return privateFailure('deadline_exceeded');
  const deadline = Math.min(opts.deadlineMs, Date.now() + PRIVATE_MAX_REQUEST_MS);
  const deadlineSignal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  const timeout = opts.signal ? AbortSignal.any([deadlineSignal, opts.signal]) : deadlineSignal;
  const current = (): boolean => {
    try {
      return !opts.signal?.aborted && (opts.isCurrent?.() ?? true);
    } catch {
      return false;
    }
  };
  if (!current()) return privateFailure('identity_changed');
  let body: string;
  try {
    body = JSON.stringify(opts.body);
    if (
      typeof body !== 'string' ||
      new TextEncoder().encode(body).byteLength > PRIVATE_REQUEST_CAP_BYTES
    )
      return privateFailure('invalid_response');
  } catch {
    return privateFailure('invalid_response');
  }
  const bounded = <R>(work: Promise<R>): Promise<R> => withPrivateAbort(work, timeout);
  let headers: Record<string, string> | null;
  try {
    headers = await bounded(buildPrivateHeaders(opts.expectedActor));
  } catch {
    return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'identity_changed');
  }
  if (!headers) return privateFailure('identity_changed');
  let baseUrl: string;
  try {
    baseUrl = await bounded(getApiBaseUrl());
  } catch {
    return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'network_error');
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) return privateFailure('deadline_exceeded');
  const token = bearerFromHeaders(headers) ?? '';
  try {
    if (!(await bounded(privateIdentityMatches(opts.expectedActor, token))))
      return privateFailure('identity_changed');
  } catch {
    return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'identity_changed');
  }
  if (timeout.aborted || Date.now() >= deadline) return privateFailure('deadline_exceeded');
  if (!current()) return privateFailure('identity_changed');
  let response: Response;
  try {
    response = await bounded(
      fetch(`${baseUrl}${opts.path}`, {
        method: 'POST',
        headers,
        body,
        signal: timeout,
        redirect: 'error',
        cache: 'no-store',
      }),
    );
  } catch {
    return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'network_error');
  }
  try {
    if (!(await bounded(privateIdentityMatches(opts.expectedActor, token))))
      return privateFailure('identity_changed');
  } catch {
    return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'identity_changed');
  }
  if (!hasPrivateNoStore(response.headers.get('cache-control')))
    return privateFailure('invalid_response');
  if (!response.ok) return privateFailure('http_error');
  if (!current()) return privateFailure('identity_changed');
  const capBytes =
    opts.path === '/browser-manager/local/commands/claim'
      ? PRIVATE_CLAIM_RESPONSE_CAP_BYTES
      : PRIVATE_RESPONSE_CAP_BYTES;
  const read = await readPrivateResponse(response, timeout, capBytes);
  if (!read) return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'invalid_response');
  if ('tooLarge' in read) return privateFailure('response_too_large');
  try {
    if (!(await bounded(privateIdentityMatches(opts.expectedActor, token))))
      return privateFailure('identity_changed');
  } catch {
    return privateFailure(timeout.aborted ? 'deadline_exceeded' : 'identity_changed');
  }
  if (timeout.aborted || Date.now() >= deadline) return privateFailure('deadline_exceeded');
  if (!current()) return privateFailure('identity_changed');
  const parsed = parseStrictPrivateJson(read.value);
  const checked = parsed === null ? null : opts.schema.safeParse(parsed);
  return checked?.success ? { ok: true, data: checked.data } : privateFailure('invalid_response');
}

function hasPrivateNoStore(value: string | null): boolean {
  if (value === null) return false;
  let quoted = false;
  let escaped = false;
  let start = 0;
  let found = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === '\\') {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ',') {
      found ||= value.slice(start, index).trim().toLowerCase() === 'no-store';
      start = index + 1;
    }
  }
  return !quoted && !escaped && (found || value.slice(start).trim().toLowerCase() === 'no-store');
}

async function rawRequest<T>(opts: RequestOptions): Promise<ApiResult<T>> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${opts.path}`;
  let headers: Record<string, string> | null;
  try {
    headers = opts.expectedActor
      ? await buildExpectedActorHeaders(opts.expectedActor, opts.headers)
      : await buildHeaders(opts.headers);
  } catch (err) {
    if (err instanceof SessionNotReadyError) {
      return {
        ok: false,
        status: STATUS_SESSION_NOT_READY,
        error: `${err.message} ${err.remedy}`,
      };
    }
    throw err;
  }
  if (!headers) return { ok: false, status: 403, error: 'expected_actor_mismatch' };
  let hasAuth = !!headers.Authorization;
  // THE HOLD. An authenticated request with no organization is not a failure
  // — it is a question nobody has asked yet. Raise the picker, wait for the
  // person to SET one, then rebuild the headers with what they chose and send
  // the SAME request. A guessed or defaulted organization would write their
  // work into the wrong tenant (Arman, 2026-09-19); a bare refusal would
  // train them that the extension is broken.
  //
  // WHY AFTER THE HEADER BUILD, AND NOT ON THE expectedActor PATH.
  // `hasAuth` is only knowable once the headers exist — a guest request must
  // never raise this question. And `buildExpectedActorHeaders` never reaches
  // here without the header: it binds the organization the CALLER already
  // pinned, and returns null (→ 403 expected_actor_mismatch) the moment the
  // live organization stops matching that pin. Holding inside it would mean
  // pausing a request whose whole contract is "fail closed if the actor
  // changed", so that path is untouched: it fails closed exactly as before.
  if (hasAuth && !headers[ORGANIZATION_CONTEXT_HEADER] && !isOrgExemptPath(opts.path)) {
    try {
      const held = await holdForActiveOrganizationId();
      headers = applyOrganizationContextHeader(await buildHeaders(opts.headers), held);
      hasAuth = !!headers.Authorization;
    } catch (err) {
      // NOTHING may escape rawRequest: callers read ApiResult, and an
      // exception here wedges every one of them (audit P1-3). Two throws land
      // here: nobody answered the picker in time, and a chosen id the header
      // kernel refuses as malformed. Both are the same sentence to the
      // person — this request has no organization, here is how to give it one.
      const failure =
        isOrganizationNotSelectedError(err) || isOrganizationNoMembershipsError(err)
          ? err
          : new OrganizationNotSelectedError();
      log.error('api', `✗ ${opts.method} ${opts.path} — no organization was set`, {
        remedy: failure.remedy,
      });
      return {
        ok: false,
        status: STATUS_NO_ORGANIZATION,
        error: `${failure.message} ${failure.remedy}`,
      };
    }
  }
  log.info('api', `→ ${opts.method} ${opts.path}`, { url, auth: hasAuth });
  const start = performance.now();
  // Caller signal + the default deadline. AbortSignal.any (Chrome 116+)
  // combines them; the bare timeout covers the no-signal common case.
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = opts.signal
    ? typeof AbortSignal.any === 'function'
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : opts.signal
    : timeoutSignal;
  const init: RequestInit = {
    method: opts.method,
    headers,
    signal,
  };
  if (opts.body !== undefined && opts.body !== null) {
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (!opts.silent) {
      log.error('api', `✗ ${opts.method} ${opts.path} network error`, err);
    }
    return { ok: false, status: 0, error: (err as Error).message };
  }
  const ms = Math.round(performance.now() - start);
  if (res.status === 401 && opts.retryOn401 !== false) {
    log.warn('api', `← ${opts.path} 401 — refreshing & retrying`);
    // Pass the exact dispatched bearer. refreshAccessToken must not mistake a
    // nominally unexpired, server-rejected token for another context's refresh.
    const refreshed = await refreshAccessToken(bearerFromHeaders(headers) ?? undefined);
    if (refreshed) {
      return rawRequest<T>({ ...opts, retryOn401: false });
    }
  }
  if (!res.ok) {
    // A 401 that SURVIVED the refresh-retry (or arrived with refresh
    // disabled) means the session is genuinely invalid server-side. No
    // caller anywhere reacts to a 401 result (audit P2-23) — broadcast so
    // the UI can drop into the sign-in state instead of failing every
    // request generically while still claiming "signed in".
    if (res.status === 401 && opts.retryOn401 === false) {
      const requestToken = bearerFromHeaders(headers);
      // Do not refresh here: this is an invalidation decision, so it must
      // compare the rejected request's exact bearer with the current stored
      // bearer without rotating tokens or triggering another sign-out path.
      const currentToken = await getStoredAccessToken();
      if (requestToken && requestToken === currentToken) {
        // Shape matches use-auth's listener: user:null flips the UI to the
        // signed-out state (which shows the sign-in affordance).
        broadcast(CHANNELS.AUTH_STATE_CHANGED, {
          user: null,
          isAdmin: false,
          reason: 'unauthorized',
        });
      } else {
        // The rejected request was sent before another context completed a
        // sign-in or refresh. Its 401 cannot invalidate that newer session.
        log.info(
          'api',
          `← ${opts.path} 401 belonged to a superseded bearer; keeping current session`,
        );
      }
    }
    const text = await res.text().catch(() => res.statusText);
    if (!opts.silent) {
      log.error('api', `✗ ${opts.method} ${opts.path} ${res.status} (${ms}ms)`, text);
    }
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  if (res.status === 204) {
    log.success('api', `← ${opts.path} 204 (${ms}ms)`);
    return { ok: true, data: undefined as T };
  }
  // Body reads can reject (truncated stream, dying gateway sending invalid
  // JSON under a 200 + application/json) — before this guard the exception
  // escaped rawRequest entirely, violating the ApiResult contract and
  // leaving tool calls / inbox cards stuck (audit P1-3).
  try {
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('application/json')
      ? ((await res.json()) as T)
      : ((await res.text()) as unknown as T);
    log.success('api', `← ${opts.method} ${opts.path} ${res.status} (${ms}ms)`);
    return { ok: true, data };
  } catch (err) {
    if (!opts.silent) {
      log.error('api', `✗ ${opts.method} ${opts.path} invalid response body (${ms}ms)`, err);
    }
    return {
      ok: false,
      status: STATUS_INVALID_BODY,
      error: `invalid response body: ${(err as Error).message}`,
    };
  }
}

export async function apiGet<T>(
  path: string,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return rawRequest<T>({
    method: 'GET',
    path,
    ...(signal !== undefined ? { signal } : {}),
    ...(opts?.silent !== undefined ? { silent: opts.silent } : {}),
    ...(opts?.expectedActor !== undefined ? { expectedActor: opts.expectedActor } : {}),
    ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
  });
}

/**
 * `opts.silent` suppresses the per-request error log line. Callers still get
 * the structured `ApiResult`. REQUIRED for any endpoint whose response body
 * can hold credential plaintext (`/api/vault/**` reveal + materialize): a
 * 2xx body that fails `JSON.parse` produces an engine error message that
 * quotes the offending body, and that quote would land in the debug log.
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return rawRequest<T>({
    method: 'POST',
    path,
    body,
    ...(signal !== undefined ? { signal } : {}),
    ...(opts?.silent !== undefined ? { silent: opts.silent } : {}),
    ...(opts?.expectedActor !== undefined ? { expectedActor: opts.expectedActor } : {}),
    ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
  });
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return rawRequest<T>({
    method: 'PATCH',
    path,
    body,
    ...(signal !== undefined ? { signal } : {}),
    ...(opts?.silent !== undefined ? { silent: opts.silent } : {}),
    ...(opts?.expectedActor !== undefined ? { expectedActor: opts.expectedActor } : {}),
    ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
  });
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
): Promise<ApiResult<T>> {
  return rawRequest<T>({
    method: 'PUT',
    path,
    body,
    ...(signal !== undefined ? { signal } : {}),
    ...(opts?.silent !== undefined ? { silent: opts.silent } : {}),
    ...(opts?.expectedActor !== undefined ? { expectedActor: opts.expectedActor } : {}),
    ...(opts?.headers !== undefined ? { headers: opts.headers } : {}),
  });
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'DELETE', path, ...(signal !== undefined ? { signal } : {}) });
}

/**
 * Wrap an apiResult with Zod validation. Returns a typed `data` or a parse error.
 */
export function withSchema<T>(result: ApiResult<unknown>, schema: z.ZodType<T>): ApiResult<T> {
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] api response failed schema', parsed.error.format());
    // STATUS_INVALID_BODY, not 0 — a schema failure is a server-shape bug,
    // not the user's network (audit P2-22).
    return { ok: false, status: STATUS_INVALID_BODY, error: 'Schema validation failed' };
  }
  return { ok: true, data: parsed.data };
}
