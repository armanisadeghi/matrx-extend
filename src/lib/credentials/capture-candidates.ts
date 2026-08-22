/**
 * Login-capture host — SERVICE WORKER side of the "Save this login?" flow.
 *
 *   content detector ──(raw CANDIDATE: loginUrl, username, password)──▶ here
 *   here ──(PROMPT: metadata)──▶ that tab's content script (toast)
 *   here ◀──(DECISION: save | update | dismiss | never)── toast / side-panel card
 *   here ──▶ Vault routes (createVaultItem / updateVaultFieldValue / addVaultField)
 *
 * Plaintext rules (the whole reason this is its own module):
 *   - The CANDIDATE envelope is received by a RAW `chrome.runtime.onMessage`
 *     listener — never `@/lib/messaging/native#on`, which logs every payload.
 *   - The password lives ONLY in `PENDING` (service-worker memory), keyed by
 *     tab, for at most `CANDIDATE_TTL_MS`, and is dropped on decision / expiry
 *     / tab close. Never chrome.storage, never a log line, never a broadcast,
 *     never a tool result or model context. `tests/unit/credential-capture-
 *     prompt.test.ts` greps this file for the banned APIs.
 *   - Everything that leaves this module (PROMPT, STATUS, CHANGED, decision
 *     results) is built from `toMeta()` — a value-free projection.
 *
 * Gates before a candidate is even held: the prompt is enabled in Settings,
 * the user holds a real JWT (the Vault rejects guests by design), the origin
 * is not on the user's "never" list, and the destination passes the SAME
 * https-or-loopback rule the fill tool enforces (`login-urls.ts`).
 */

import {
  WEBSITE_LOGIN_DEFINITION_KEY,
  addVaultField,
  createVaultItem,
  fetchBrowserLoginMatches,
  fetchVaultItem,
  hasRealUserToken,
  updateVaultFieldValue,
} from '@/lib/api/routes/vault';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { readCaptureLoginsEnabled } from '@/lib/settings/persisted';
import type { CaptureCandidateWire } from './capture-detector';
import { addNeverCaptureOrigin, isNeverCaptureOrigin } from './capture-settings';
import type {
  CaptureDecision,
  CaptureDecisionResult,
  CaptureExistingLogin,
  CapturePromptMeta,
  CaptureStatusQuery,
} from './capture-types';
import { isFillablePageUrl, normalizeLoginUrl, safeParseUrl } from './login-urls';

/** How long a submitted login waits for a decision before it is forgotten. */
export const CANDIDATE_TTL_MS = 3 * 60_000;
/** SPA logins never navigate — prompt after this if no load completes first. */
const PROMPT_FALLBACK_MS = 1500;
/** The new page's content script may not be listening yet — retry the prompt. */
const PROMPT_RETRY_DELAYS_MS = [0, 400, 1200, 3000];

interface Candidate {
  id: string;
  tabId: number;
  origin: string;
  loginUrl: string;
  host: string;
  username: string | null;
  /** PLAINTEXT. Memory only. See file header. */
  password: string;
  expiresAt: number;
  existing: CaptureExistingLogin[];
  promptTimer: ReturnType<typeof setTimeout> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  /** Existing-login lookup finished — the prompt may now be shown. */
  ready: boolean;
  /** The tab finished a load while we were still resolving → prompt as soon as ready. */
  loadCompleted: boolean;
  prompted: boolean;
}

/** tabId → the one pending candidate for that tab. */
const PENDING = new Map<number, Candidate>();
let seq = 0;

/** Test seam — tests replace this to avoid real timers. */
let now: () => number = () => Date.now();

/** Value-free projection: the ONLY thing that leaves this module about a candidate. */
function toMeta(c: Candidate): CapturePromptMeta {
  return {
    candidateId: c.id,
    tabId: c.tabId,
    host: c.host,
    username: c.username,
    existing: c.existing,
  };
}

function drop(c: Candidate): void {
  if (c.promptTimer) clearTimeout(c.promptTimer);
  if (c.expiryTimer) clearTimeout(c.expiryTimer);
  if (PENDING.get(c.tabId) === c) PENDING.delete(c.tabId);
  // Overwrite before release — belt and braces against a lingering reference.
  c.password = '';
  broadcast(CHANNELS.CREDENTIAL_CAPTURE_CHANGED, { tabId: c.tabId });
}

function findById(candidateId: string): Candidate | null {
  for (const c of PENDING.values()) if (c.id === candidateId) return c;
  return null;
}

