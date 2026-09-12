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
 *   - The password lives only in the `PENDING` worker Map and its matching
 *     `chrome.storage.session` trusted-context record, keyed by tab, for at
 *     most `CANDIDATE_TTL_MS`. It is dropped on decision / expiry / tab close.
 *     It never reaches disk storage, a log line, or a broadcast,
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
import { getCurrentUser } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { readCaptureLoginsEnabled } from '@/lib/settings/persisted';
import type { CaptureCandidateWire } from './capture-detector';
import { addNeverCaptureOrigin, isNeverCaptureOrigin } from './capture-settings';
import type {
  CaptureCandidateReply,
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
const SESSION_KEY = 'matrx.credentials.capture.pending.v1';
const SESSION_VERSION = 1;
const EXPIRY_ALARM = 'matrx.credentials.capture.expiry';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Actor = { userId: string; organizationId: string };
type MutationCommand =
  | { kind: 'create_item'; key: string; body: Parameters<typeof createVaultItem>[0] }
  | { kind: 'update_field'; key: string; itemId: string; fieldId: string; body: { value: string } }
  | {
      kind: 'add_field';
      key: string;
      itemId: string;
      body: { field_key: 'password'; value: string };
    };

interface Candidate {
  id: string;
  tabId: number;
  origin: string;
  loginUrl: string;
  host: string;
  username: string | null;
  /** PLAINTEXT. Memory only. See file header. */
  stage: 'username_first' | 'password';
  password: string | null;
  sourceDocumentId: string;
  sourcePath: string;
  actor: Actor | null;
  createdAt: number;
  generation: number;
  state: 'ready' | 'in_flight';
  operation: MutationCommand | null;
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
let initialization: Promise<boolean> | null = null;
let mutationQueue: Promise<unknown> = Promise.resolve();
let storageAvailable = true;
const EPOCHS = new Map<number, number>();
let globalEpoch = 0;
const OPERATIONS = new Map<
  string,
  { action: CaptureDecision['action']; itemId?: string; promise: Promise<CaptureDecisionResult> }
>();

function epoch(tabId: number): number {
  return EPOCHS.get(tabId) ?? 0;
}
function invalidateNow(tabId?: number): void {
  globalEpoch++;
  if (tabId !== undefined) EPOCHS.set(tabId, epoch(tabId) + 1);
  else for (const id of PENDING.keys()) EPOCHS.set(id, epoch(id) + 1);
}
function sameEpoch(c: Candidate, baseline: number, global: number): boolean {
  return PENDING.get(c.tabId) === c && epoch(c.tabId) === baseline && globalEpoch === global;
}

type StoredCandidate = Pick<
  Candidate,
  | 'id'
  | 'tabId'
  | 'origin'
  | 'loginUrl'
  | 'host'
  | 'stage'
  | 'username'
  | 'password'
  | 'sourceDocumentId'
  | 'sourcePath'
  | 'createdAt'
  | 'expiresAt'
  | 'state'
  | 'operation'
> & {
  version: 1;
  actor: Actor;
};

function serialize(): Record<string, StoredCandidate> {
  return Object.fromEntries(
    [...PENDING.values()]
      .filter(
        (c): c is Candidate & { actor: { userId: string; organizationId: string } } => !!c.actor,
      )
      .map((c) => [
        String(c.tabId),
        {
          version: SESSION_VERSION,
          id: c.id,
          tabId: c.tabId,
          origin: c.origin,
          loginUrl: c.loginUrl,
          host: c.host,
          stage: c.stage,
          username: c.username,
          password: c.password,
          sourceDocumentId: c.sourceDocumentId,
          sourcePath: c.sourcePath,
          actor: c.actor,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt,
          state: c.state,
          operation: c.operation,
        },
      ]),
  );
}
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(work, work);
  mutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
async function persist(): Promise<void> {
  if (!storageAvailable) throw new Error('capture session unavailable');
  const serialized = serialize();
  if (Object.keys(serialized).length === 0) {
    if (!(await erasePersistedSnapshot())) throw new Error('capture session cleanup unavailable');
  } else await chrome.storage.session.set({ [SESSION_KEY]: serialized });
  const earliest = [...PENDING.values()].reduce<number | null>(
    (value, candidate) =>
      value === null ? candidate.expiresAt : Math.min(value, candidate.expiresAt),
    null,
  );
  if (!chrome.alarms) return;
  if (earliest === null) await chrome.alarms.clear(EXPIRY_ALARM);
  else chrome.alarms.create(EXPIRY_ALARM, { when: earliest });
}

/**
 * Commit a value-free replacement before treating the old session entry as
 * resolved. Removing that now-empty key is housekeeping: a remove failure
 * cannot bring plaintext back after the empty snapshot has been stored.
 */
async function erasePersistedSnapshot(): Promise<boolean> {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: {} });
  } catch {
    // A successful remove is equally sufficient, but only when it actually
    // commits. If both writes fail, keep the frozen command retryable.
    try {
      await chrome.storage.session.remove(SESSION_KEY);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await chrome.storage.session.remove(SESSION_KEY);
  } catch {
    // The already-written empty snapshot is the durable privacy boundary.
  }
  return true;
}
function clearMemory(): void {
  for (const c of PENDING.values()) {
    if (c.promptTimer) clearTimeout(c.promptTimer);
    if (c.expiryTimer) clearTimeout(c.expiryTimer);
    c.password = null;
  }
  PENDING.clear();
  storageAvailable = false;
}

