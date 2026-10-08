/**
 * Durability layer for the SW tool dispatcher (docs/AUDIT_2026_06_10.md
 * P0-4 / P0-5).
 *
 * MV3 service workers are reaped after ~30s idle and restarted on the next
 * event. Before this module, two pieces of dispatcher state lived only in SW
 * memory and died with it:
 *
 *   1. The per-run metadata map (conversationId, permissionMode,
 *      assignedTabId, domain-trust set). A restart mid-stream meant the next
 *      `tool_delegated` chunk found nothing: the tool result could never be
 *      POSTed (the agent hung forever), act-mode silently downgraded to ask,
 *      and the agent lost its pinned tab.
 *   2. Pending confirmation requests. The approval card kept showing in the
 *      sidepanel, but the in-memory Promise + listener were gone — clicking
 *      Allow did nothing and the run was stuck.
 *
 * Run metadata and pending confirmations use `chrome.storage.session`: they
 * survive SW restarts but end with the browser session. Remembered approvals
 * use actor/conversation-scoped `chrome.storage.local`, because the saved chat
 * outlives browser and extension reloads. Everything here is best-effort —
 * a storage failure degrades to the old in-memory-only behaviour, never
 * blocks dispatch.
 */

import type { ClientToolResultBody } from '@/lib/api/routes/tool-results';
import { getCurrentUser } from '@/lib/auth/flow';
import { getOrCreateGuestSignature } from '@/lib/auth/guest-signature';
import { log } from '@/lib/debug/log';
import type { ConfirmInitiator, NetworkCaptureApprovalPreview, ToolTier } from '@/lib/tools/types';

const RUNS_KEY = 'matrx.dispatch.runs';
const CONFIRMS_KEY = 'matrx.dispatch.pendingConfirms';

/** Drop persisted run rows older than this — nothing useful survives 6h. */
const RUN_TTL_MS = 6 * 60 * 60 * 1000;
/** Hard cap on persisted runs (oldest evicted first). */
const RUNS_MAX = 50;

/** JSON-safe mirror of the dispatcher's RunMeta (Set → array). */
export interface PersistedRunMeta {
  conversationId: string | null;
  requestId: string | null;
  permissionMode: 'ask' | 'act';
  agentName: string | null;
  trustedHosts: string[];
  assignedTabId: number | null;
  updatedAt: number;
}

/**
 * Everything needed to resume (or fail-closed) a confirmation after the SW
 * that broadcast it has been reaped. `args` is the schema-parsed payload —
 * JSON-serializable by construction (it crossed the wire as JSON).
 */
export interface PersistedPendingConfirm {
  callId: string;
  toolName: string;
  args: unknown;
  conversationId: string | null;
  runId: string;
  agentName: string | null;
  permissionMode: 'ask' | 'act';
  assignedTabId: number | null;
  effectiveTier: ToolTier;
  /** Prepared operation approval, bound to actual tool + snapshot. */
  preparedOperation?: {
    snapshotKey: string;
    delivery: 'agent' | 'local';
    approvalPreview?: NetworkCaptureApprovalPreview;
  };
  initiator: ConfirmInitiator;
  /** Absolute deadline — mirrors the in-memory 5-minute timeout. */
  expiresAt: number;
}

function sessionStore(): chrome.storage.StorageArea | null {
  try {
    return chrome?.storage?.session ?? null;
  } catch {
    return null;
  }
}

/* ── Run metadata ─────────────────────────────────────────────────── */

// Every run shares RUNS_KEY, including prune removals. Keep each complete
// read/modify/write together so parallel children and stream-open updates
// cannot overwrite one another's restart metadata.
let runMutation: Promise<void> = Promise.resolve();
export function persistRunMeta(runId: string, meta: PersistedRunMeta): Promise<void> {
  const write = () => persistRunMetaUnlocked(runId, meta);
  const result = runMutation.then(write, write);
  runMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function persistRunMetaUnlocked(runId: string, meta: PersistedRunMeta): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  try {
    const all = await readRuns(store);
    all[runId] = meta;
    pruneRuns(all);
    await store.set({ [RUNS_KEY]: all });
  } catch (err) {
    log.warn('sw', `persistRunMeta failed for ${runId}`, (err as Error)?.message);
  }
}

export async function loadRunMeta(runId: string): Promise<PersistedRunMeta | null> {
  // A lookup after a fire-and-forget mirror observes that mirror, rather
  // than temporarily treating the newly assigned run as unknown.
  await runMutation;
  const store = sessionStore();
  if (!store) return null;
  try {
    const all = await readRuns(store);
    return all[runId] ?? null;
  } catch {
    return null;
  }
}

