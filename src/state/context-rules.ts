/**
 * THE PERSON'S CONTEXT RULES, the chip's rows, and each turn's receipt.
 *
 * Contract: /Users/armanisadeghi/code/common-docs/systems/scopes-context/context-delivery/RULES.md §3, §5, §6.
 *
 * Saved rules live in ONE home — `users.user_surface_state`, feature
 * `context_rules`, one row per surface key — the same rows the web app writes
 * and the SERVER reads itself on every turn. Nothing here is a second copy:
 * this store mirrors the rows, writes each change immediately (queued per row
 * so the last change always wins), and every send awaits in-flight writes
 * before it builds its request. A failed write reloads the rows and says so.
 *
 * Per turn: the rows a request was built from are kept by run id; when the
 * server's `context_receipt` arrives, `compareReceipt` checks them and any
 * difference turns the chip amber and is filed as `context_truth_mismatch`.
 */

import { log } from '@/lib/debug/log';
import {
  isOrganizationNoMembershipsError,
  isOrganizationNotSelectedError,
  requireActiveOrganizationId,
} from '@/lib/org/active-org';
import { getSupabase } from '@/lib/supabase/client';
import { classifyDbFailure, recordDbFailure } from '@/lib/supabase/db-failure';
import { usersDb } from '@/lib/supabase/schemas';
import { mayReportExternalTelemetry } from '@/lib/telemetry/external-reporting';
import { useAuthStore } from '@/state/auth';
import { pushNotice } from '@/state/notices';
import {
  CONTEXT_RULES_FEATURE,
  type ContextReceipt,
  type ContextReceiptMismatch,
  type ContextRowSource,
  type ResolvedContextRow,
  type SavedContextRule,
  type SavedContextRuleRows,
  compareReceipt,
} from '@ai-matrx/agents/context';
import type { ContextReceiptData } from '@gen/stream-events';
import { create } from 'zustand';

export interface ReceiptEntry {
  receipt: ContextReceipt;
  mismatches: ContextReceiptMismatch[];
  receivedAt: number;
}

interface ContextRulesState {
  rows: SavedContextRuleRows;
  /** True once the rows were read from the database at least once. */
  loaded: boolean;
  /** The last read failed — the chip says so instead of reading as "no rules". */
  loadFailed: boolean;
  /** The values the chip previews for the next turn (read when it opens). */
  previewSources: ContextRowSource[] | null;
  previewing: boolean;
  /** Rows each run's request was built from (values stripped), by run id. */
  expectedByRun: Record<string, ResolvedContextRow[]>;
  /** The last receipt per conversation. */
  receiptByConversation: Record<string, ReceiptEntry>;
  /** The rows the LAST send used (values stripped) — shown until a preview is read. */
  lastSentRows: ResolvedContextRow[];
}

export const useContextRulesStore = create<ContextRulesState>(() => ({
  rows: {},
  loaded: false,
  loadFailed: false,
  previewSources: null,
  previewing: false,
  expectedByRun: {},
  receiptByConversation: {},
  lastSentRows: [],
}));

// ── Load ────────────────────────────────────────────────────────────────────

let loadInFlight: Promise<void> | null = null;

/** Read the person's rows (RLS is owner-only; no user filter needed). */
export function loadContextRules(force = false): Promise<void> {
  if (!force && useContextRulesStore.getState().loaded) return Promise.resolve();
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    try {
      const { data, error } = await usersDb()
        .from('user_surface_state')
        .select('surface_key, state')
        .eq('feature', CONTEXT_RULES_FEATURE);
      if (error) {
        void recordDbFailure(
          {
            table: 'users.user_surface_state',
            operation: 'select',
            what: 'read your context settings',
            title: 'Context settings not loaded',
          },
          classifyDbFailure(error),
          error,
        );
        throw new Error(error.message);
      }
      const rows: SavedContextRuleRows = {};
      for (const r of (data ?? []) as Array<{ surface_key: string; state: unknown }>) {
        rows[r.surface_key] = (r.state as Record<string, SavedContextRule>) ?? {};
      }
      useContextRulesStore.setState({ rows, loaded: true, loadFailed: false });
    } catch (err) {
      log.error('supabase', 'context rules read failed', err);
      useContextRulesStore.setState({ loadFailed: true });
    } finally {
      loadInFlight = null;
    }
  })();
  return loadInFlight;
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Per-row write chain: surfaceKey → the promise of its latest queued write. */
const rowChains = new Map<string, Promise<void>>();