/**
 * The persisted operation is a sealed capability, not a second user input.
 * Keep its construction and restore-time validation tied to the same frozen
 * candidate snapshot so a corrupt session row cannot redirect a later retry.
 */
function createBodyFor(snapshot: Pick<Candidate, 'host' | 'loginUrl' | 'username' | 'password'>) {
  if (!snapshot.password) return null;
  return {
    display_name: snapshot.host,
    fields: [
      ...(snapshot.username ? [{ field_key: 'username' as const, value: snapshot.username }] : []),
      { field_key: 'password' as const, value: snapshot.password },
    ],
    definition_key: WEBSITE_LOGIN_DEFINITION_KEY,
    login_urls: [snapshot.loginUrl],
    browser_fill_enabled: true,
  };
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function exactFields(
  fields: unknown,
  expected: ReadonlyArray<{ field_key: 'username' | 'password'; value: string }>,
): boolean {
  return (
    Array.isArray(fields) &&
    fields.length === expected.length &&
    fields.every(
      (field, index) =>
        !!field &&
        typeof field === 'object' &&
        exactKeys(field, ['field_key', 'value']) &&
        (field as Record<string, unknown>).field_key === expected[index]?.field_key &&
        (field as Record<string, unknown>).value === expected[index]?.value,
    )
  );
}

function validStored(row: unknown): row is StoredCandidate {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  const keys = [
    'version',
    'id',
    'tabId',
    'origin',
    'loginUrl',
    'host',
    'stage',
    'username',
    'password',
    'sourceDocumentId',
    'sourcePath',
    'actor',
    'createdAt',
    'expiresAt',
    'state',
    'operation',
  ];
  if (
    Object.keys(r).some((key) => !keys.includes(key)) ||
    r.version !== SESSION_VERSION ||
    typeof r.id !== 'string' ||
    !UUID.test(r.id) ||
    !Number.isInteger(r.tabId) ||
    typeof r.origin !== 'string' ||
    typeof r.loginUrl !== 'string' ||
    typeof r.host !== 'string' ||
    (r.stage !== 'username_first' && r.stage !== 'password') ||
    (r.username !== null &&
      (typeof r.username !== 'string' || r.username.length === 0 || r.username.length > 256)) ||
    !(
      (r.stage === 'password' &&
        typeof r.password === 'string' &&
        r.password.length > 0 &&
        r.password.length <= 1024) ||
      (r.stage === 'username_first' &&
        r.password === null &&
        typeof r.username === 'string' &&
        r.username.length > 0 &&
        r.username.length <= 256)
    ) ||
    typeof r.sourceDocumentId !== 'string' ||
    !r.sourceDocumentId ||
    typeof r.sourcePath !== 'string' ||
    !r.sourcePath.startsWith('/') ||
    !r.actor ||
    typeof r.actor !== 'object' ||
    !exactKeys(r.actor, ['userId', 'organizationId']) ||
    !UUID.test(String((r.actor as Record<string, unknown>).userId)) ||
    !UUID.test(String((r.actor as Record<string, unknown>).organizationId)) ||
    !Number.isFinite(r.createdAt) ||
    !Number.isFinite(r.expiresAt) ||
    (r.expiresAt as number) - (r.createdAt as number) !== CANDIDATE_TTL_MS ||
    (r.createdAt as number) > now() + 10_000 ||
    (r.expiresAt as number) <= now() ||
    (r.state !== 'ready' && r.state !== 'in_flight')
  )
    return false;

  const parsed = safeParseUrl(r.loginUrl);
  const normalized = normalizeLoginUrl(r.loginUrl);
  if (
    !parsed ||
    !normalized ||
    !isFillablePageUrl(r.loginUrl) ||
    r.loginUrl !== normalized ||
    r.origin !== parsed.origin ||
    r.host !== parsed.host ||
    r.sourcePath !== parsed.pathname
  )
    return false;

  if (r.state === 'ready') return r.operation === null;
  if (r.stage !== 'password' || !r.password || !r.operation || typeof r.operation !== 'object')
    return false;
  const operation = r.operation as Record<string, unknown>;
  if (!UUID.test(String(operation.key))) return false;
  if (operation.kind === 'create_item') {
    const body = operation.body as Record<string, unknown> | null;
    const expected = createBodyFor({
      host: r.host as string,
      loginUrl: r.loginUrl as string,
      username: r.username as string | null,
      password: r.password as string | null,
    });
    return (
      !!body &&
      !!expected &&
      typeof body === 'object' &&
      exactKeys(operation, ['kind', 'key', 'body']) &&
      exactKeys(body, [
        'display_name',
        'fields',
        'definition_key',
        'login_urls',
        'browser_fill_enabled',
      ]) &&
      body.display_name === expected.display_name &&
      exactFields(body.fields, expected.fields) &&
      body.definition_key === expected.definition_key &&
      Array.isArray(body.login_urls) &&
      body.login_urls.length === 1 &&
      body.login_urls[0] === expected.login_urls[0] &&
      body.browser_fill_enabled === expected.browser_fill_enabled
    );
  }
  return (
    (operation.kind === 'update_field' &&
      exactKeys(operation, ['kind', 'key', 'itemId', 'fieldId', 'body']) &&
      UUID.test(String(operation.itemId)) &&
      UUID.test(String(operation.fieldId)) &&
      !!operation.body &&
      typeof operation.body === 'object' &&
      exactKeys(operation.body as object, ['value']) &&
      (operation.body as Record<string, unknown>).value === r.password) ||
    (operation.kind === 'add_field' &&
      exactKeys(operation, ['kind', 'key', 'itemId', 'body']) &&
      UUID.test(String(operation.itemId)) &&
      !!operation.body &&
      typeof operation.body === 'object' &&
      exactKeys(operation.body as object, ['field_key', 'value']) &&
      (operation.body as Record<string, unknown>)?.field_key === 'password' &&
      (operation.body as Record<string, unknown>)?.value === r.password)
  );
}
async function currentActor(): Promise<{ userId: string; organizationId: string } | null> {
  if (!(await hasRealUserToken())) return null;
  const [user, organizationId] = await Promise.all([getCurrentUser(), getActiveOrganizationId()]);
  return user?.id && organizationId ? { userId: user.id, organizationId } : null;
}
function sameActor(a: Candidate['actor'], b: Candidate['actor']): boolean {
  return !!a && !!b && a.userId === b.userId && a.organizationId === b.organizationId;
}
async function initializeAndPurge(): Promise<void> {
  if (!(await ensureSession())) return;
  await queued(async () => {
    for (const candidate of [...PENDING.values()]) await removeCandidate(candidate);
  });
}
async function ensureSession(): Promise<boolean> {
  if (!initialization)
    initialization = queued(async () => {
      try {
        await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
        if (!stored || typeof stored !== 'object') return true;
        const actor = await currentActor();
        if (!actor || !(await readCaptureLoginsEnabled())) {
          if (!(await erasePersistedSnapshot())) {
            clearMemory();
            return false;
          }
          return true;
        }
        for (const row of Object.values(stored as Record<string, StoredCandidate>)) {
          if (
            !validStored(row) ||
            !sameActor(row.actor, actor) ||
            (await isNeverCaptureOrigin(row.origin))
          )
            continue;
          const tab = await chrome.tabs.get(row.tabId).catch(() => null);
          if (!tab?.url || new URL(tab.url).origin !== row.origin) continue;
          const candidate: Candidate = {
            ...row,
            generation: 0,
            existing: [],
            promptTimer: null,
            expiryTimer: null,
            ready: false,
            loadCompleted: true,
            prompted: false,
          };
          candidate.expiryTimer = setTimeout(
            () => void removeCandidate(candidate),
            Math.max(0, row.expiresAt - now()),
          );
          PENDING.set(row.tabId, candidate);
          if (candidate.stage === 'password' && candidate.state === 'ready')
            void refreshMatches(candidate);
        }
        await persist();
        return true;
      } catch {
        clearMemory();
        return false;
      }
    });
  return (await initialization) && storageAvailable;
}

async function refreshMatches(candidate: Candidate): Promise<void> {
  if (!candidate.actor || candidate.stage !== 'password') return;
  const baseline = epoch(candidate.tabId);
  const global = globalEpoch;
  const matched = await fetchBrowserLoginMatches(candidate.loginUrl, undefined, {
    expectedActor: candidate.actor,
  });
  const [actor, enabled] = await Promise.all([currentActor(), readCaptureLoginsEnabled()]);
  if (!sameEpoch(candidate, baseline, global) || !sameActor(candidate.actor, actor) || !enabled)
    return;
  const existing = matched.ok
    ? matched.data.matches.map((m) => ({ item_id: m.item_id, display_name: m.display_name }))
    : [];
  await queued(async () => {
    if (!sameEpoch(candidate, baseline, global)) return;
    candidate.existing = existing;
    candidate.ready = true;
    try {
      await persist();
    } catch {
      clearMemory();
      return;
    }
    if (candidate.loadCompleted) void promptTab(candidate);
  });
}

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
  void queued(async () => {
    try {
      await persist();
    } catch {
      clearMemory();
    }
  });
  // Overwrite before release — belt and braces against a lingering reference.
  c.password = null;
}