function isWire(p: unknown): p is CaptureCandidateWire {
  if (!p || typeof p !== 'object') return false;
  const w = p as Record<string, unknown>;
  return (
    typeof w.loginUrl === 'string' &&
    typeof w.password === 'string' &&
    w.password.length > 0 &&
    (w.username === null || typeof w.username === 'string')
  );
}

async function promptTab(c: Candidate): Promise<void> {
  if (c.prompted) return;
  c.prompted = true;
  if (c.promptTimer) {
    clearTimeout(c.promptTimer);
    c.promptTimer = null;
  }
  broadcast(CHANNELS.CREDENTIAL_CAPTURE_CHANGED, { tabId: c.tabId });
  const meta = toMeta(c);
  for (const delay of PROMPT_RETRY_DELAYS_MS) {
    if (PENDING.get(c.tabId) !== c) return; // resolved meanwhile
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const ack = (await chrome.tabs.sendMessage(c.tabId, {
        __matrx: true,
        kind: CHANNELS.CREDENTIAL_CAPTURE_PROMPT,
        payload: meta,
      })) as { ok?: boolean } | undefined;
      if (ack?.ok) return;
    } catch {
      // "Receiving end does not exist" while the new page is still loading.
    }
  }
  log.info('sw', 'login-capture: page did not show the prompt; side panel still offers it', {
    tabId: c.tabId,
    host: c.host,
  });
}

/**
 * Hold a submitted login for this tab. Called ONLY by the raw listener below.
 * Returns whether it was held (the caller tells the content script nothing
 * more than that).
 */
export async function holdCandidate(
  tabId: number,
  wire: CaptureCandidateWire,
  deps: {
    enabled?: () => Promise<boolean>;
    signedIn?: () => Promise<boolean>;
    never?: (origin: string) => Promise<boolean>;
    matches?: (loginUrl: string) => Promise<CaptureExistingLogin[]>;
    prompt?: (c: Candidate) => Promise<void>;
  } = {},
): Promise<boolean> {
  const normalized = normalizeLoginUrl(wire.loginUrl);
  const parsed = safeParseUrl(wire.loginUrl);
  if (!normalized || !parsed || !isFillablePageUrl(wire.loginUrl)) return false;
  const origin = parsed.origin;

  if (!(await (deps.enabled ?? readCaptureLoginsEnabled)())) return false;
  if (!(await (deps.signedIn ?? hasRealUserToken)())) return false;
  if (await (deps.never ?? isNeverCaptureOrigin)(origin)) return false;

  const previous = PENDING.get(tabId);
  if (previous) drop(previous);

  const candidate: Candidate = {
    id: `cap-${tabId}-${++seq}-${now().toString(36)}`,
    tabId,
    origin,
    loginUrl: normalized,
    host: parsed.host,
    username: wire.username ? wire.username.slice(0, 256) : null,
    password: wire.password,
    expiresAt: now() + CANDIDATE_TTL_MS,
    existing: [],
    promptTimer: null,
    expiryTimer: null,
    ready: false,
    loadCompleted: false,
    prompted: false,
  };
  PENDING.set(tabId, candidate);
  candidate.expiryTimer = setTimeout(() => {
    if (PENDING.get(tabId) === candidate) drop(candidate);
  }, CANDIDATE_TTL_MS);

  // Which saved logins already cover this site? Ids + names only.
  const resolveMatches =
    deps.matches ??
    (async (loginUrl: string) => {
      const r = await fetchBrowserLoginMatches(loginUrl);
      return r.ok
        ? r.data.matches.map((m) => ({ item_id: m.item_id, display_name: m.display_name }))
        : [];
    });
  candidate.existing = await resolveMatches(normalized);
  if (PENDING.get(tabId) !== candidate) return false; // replaced while resolving
  candidate.ready = true;

  const prompt = deps.prompt ?? promptTab;
  if (candidate.loadCompleted) {
    void prompt(candidate);
  } else {
    candidate.promptTimer = setTimeout(() => void prompt(candidate), PROMPT_FALLBACK_MS);
  }
  return true;
}

/** Pending candidate for a tab, value-free. */
export function pendingCaptureForTab(tabId: number): CapturePromptMeta | null {
  const c = PENDING.get(tabId);
  if (!c) return null;
  if (c.expiresAt <= now()) {
    drop(c);
    return null;
  }
  return toMeta(c);
}