function currentUserId(): string {
  const id = useAuthStore.getState().user?.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

function queueRowWrite(surfaceKey: string): Promise<void> {
  const previous = rowChains.get(surfaceKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      // The row's state AT WRITE TIME — coalesces every change queued behind
      // an in-flight write, so the database always ends on the last change.
      const latest = useContextRulesStore.getState().rows[surfaceKey] ?? {};
      try {
        let organizationId: string;
        try {
          organizationId = await requireActiveOrganizationId();
        } catch (err) {
          if (isOrganizationNotSelectedError(err) || isOrganizationNoMembershipsError(err)) {
            throw new Error(err.remedy);
          }
          throw err;
        }
        const { error } = await usersDb().from('user_surface_state').upsert(
          {
            user_id: currentUserId(),
            organization_id: organizationId,
            feature: CONTEXT_RULES_FEATURE,
            surface_key: surfaceKey,
            state: latest,
          },
          { onConflict: 'user_id,feature,surface_key' },
        );
        if (error) {
          void recordDbFailure(
            {
              table: 'users.user_surface_state',
              operation: 'insert',
              what: 'save your context setting',
              title: 'Context setting not saved',
            },
            classifyDbFailure(error),
            error,
          );
          throw new Error(error.message);
        }
      } catch (err) {
        log.error('supabase', 'context rule save failed — reloading the saved rules', err);
        pushNotice({
          tone: 'error',
          title: 'Context setting not saved',
          message: "Your context setting didn't save. Showing what's saved.",
          detail: err instanceof Error ? err.message : String(err),
        });
        await loadContextRules(true);
      }
    });
  rowChains.set(surfaceKey, next);
  void next.finally(() => {
    if (rowChains.get(surfaceKey) === next) rowChains.delete(surfaceKey);
  });
  return next;
}

/** Every send awaits this: the rules are loaded and no write is on its way. */
export async function ensureContextRulesReady(): Promise<void> {
  await Promise.all([...rowChains.values()]);
  await loadContextRules();
}

/**
 * Set (or with `rule: null`, reset) the person's rule for one value. The
 * screen updates at once; the write follows immediately.
 */
export function saveContextRule(
  surfaceKey: string,
  key: string,
  rule: SavedContextRule | null,
): Promise<void> {
  const rows = useContextRulesStore.getState().rows;
  const row: Record<string, SavedContextRule> = { ...(rows[surfaceKey] ?? {}) };
  if (rule === null || Object.keys(rule).length === 0) delete row[key];
  else row[key] = rule;
  useContextRulesStore.setState({ rows: { ...rows, [surfaceKey]: row } });
  return queueRowWrite(surfaceKey);
}

/** Reset every rule on one surface row (the chip's "reset all"). */
export function resetContextRules(surfaceKey: string): Promise<void> {
  const rows = useContextRulesStore.getState().rows;
  useContextRulesStore.setState({ rows: { ...rows, [surfaceKey]: {} } });
  return queueRowWrite(surfaceKey);
}

// ── Per-turn rows and the receipt ───────────────────────────────────────────

/** Record the rows a run's request was built from (values already stripped). */
export function rememberRunContextRows(runId: string, rows: ResolvedContextRow[]): void {
  useContextRulesStore.setState((s) => ({
    expectedByRun: { ...s.expectedByRun, [runId]: rows },
    lastSentRows: rows,
  }));
}

/** Normalize the generated wire type (optional fields) to the package's receipt. */
export function toContextReceipt(data: ContextReceiptData): ContextReceipt {
  return {
    version: 1,
    surface: data.surface ?? null,
    cap: data.cap,
    model_reads_context: data.model_reads_context !== false,
    rules_error: data.rules_error ?? null,
    rows: (data.rows ?? []).map((row) => ({
      key: row.key,
      label: row.label,
      surface_key: row.surface_key,
      origin: row.origin,
      chars: row.chars ?? null,
      include: row.include,
      max_inline_chars: row.max_inline_chars,
      delivery: row.delivery,
      decided_by: row.decided_by,
      user_rule: row.user_rule
        ? {
            ...(typeof row.user_rule.include === 'boolean'
              ? { include: row.user_rule.include }
              : {}),
            ...(typeof row.user_rule.max_inline_chars === 'number'
              ? { max_inline_chars: row.user_rule.max_inline_chars }
              : {}),
          }
        : null,
      clamped: row.clamped ?? false,
      client_sent_excluded: row.client_sent_excluded ?? false,
      blocked_by: row.blocked_by ?? null,
    })),
  };
}