async function removeCandidate(c: Candidate): Promise<boolean> {
  if (PENDING.get(c.tabId) !== c) return true;
  if (c.promptTimer) clearTimeout(c.promptTimer);
  if (c.expiryTimer) clearTimeout(c.expiryTimer);
  PENDING.delete(c.tabId);
  c.generation++;
  c.password = null;
  try {
    await persist();
  } catch {
    clearMemory();
    return false;
  }
  broadcast(CHANNELS.CREDENTIAL_CAPTURE_CHANGED, { tabId: c.tabId });
  void chrome.tabs
    .sendMessage(c.tabId, {
      __matrx: true,
      kind: CHANNELS.CREDENTIAL_CAPTURE_RESOLVED,
      payload: { candidateId: c.id },
    })
    .catch(() => undefined);
  return true;
}

function findById(candidateId: string): Candidate | null {
  for (const c of PENDING.values()) if (c.id === candidateId) return c;
  return null;
}

function isWire(p: unknown): p is CaptureCandidateWire {
  if (!p || typeof p !== 'object') return false;
  const w = p as Record<string, unknown>;
  return (
    Object.keys(w).every((key) => ['stage', 'loginUrl', 'username', 'password'].includes(key)) &&
    typeof w.loginUrl === 'string' &&
    (w.username === null || typeof w.username === 'string') &&
    ((w.stage === 'password' &&
      typeof w.password === 'string' &&
      w.password.length > 0 &&
      w.password.length <= 1024) ||
      (w.stage === 'username_first' &&
        typeof w.username === 'string' &&
        w.username.length > 0 &&
        w.username.length <= 256 &&
        !('password' in w)))
  );
}

