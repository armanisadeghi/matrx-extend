/**
 * The sealed private lane: POST-only lifecycle envelopes for the local-browser
 * bridge. No retries, no 401 refresh, no logs, no redirects, no reflected
 * bodies — it is deliberately NOT a `runOp` call. Headers come from the same
 * injector (`buildHeaders` in client.ts) bound to the pinned actor.
 */

import { getApiBaseUrl, buildHeaders } from '@/lib/api/client';
import { getAccessToken, getVerifiedCurrentUser } from '@/lib/auth/flow';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { sendMatrxRequest } from '@ai-matrx/api';
import type { z } from 'zod';

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

function bearerFromHeaders(headers: Record<string, string>): string | null {
  const authorization = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1];
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length);
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
      // The package sender passes `redirect`/`cache` straight through: this lane is sealed.
      sendMatrxRequest(`${baseUrl}${opts.path}`, {
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
  // Every exit before the body is read cancels it: a deadline or identity
  // change between headers and body must not leave the stream open.
  let bodyHandled = false;
  try {
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
    bodyHandled = true;
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
  } finally {
    if (!bodyHandled) void response.body?.cancel().catch(() => {});
  }
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