const COPY: Record<CaptureDecisionResult['status'], string> = {
  saved: 'Saved to your Vault.',
  updated: 'Password updated in your Vault.',
  dismissed: 'Not saved.',
  never: 'Okay — Matrx will not ask about this site again.',
  expired: 'That login is no longer available to save. Sign in again to save it.',
  sign_in_required: 'Sign in to Matrx to save logins.',
  error: 'The Vault could not save that. Try again from the Vault tab.',
};

function result(status: CaptureDecisionResult['status']): CaptureDecisionResult {
  return {
    ok: status === 'saved' || status === 'updated' || status === 'dismissed' || status === 'never',
    status,
    message: COPY[status],
  };
}

/** Apply a decision. The value leaves this module ONLY on `save` / `update`, to the Vault routes. */
export async function applyCaptureDecision(
  decision: CaptureDecision,
): Promise<CaptureDecisionResult> {
  const c = findById(decision.candidateId);
  if (!c || c.expiresAt <= now()) {
    if (c) drop(c);
    return result('expired');
  }

  if (decision.action === 'dismiss') {
    drop(c);
    return result('dismissed');
  }
  if (decision.action === 'never') {
    await addNeverCaptureOrigin(c.origin);
    drop(c);
    return result('never');
  }

  if (!(await hasRealUserToken())) return result('sign_in_required');

  if (decision.action === 'save') {
    const fields = [{ field_key: 'password', value: c.password }];
    if (c.username) fields.unshift({ field_key: 'username', value: c.username });
    const r = await createVaultItem({
      display_name: c.host,
      fields,
      definition_key: WEBSITE_LOGIN_DEFINITION_KEY,
      login_urls: [c.loginUrl],
      browser_fill_enabled: true,
    });
    if (!r.ok) return result(r.failure.kind === 'sign_in_required' ? 'sign_in_required' : 'error');
    drop(c);
    return result('saved');
  }

  // update
  const itemId = decision.itemId;
  if (!itemId || !c.existing.some((e) => e.item_id === itemId)) return result('error');
  const item = await fetchVaultItem(itemId);
  if (!item.ok)
    return result(item.failure.kind === 'sign_in_required' ? 'sign_in_required' : 'error');
  const passwordField = item.data.fields.find((f) => f.is_active && f.field_key === 'password');
  const write = passwordField
    ? await updateVaultFieldValue(itemId, passwordField.id, c.password)
    : await addVaultField(itemId, { field_key: 'password', value: c.password });
  if (!write.ok)
    return result(write.failure.kind === 'sign_in_required' ? 'sign_in_required' : 'error');
  drop(c);
  return result('updated');
}

let registered = false;

/**
 * Register the raw CANDIDATE listener + the value-free bus handlers + tab
 * lifecycle hooks. Called once, synchronously, from the SW bootstrap.
 */
export function registerCredentialCaptureHost(): void {
  if (registered) return;
  registered = true;

  // RAW listener — the one value-bearing envelope. Not `on()`: that logs payloads.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const env = msg as { __matrx?: unknown; kind?: unknown; payload?: unknown };
    if (env.__matrx !== true || env.kind !== CHANNELS.CREDENTIAL_CAPTURE_CANDIDATE) return false;
    const tabId = sender.tab?.id;
    // Only a top-frame content script of a real tab may report a login.
    if (tabId == null || sender.frameId !== 0 || !isWire(env.payload)) {
      sendResponse({ ok: false });
      return false;
    }
    void holdCandidate(tabId, env.payload)
      .then((held) => sendResponse({ ok: held }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });

  on<CaptureDecision, CaptureDecisionResult>(CHANNELS.CREDENTIAL_CAPTURE_DECISION, (decision) =>
    applyCaptureDecision(decision),
  );
  on<CaptureStatusQuery, CapturePromptMeta | null>(CHANNELS.CREDENTIAL_CAPTURE_STATUS, (q) =>
    typeof q?.tabId === 'number' ? pendingCaptureForTab(q.tabId) : null,
  );

  // The post-login navigation finished → show the prompt on the new page.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    const c = PENDING.get(tabId);
    if (!c || c.prompted) return;
    if (c.ready) void promptTab(c);
    else c.loadCompleted = true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    const c = PENDING.get(tabId);
    if (c) drop(c);
  });
}

/** Test-only reset. */
export function _resetCaptureCandidates(clock?: () => number): void {
  for (const c of [...PENDING.values()]) drop(c);
  seq = 0;
  now = clock ?? (() => Date.now());
}