/** Expected vs actual (RULES.md §6). Pure — the hooks call `recordContextReceipt`. */
export function checkContextReceipt(
  expected: readonly ResolvedContextRow[] | undefined,
  receipt: ContextReceipt,
): ContextReceiptMismatch[] {
  let mismatches = expected ? compareReceipt(expected, receipt).mismatches : [];
  // A model that reads no context received none of it — the truth, not a lie.
  if (!receipt.model_reads_context) {
    mismatches = mismatches.filter((m) => m.field !== 'delivery');
  }
  for (const row of receipt.rows) {
    if (row.client_sent_excluded) {
      mismatches.push({ key: row.key, field: 'include', expected: false, actual: 'sent' });
    }
  }
  if (receipt.rules_error) {
    mismatches.push({
      key: '*',
      field: 'user_rule',
      expected: 'read',
      actual: receipt.rules_error,
    });
  }
  return mismatches;
}

/** True when a stream `data` payload is the server's context receipt. */
export function isContextReceiptData(data: unknown): data is ContextReceiptData {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === 'context_receipt' &&
    typeof (data as { cap?: unknown }).cap === 'number'
  );
}

/** Store a run's receipt and run the expected-vs-actual check; mismatches are loud. */
export function recordContextReceipt(
  runId: string,
  conversationId: string | null,
  data: ContextReceiptData,
): ReceiptEntry {
  const receipt = toContextReceipt(data);
  const expected = useContextRulesStore.getState().expectedByRun[runId];
  const mismatches = checkContextReceipt(expected, receipt);
  const entry: ReceiptEntry = { receipt, mismatches, receivedAt: Date.now() };
  useContextRulesStore.setState((s) => {
    const { [runId]: _done, ...rest } = s.expectedByRun;
    return {
      expectedByRun: rest,
      receiptByConversation: conversationId
        ? { ...s.receiptByConversation, [conversationId]: entry }
        : s.receiptByConversation,
    };
  });
  if (mismatches.length > 0) {
    const summary = mismatches
      .slice(0, 6)
      .map(
        (m) =>
          `${m.key}.${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`,
      )
      .join('; ');
    log.error('stream', `context_truth_mismatch (${mismatches.length}): ${summary}`, {
      code: 'context_truth_mismatch',
      conversation_id: conversationId,
      mismatches,
      surface: receipt.surface,
    });
    void fileContextTruthMismatch(conversationId, summary, mismatches);
  }
  return entry;
}

/** File the mismatch in the platform's client-error store (`log_client_error`). */
async function fileContextTruthMismatch(
  conversationId: string | null,
  summary: string,
  mismatches: ContextReceiptMismatch[],
): Promise<void> {
  try {
    if (!(await mayReportExternalTelemetry())) return;
    let organizationId: string | undefined;
    try {
      const { getActiveOrganizationId } = await import('@/lib/org/active-org');
      organizationId = (await getActiveOrganizationId()) ?? undefined;
    } catch {
      organizationId = undefined;
    }
    const { data, error } = await getSupabase().rpc('log_client_error', {
      p_source_app: 'matrx-extend',
      p_source_feature: 'agents-other',
      p_source: 'chrome-extension',
      p_message: `Context sent differently than shown (${mismatches.length}): ${summary}`.slice(
        0,
        2000,
      ),
      p_code: 'context_truth_mismatch',
      p_route: 'chat',
      p_context: {
        client: 'matrx-extend',
        conversation_id: conversationId,
        mismatches: mismatches.slice(0, 50),
      },
      ...(organizationId !== undefined && { p_organization_id: organizationId }),
    });
    if (error || typeof data !== 'string' || data.length === 0) {
      log.error('stream', 'context_truth_mismatch was NOT recorded in the platform error store', {
        error: error ?? 'RPC returned no error id',
        summary,
      });
    }
  } catch (err) {
    log.error('stream', 'context_truth_mismatch report threw', err);
  }
}