async function readRuns(
  store: chrome.storage.StorageArea,
): Promise<Record<string, PersistedRunMeta>> {
  const r = await store.get([RUNS_KEY]);
  const raw = r[RUNS_KEY];
  return raw && typeof raw === 'object' ? (raw as Record<string, PersistedRunMeta>) : {};
}

function pruneRuns(all: Record<string, PersistedRunMeta>): void {
  const now = Date.now();
  const entries = Object.entries(all);
  for (const [id, meta] of entries) {
    if (now - (meta.updatedAt ?? 0) > RUN_TTL_MS) delete all[id];
  }
  const remaining = Object.entries(all);
  if (remaining.length > RUNS_MAX) {
    remaining
      .sort((a, b) => (a[1].updatedAt ?? 0) - (b[1].updatedAt ?? 0))
      .slice(0, remaining.length - RUNS_MAX)
      .forEach(([id]) => delete all[id]);
  }
}

/* ── Conversation trust ("allow for the rest of this chat") ───────── */

const TRUST_KEY = 'matrx.dispatch.conversationTrust';
function trustStore(): chrome.storage.StorageArea | null {
  try {
    return chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

async function conversationTrustKey(conversationId: string): Promise<string> {
  const user = await getCurrentUser();
  const actor = user ? `user:${user.id}` : `guest:${await getOrCreateGuestSignature()}`;
  return JSON.stringify([actor, conversationId]);
}

/** One remembered approval: this tool on this host. */
export function trustEntry(toolName: string, host: string): string {
  return `${toolName}@${host}`;
}

/**
 * The approvals a person ticked "for the rest of this chat". Keyed by
 * conversation, not run: every continuation after a tool result is a NEW run,
 * so a run-scoped set forgot the choice on the very next tool call. The actor
 * scope keeps a shared saved chat from borrowing another person's choice.
 */
export async function loadConversationTrust(conversationId: string): Promise<string[]> {
  await trustMutation;
  const store = trustStore();
  if (!store) return [];
  try {
    const key = await conversationTrustKey(conversationId);
    return (await readTrust(store))[key]?.entries ?? [];
  } catch {
    return [];
  }
}

// Trust shares one storage key across conversations; serialize the entire
// read/modify/write so simultaneous approval clicks cannot replace each other.
let trustMutation: Promise<void> = Promise.resolve();
export function addConversationTrust(conversationId: string, entry: string): Promise<void> {
  // Capture who clicked before this write joins the queue; an account switch
  // while another write is finishing must not attribute their choice anew.
  const key = conversationTrustKey(conversationId);
  const write = async () => {
    try {
      await addConversationTrustUnlocked(await key, entry);
    } catch (err) {
      log.warn('sw', 'addConversationTrust identity unavailable', (err as Error)?.message);
    }
  };
  const result = trustMutation.then(write, write);
  trustMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function addConversationTrustUnlocked(key: string, entry: string): Promise<void> {
  const store = trustStore();
  if (!store) return;
  try {
    const all = await readTrust(store);
    const prev = all[key]?.entries ?? [];
    all[key] = {
      entries: prev.includes(entry) ? prev : [...prev, entry],
      updatedAt: Date.now(),
    };
    await store.set({ [TRUST_KEY]: all });
  } catch (err) {
    log.warn('sw', 'addConversationTrust failed', (err as Error)?.message);
  }
}

async function readTrust(
  store: chrome.storage.StorageArea,
): Promise<Record<string, { entries: string[]; updatedAt: number }>> {
  const r = await store.get([TRUST_KEY]);
  const raw = r[TRUST_KEY];
  return raw && typeof raw === 'object'
    ? (raw as Record<string, { entries: string[]; updatedAt: number }>)
    : {};
}

/* ── Pending confirmations ────────────────────────────────────────── */

let confirmMutation: Promise<unknown> = Promise.resolve();
function mutateConfirms<T>(write: () => Promise<T>): Promise<T> {
  const result = confirmMutation.then(write, write);
  confirmMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
export function persistPendingConfirm(record: PersistedPendingConfirm): Promise<void> {
  return mutateConfirms(() => persistPendingConfirmUnlocked(record));
}
export function removePendingConfirm(callId: string): Promise<void> {
  return mutateConfirms(() => removePendingConfirmUnlocked(callId));
}
export function takePendingConfirm(callId: string): Promise<PersistedPendingConfirm | null> {
  return mutateConfirms(() => takePendingConfirmUnlocked(callId));
}

async function persistPendingConfirmUnlocked(record: PersistedPendingConfirm): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  try {
    const all = await readConfirms(store);
    all[record.callId] = record;
    await store.set({ [CONFIRMS_KEY]: all });
  } catch (err) {
    log.warn('sw', `persistPendingConfirm failed for ${record.callId}`, (err as Error)?.message);
  }
}

async function removePendingConfirmUnlocked(callId: string): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  try {
    const all = await readConfirms(store);
    if (!(callId in all)) return;
    delete all[callId];
    await store.set({ [CONFIRMS_KEY]: all });
  } catch {
    /* best-effort */
  }
}

/**
 * Atomically claim a persisted confirm (read + delete). Returns null when no
 * record exists — i.e. either it was never persisted or another path already
 * claimed it. Used by the post-restart recovery listener so a response can't
 * execute twice.
 */
async function takePendingConfirmUnlocked(callId: string): Promise<PersistedPendingConfirm | null> {
  const store = sessionStore();
  if (!store) return null;
  try {
    const all = await readConfirms(store);
    const rec = all[callId];
    if (!rec) return null;
    delete all[callId];
    await store.set({ [CONFIRMS_KEY]: all });
    return rec;
  } catch {
    return null;
  }
}

export async function listPendingConfirms(): Promise<PersistedPendingConfirm[]> {
  const store = sessionStore();
  if (!store) return [];
  try {
    const all = await readConfirms(store);
    return Object.values(all);
  } catch {
    return [];
  }
}

/* ── Undelivered tool results (audit P1-4) ───────────────────────── */

const RESULTS_KEY = 'matrx.dispatch.undeliveredResults';
const RESULT_TTL_MS = 60 * 60 * 1000;
const RESULTS_MAX = 20;
const RESULT_MAX_ATTEMPTS = 5;

/**
 * A tool result whose POST exhausted its retries. The server hard-suspends
 * the turn waiting for this call_id, so dropping it stranded the
 * conversation until the user manually sent another message. Persisted so
 * the next SW boot can re-deliver — the server's `already_resolved` dedupe
 * makes a replay of a secretly-successful POST harmless.
 */
export interface UndeliveredResult {
  conversationId: string;
  /** The exact body POSTed to tool_results — one type, so a re-delivery can never drift from it. */
  result: ClientToolResultBody;
  at: number;
  attempts: number;
}

export async function enqueueUndeliveredResult(
  entry: Omit<UndeliveredResult, 'at' | 'attempts'>,
): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  try {
    const all = await readResults(store);
    // De-dupe by call_id — a second permanent failure for the same call
    // replaces (bumps) rather than duplicates.
    const existing = all.findIndex((e) => e.result.call_id === entry.result.call_id);
    const row: UndeliveredResult = {
      ...entry,
      at: Date.now(),
      attempts: existing >= 0 ? (all[existing]?.attempts ?? 0) + 1 : 1,
    };
    if (existing >= 0) all[existing] = row;
    else all.push(row);
    while (all.length > RESULTS_MAX) all.shift();
    await store.set({ [RESULTS_KEY]: all });
  } catch (err) {
    log.warn('sw', 'enqueueUndeliveredResult failed', (err as Error)?.message);
  }
}

/** Claim the full replayable queue (fresh, under attempt cap); stale rows drop. */
export async function takeUndeliveredResults(): Promise<UndeliveredResult[]> {
  const store = sessionStore();
  if (!store) return [];
  try {
    const all = await readResults(store);
    if (all.length === 0) return [];
    await store.set({ [RESULTS_KEY]: [] });
    const now = Date.now();
    return all.filter((e) => now - e.at <= RESULT_TTL_MS && e.attempts <= RESULT_MAX_ATTEMPTS);
  } catch {
    return [];
  }
}

async function readResults(store: chrome.storage.StorageArea): Promise<UndeliveredResult[]> {
  const r = await store.get([RESULTS_KEY]);
  const raw = r[RESULTS_KEY];
  return Array.isArray(raw) ? (raw as UndeliveredResult[]) : [];
}

async function readConfirms(
  store: chrome.storage.StorageArea,
): Promise<Record<string, PersistedPendingConfirm>> {
  const r = await store.get([CONFIRMS_KEY]);
  const raw = r[CONFIRMS_KEY];
  return raw && typeof raw === 'object' ? (raw as Record<string, PersistedPendingConfirm>) : {};
}