async function promptTab(c: Candidate): Promise<void> {
  if (c.prompted) return;
  const actor = await currentActor();
  const [tab, frame] = await Promise.all([
    chrome.tabs.get(c.tabId).catch(() => null),
    chrome.webNavigation.getFrame({ tabId: c.tabId, frameId: 0 }).catch(() => null),
  ]);
  if (
    !sameActor(c.actor, actor) ||
    !tab?.url ||
    !frame?.documentId ||
    new URL(tab.url).origin !== c.origin ||
    !frame.url ||
    new URL(frame.url).origin !== c.origin
  ) {
    await queued(() => removeCandidate(c));
    return;
  }
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
      const ack = (await chrome.tabs.sendMessage(
        c.tabId,
        {
          __matrx: true,
          kind: CHANNELS.CREDENTIAL_CAPTURE_PROMPT,
          payload: meta,
        },
        { documentId: frame.documentId },
      )) as { ok?: boolean } | undefined;
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
    actor?: { userId: string; organizationId: string } | null;
    documentId?: string;
    senderUrl?: string;
  } = {},
): Promise<boolean> {
  if (!(await ensureSession())) return false;
  const normalized = normalizeLoginUrl(wire.loginUrl);
  const parsed = safeParseUrl(wire.loginUrl);
  if (!normalized || !parsed || !isFillablePageUrl(wire.loginUrl)) return false;
  const origin = parsed.origin;
  const actor = deps.actor === undefined ? await currentActor() : deps.actor;
  if (!actor) return false;
  const stillAuthorized = async (): Promise<boolean> =>
    sameActor(actor, await currentActor()) && (await (deps.enabled ?? readCaptureLoginsEnabled)());

  if (wire.stage === 'password' && typeof wire.password !== 'string') return false;
  if (wire.username !== null && wire.username.length > 256) return false;
  if (!(await (deps.enabled ?? readCaptureLoginsEnabled)())) return false;
  if (!(await (deps.signedIn ?? hasRealUserToken)())) return false;
  if (await (deps.never ?? isNeverCaptureOrigin)(origin)) return false;
  if (!(await stillAuthorized())) return false;
  const previous = PENDING.get(tabId);
  const continuedUsername =
    wire.stage === 'password' &&
    wire.username === null &&
    previous?.stage === 'username_first' &&
    previous.origin === origin &&
    sameActor(previous.actor, actor)
      ? previous.username
      : null;
  if (previous) await removeCandidate(previous);

  const candidate: Candidate = {
    id: crypto.randomUUID(),
    tabId,
    origin,
    loginUrl: normalized,
    host: parsed.host,
    stage: wire.stage,
    username: wire.username ?? continuedUsername,
    password: wire.stage === 'password' ? (wire.password ?? null) : null,
    sourceDocumentId: deps.documentId ?? '',
    sourcePath: parsed.pathname,
    actor,
    createdAt: now(),
    expiresAt: now() + CANDIDATE_TTL_MS,
    generation: 0,
    state: 'ready',
    operation: null,
    existing: [],
    promptTimer: null,
    expiryTimer: null,
    ready: false,
    loadCompleted: false,
    prompted: false,
  };
  PENDING.set(tabId, candidate);
  try {
    await queued(persist);
  } catch {
    clearMemory();
    return false;
  }
  candidate.expiryTimer = setTimeout(() => {
    if (PENDING.get(tabId) === candidate) void removeCandidate(candidate);
  }, CANDIDATE_TTL_MS);

  // A username-first handoff is only a bounded continuation; it never prompts.
  if (candidate.stage === 'username_first') return true;
  // Which saved logins already cover this site? Ids + names only.
  const resolveMatches =
    deps.matches ??
    (async (loginUrl: string) => {
      const r = await fetchBrowserLoginMatches(loginUrl, undefined, { expectedActor: actor });
      return r.ok
        ? r.data.matches.map((m) => ({ item_id: m.item_id, display_name: m.display_name }))
        : [];
    });
  const baseline = epoch(tabId);
  const global = globalEpoch;
  const resolved = await resolveMatches(normalized);
  if (!sameEpoch(candidate, baseline, global) || !(await stillAuthorized())) return false;
  candidate.existing = resolved;
  if (PENDING.get(tabId) !== candidate) return false; // replaced while resolving
  candidate.ready = true;
  if (!(await stillAuthorized())) {
    await removeCandidate(candidate);
    return false;
  }
  try {
    await queued(persist);
  } catch {
    clearMemory();
    return false;
  }

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
  if (!storageAvailable) return unavailableMeta(tabId);
  const c = PENDING.get(tabId);
  if (!c) return null;
  if (c.expiresAt <= now()) {
    void removeCandidate(c);
    return null;
  }
  if (c.stage !== 'password') return null;
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

const CLEANUP_UNAVAILABLE = 'Capture cleanup could not finish. Reopen the extension and try again.';
const MUTATION_COMMITTED_CLEANUP_UNAVAILABLE =
  'Your Vault change was committed, but browser cleanup could not finish. Reopen the extension and retry the same action.';

function unavailableMeta(tabId: number): CapturePromptMeta {
  return { candidateId: '', tabId, host: '', username: null, existing: [], unavailable: true };
}

function cleanupUnavailableResult(): CaptureDecisionResult {
  return result('error', CLEANUP_UNAVAILABLE);
}

function result(
  status: CaptureDecisionResult['status'],
  message = COPY[status],
): CaptureDecisionResult {
  return {
    ok: status === 'saved' || status === 'updated' || status === 'dismissed' || status === 'never',
    status,
    message,
  };
}

/** Apply a decision. The value leaves this module ONLY on `save` / `update`, to the Vault routes. */
export async function applyCaptureDecision(
  decision: CaptureDecision,
): Promise<CaptureDecisionResult> {
  if (!(await ensureSession()))
    return storageAvailable ? result('error') : cleanupUnavailableResult();
  const c = findById(decision.candidateId);
  if (!c || c.expiresAt <= now()) {
    if (c) await queued(() => removeCandidate(c));
    return result('expired');
  }

  if (decision.action === 'dismiss') {
    return (await queued(() => removeCandidate(c)))
      ? result('dismissed')
      : result('error', CLEANUP_UNAVAILABLE);
  }
  if (decision.action === 'never') {
    await addNeverCaptureOrigin(c.origin);
    return (await queued(() => removeCandidate(c)))
      ? result('never')
      : result('error', CLEANUP_UNAVAILABLE);
  }
  const existing = OPERATIONS.get(c.id);
  if (existing) {
    if (existing.action !== decision.action || existing.itemId !== decision.itemId)
      return result('error');
    return existing.promise;
  }
  const promise = beginMutation(c, decision);
  OPERATIONS.set(c.id, {
    action: decision.action,
    ...(decision.itemId ? { itemId: decision.itemId } : {}),
    promise,
  });
  try {
    return await promise;
  } finally {
    if (OPERATIONS.get(c.id)?.promise === promise) OPERATIONS.delete(c.id);
  }
}

async function beginMutation(
  c: Candidate,
  decision: CaptureDecision,
): Promise<CaptureDecisionResult> {
  const baseline = epoch(c.tabId);
  const global = globalEpoch;
  const expectedActor = c.actor;
  if (!expectedActor || c.stage !== 'password' || !c.password || !sameEpoch(c, baseline, global))
    return result('error');
  const stillBound = async (): Promise<boolean> =>
    sameActor(expectedActor, await currentActor()) &&
    (await readCaptureLoginsEnabled()) &&
    sameEpoch(c, baseline, global);
  if (!(await stillBound())) {
    await queued(() => removeCandidate(c));
    return result('sign_in_required');
  }
  if (c.state === 'in_flight' && c.operation) {
    const matchesDecision =
      (decision.action === 'save' && c.operation.kind === 'create_item') ||
      (decision.action === 'update' &&
        (c.operation.kind === 'update_field' || c.operation.kind === 'add_field') &&
        c.operation.itemId === decision.itemId);
    return matchesDecision
      ? dispatchFrozen(c, c.operation, expectedActor, baseline, global)
      : result('error');
  }
  let command: MutationCommand;
  if (decision.action === 'save') {
    const body = createBodyFor(c);
    if (!body) return result('error');
    command = {
      kind: 'create_item',
      key: crypto.randomUUID(),
      body,
    };
  } else {
    if (decision.action !== 'update' || !decision.itemId) return result('error');
    const matches = await fetchBrowserLoginMatches(c.loginUrl, undefined, { expectedActor });
    if (!matches.ok || !matches.data.matches.some((entry) => entry.item_id === decision.itemId))
      return mutationFailure(c, matches.ok ? 'forbidden' : matches.failure.kind);
    if (!(await stillBound())) return result('expired');
    const item = await fetchVaultItem(decision.itemId, { expectedActor });
    if (!item.ok || !item.data.capabilities?.can_edit)
      return mutationFailure(c, item.ok ? 'forbidden' : item.failure.kind);
    const field = item.data.fields.find(
      (entry) => entry.is_active && entry.field_key === 'password',
    );
    command = field
      ? {
          kind: 'update_field',
          key: crypto.randomUUID(),
          itemId: decision.itemId,
          fieldId: field.id,
          body: { value: c.password },
        }
      : {
          kind: 'add_field',
          key: crypto.randomUUID(),
          itemId: decision.itemId,
          body: { field_key: 'password', value: c.password },
        };
  }
  if (!(await stillBound())) return result('expired');
  await queued(async () => {
    if (!sameEpoch(c, baseline, global)) return;
    c.state = 'in_flight';
    c.operation = command;
    try {
      await persist();
    } catch {
      clearMemory();
    }
  });
  if (!sameEpoch(c, baseline, global) || !storageAvailable || !(await stillBound()))
    return result('expired');
  return dispatchFrozen(c, command, expectedActor, baseline, global);
}

async function dispatchFrozen(
  c: Candidate,
  command: MutationCommand,
  expectedActor: Actor,
  baseline: number,
  global: number,
): Promise<CaptureDecisionResult> {
  const stillBound = async (): Promise<boolean> =>
    sameActor(expectedActor, await currentActor()) &&
    (await readCaptureLoginsEnabled()) &&
    sameEpoch(c, baseline, global);
  if (!(await stillBound())) return result('expired');
  const write =
    command.kind === 'create_item'
      ? await createVaultItem(command.body, { expectedActor, idempotencyKey: command.key })
      : command.kind === 'update_field'
        ? await updateVaultFieldValue(command.itemId, command.fieldId, command.body.value, {
            expectedActor,
            idempotencyKey: command.key,
          })
        : await addVaultField(command.itemId, command.body, {
            expectedActor,
            idempotencyKey: command.key,
          });
  if (!write.ok) return mutationFailure(c, write.failure.kind);
  if (!(await stillBound())) return result('expired');
  if (!(await queued(() => removeCandidate(c))))
    return result('error', MUTATION_COMMITTED_CLEANUP_UNAVAILABLE);
  return result(command.kind === 'create_item' ? 'saved' : 'updated');
}

function mutationFailure(c: Candidate, kind: string): CaptureDecisionResult {
  // Definitive errors abandon the frozen command; transport failure keeps it
  // for same-key retry. Existing route failures expose only a safe category.
  if (kind === 'forbidden') {
    c.state = 'ready';
    c.operation = null;
    void queued(persist);
  }
  return result(kind === 'sign_in_required' ? 'sign_in_required' : 'error');
}

let registered = false;

function validDecision(value: unknown): value is CaptureDecision {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.candidateId === 'string' &&
    ['save', 'update', 'dismiss', 'never'].includes(d.action as string) &&
    Object.keys(d).every((key) => ['candidateId', 'action', 'itemId'].includes(key)) &&
    (d.itemId === undefined || typeof d.itemId === 'string')
  );
}
function validStatus(value: unknown): value is CaptureStatusQuery {
  return (
    !!value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    Number.isInteger((value as { tabId?: unknown }).tabId)
  );
}
function extensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    !sender.tab &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`) &&
    sender.id === chrome.runtime.id
  );
}
async function currentContentSender(
  sender: chrome.runtime.MessageSender,
): Promise<{ tabId: number; documentId: string; url: string } | null> {
  const tabId = sender.tab?.id;
  const documentId = (sender as chrome.runtime.MessageSender & { documentId?: unknown }).documentId;
  if (
    sender.id !== chrome.runtime.id ||
    tabId == null ||
    sender.frameId !== 0 ||
    typeof documentId !== 'string' ||
    typeof sender.url !== 'string'
  )
    return null;
  try {
    const [tab, frame] = await Promise.all([
      chrome.tabs.get(tabId),
      chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
    ]);
    const tabUrl = tab.url ? new URL(tab.url) : null;
    const senderUrl = new URL(sender.url);
    const frameUrl = frame?.url ? new URL(frame.url) : null;
    if (
      !tabUrl ||
      !frameUrl ||
      !frame ||
      frame.documentId !== documentId ||
      tabUrl.origin !== senderUrl.origin ||
      tabUrl.pathname !== senderUrl.pathname ||
      frameUrl.origin !== senderUrl.origin ||
      frameUrl.pathname !== senderUrl.pathname
    )
      return null;
    return { tabId, documentId, url: sender.url };
  } catch {
    return null;
  }
}

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
    if (env.__matrx !== true) return false;
    if (env.kind === CHANNELS.AUTH_STATE_CHANGED) {
      invalidateNow();
      void initializeAndPurge();
      return false;
    }
    if (env.kind === CHANNELS.CREDENTIAL_CAPTURE_CANDIDATE) {
      if (!isWire(env.payload)) {
        sendResponse({ status: 'ignored' } satisfies CaptureCandidateReply);
        return false;
      }
      const wire = env.payload;
      void currentContentSender(sender)
        .then(async (source) => {
          if (!source) return { status: 'ignored' } satisfies CaptureCandidateReply;
          try {
            const candidateUrl = safeParseUrl(wire.loginUrl);
            if (
              !candidateUrl ||
              candidateUrl.origin !== new URL(source.url).origin ||
              candidateUrl.pathname !== new URL(source.url).pathname
            )
              return { status: 'ignored' } satisfies CaptureCandidateReply;
            if (
              !(await readCaptureLoginsEnabled()) ||
              (await isNeverCaptureOrigin(candidateUrl.origin))
            )
              return { status: 'ignored' } satisfies CaptureCandidateReply;
            if (!(await hasRealUserToken()))
              return {
                status: 'unavailable',
                reason: 'sign_in_required',
                tabId: source.tabId,
              } satisfies CaptureCandidateReply;
            const actor = await currentActor();
            if (!actor)
              return {
                status: 'unavailable',
                reason: 'organization_required',
                tabId: source.tabId,
              } satisfies CaptureCandidateReply;
            const held = await holdCandidate(source.tabId, wire, {
              actor,
              documentId: source.documentId,
              senderUrl: source.url,
            });
            if (held) return { status: 'held' } satisfies CaptureCandidateReply;
            if (
              !(await readCaptureLoginsEnabled()) ||
              (await isNeverCaptureOrigin(candidateUrl.origin))
            )
              return { status: 'ignored' } satisfies CaptureCandidateReply;
          } catch {
            // The sender and wire were already verified; report only a fixed
            // recovery reason and the tab derived from that verified sender.
          }
          return {
            status: 'unavailable',
            reason: 'capture_unavailable',
            tabId: source.tabId,
          } satisfies CaptureCandidateReply;
        })
        .then(sendResponse)
        .catch(() => sendResponse({ status: 'ignored' } satisfies CaptureCandidateReply));
      return true;
    }
    if (env.kind === CHANNELS.CREDENTIAL_CAPTURE_DECISION) {
      if (!validDecision(env.payload)) {
        sendResponse(result('error'));
        return false;
      }
      const decision = env.payload;
      void (async () => {
        if (!(await ensureSession()))
          return storageAvailable ? result('error') : cleanupUnavailableResult();
        const c = findById(decision.candidateId);
        if (!c) return result('expired');
        if (extensionPageSender(sender)) {
          const actor = await currentActor();
          if (!sameActor(c.actor, actor)) return result('expired');
        } else {
          const source = await currentContentSender(sender);
          if (!source || source.tabId !== c.tabId || new URL(source.url).origin !== c.origin)
            return result('expired');
        }
        return applyCaptureDecision(decision);
      })()
        .then(sendResponse)
        .catch(() => sendResponse(result('error')));
      return true;
    }
    if (env.kind === CHANNELS.CREDENTIAL_CAPTURE_STATUS) {
      if (!extensionPageSender(sender) || !validStatus(env.payload)) {
        sendResponse(null);
        return false;
      }
      const query = env.payload;
      void (async () => {
        if (!(await ensureSession())) return storageAvailable ? null : unavailableMeta(query.tabId);
        const c = PENDING.get(query.tabId);
        if (!c || !sameActor(c.actor, await currentActor())) return null;
        const tab = await chrome.tabs.get(c.tabId).catch(() => null);
        return tab?.url && new URL(tab.url).origin === c.origin
          ? pendingCaptureForTab(c.tabId)
          : null;
      })()
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true;
    }
    return false;
  });

  // The post-login navigation finished → show the prompt on the new page.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    void (async () => {
      if (!(await ensureSession())) return;
      await queued(async () => {
        const c = PENDING.get(tabId);
        if (!c || c.prompted) return;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab?.url || new URL(tab.url).origin !== c.origin) {
          await removeCandidate(c);
          return;
        }
        if (c.ready) void promptTab(c);
        else c.loadCompleted = true;
      });
    })();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    invalidateNow(tabId);
    void (async () => {
      if (await ensureSession()) {
        const c = PENDING.get(tabId);
        if (c) await queued(() => removeCandidate(c));
      }
    })();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!info.url) return;
    const updatedUrl = info.url;
    const c = PENDING.get(tabId);
    if (c && new URL(info.url).origin !== c.origin) {
      invalidateNow(tabId);
      void queued(() => removeCandidate(c));
      return;
    }
    void (async () => {
      if (await ensureSession()) {
        const restored = PENDING.get(tabId);
        if (restored && new URL(updatedUrl).origin !== restored.origin) {
          invalidateNow(tabId);
          await queued(() => removeCandidate(restored));
        }
      }
    })();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('matrx.settings.v1' in changes || 'matrx.org.active' in changes)) {
      invalidateNow();
      void initializeAndPurge();
    }
  });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== EXPIRY_ALARM) return;
    void (async () => {
      if (!(await ensureSession())) return;
      await queued(async () => {
        for (const c of [...PENDING.values()]) if (c.expiresAt <= now()) await removeCandidate(c);
      });
    })();
  });
}

/** Test-only reset. */
export function _resetCaptureCandidates(clock?: () => number): void {
  for (const c of [...PENDING.values()]) drop(c);
  initialization = null;
  storageAvailable = true;
  now = clock ?? (() => Date.now());
}

/** Test seam: drops worker memory without touching session storage, as MV3 suspension does. */
export function _simulateCaptureWorkerRestartForTest(): void {
  for (const candidate of PENDING.values()) {
    if (candidate.promptTimer) clearTimeout(candidate.promptTimer);
    if (candidate.expiryTimer) clearTimeout(candidate.expiryTimer);
    candidate.password = null;
  }
  PENDING.clear();
  OPERATIONS.clear();
  initialization = null;
  mutationQueue = Promise.resolve();
  storageAvailable = true;
  registered = false;
}
