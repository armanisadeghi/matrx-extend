/**
 * The ONE error seam for this extension's Supabase reads and writes.
 *
 * ## The class of defect this closes (DD-092)
 *
 * Every dataset/capture/highlight query in this repo used to end its error path
 * the same way:
 *
 *     if (error) { console.warn('[x] failed', error.message); return null; }   // or `[]`
 *
 * Three things are wrong with that, and all three hurt the same non-technical
 * user:
 *   1. A database REFUSAL (RLS `42501`, a relation that does not exist,
 *      a write whose RETURNING row RLS filtered away) is indistinguishable
 *      from "nothing to show". The user sees an empty list or a button that
 *      snaps back, and concludes the app is fine.
 *   2. Nobody ever hears about it. `console.warn` goes to a devtools console
 *      nobody has open — the platform's error store never learns the write
 *      was refused.
 *   3. `return []` on a failed READ and `return null` on a failed WRITE are
 *      SUCCESS-SHAPED: callers happily carry on, mark things saved, and drop
 *      the user's data.
 *
 * So: classify the failure, say a true sentence to the user, record it durably,
 * and throw. Never a success-shaped empty value for a failed call.
 *
 * ## Where the durable record goes
 *
 * `public.log_client_error` — the platform's EXISTING client-error RPC (the
 * same one matrx-frontend's Error Inspector uses, see
 * `matrx-frontend/lib/diagnostics/persistCapturedErrors.ts`). It is
 * SECURITY DEFINER and inserts into `ops.system_error`, which is what the
 * `errors` / `app_log_errors` MCP surfaces read. No new mechanism, no new
 * table, no new endpoint.
 *
 * Known residue (2026-09-11): that RPC hardcodes `source_app='matrx-frontend'`,
 * so extension rows land under the frontend's app name. We distinguish them by
 * `kind` (`p_source`), which we set to `chrome-extension`. Fixing `source_app`
 * needs a migration on a shared RPC — filed in the B-13 report, not done here.
 *
 * ## Usage
 *
 *     const { data, error } = await extendDb().from('wbx_capture').insert(row).select('id').single();
 *     if (error || !data) {
 *       await failDbCall({ table: 'extend.wbx_capture', operation: 'insert', what: 'save this page capture' }, error);
 *     }
 *
 * `failDbCall` NEVER returns — it throws `DbFailureError` after showing the
 * notice and recording the error.
 */

import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import { pushNotice } from '@/state/notices';

/** What kind of failure the database actually reported. */
export type DbFailureKind =
  /** RLS said no: 42501, or a write whose RETURNING row came back empty. */
  | 'refused'
  /** The table/view/function is not there: 42P01 / PGRST205 / PGRST202. */
  | 'missing_relation'
  /** Not signed in — PostgREST rejected the JWT. */
  | 'not_authenticated'
  /** Could not reach the database at all (offline, DNS, CORS). */
  | 'unreachable'
  /** No workspace (organization) is selected, so the call was never sent. */
  | 'no_workspace'
  /** Anything else the database reported. */
  | 'failed';

export interface DbCallSite {
  /** `schema.table` or `rpc:function_name` — used in the durable record. */
  table: string;
  /** `select` | `insert` | `update` | `delete` | `rpc`. */
  operation: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
  /**
   * What the USER was trying to do, as a verb phrase that completes
   * "AI Matrx could not ___". e.g. "save this page capture".
   */
  what: string;
  /** Short headline for the notice. e.g. "Page capture not saved". */
  title: string;
}

/** Minimal shape of a PostgREST error — we never depend on the SDK's class. */
export interface DbErrorLike {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export class DbFailureError extends Error {
  readonly kind: DbFailureKind;
  readonly code: string | null;
  readonly site: DbCallSite;
  /** The exact sentence shown to the user. Callers may re-render it. */
  readonly userMessage: string;
  /** Error code + message as the database phrased it. Admin surfaces only. */
  readonly technical: string;

  constructor(params: {
    kind: DbFailureKind;
    code: string | null;
    site: DbCallSite;
    userMessage: string;
    technical: string;
  }) {
    super(params.userMessage);
    this.name = 'DbFailureError';
    this.kind = params.kind;
    this.code = params.code;
    this.site = params.site;
    this.userMessage = params.userMessage;
    this.technical = params.technical;
  }
}

export function isDbFailureError(err: unknown): err is DbFailureError {
  return err instanceof DbFailureError;
}

/**
 * Classify a PostgREST/Supabase error. `null` means "no error object, but the
 * call produced no row" — the RLS empty-on-write case, which IS a refusal.
 */
export function classifyDbFailure(error: DbErrorLike | null | undefined): DbFailureKind {
  if (!error) return 'refused';
  const code = (error.code ?? '').toUpperCase();
  const msg = (error.message ?? '').toLowerCase();

  if (code === 'NO_ORGANIZATION') return 'no_workspace';

  if (code === '42501' || /permission denied|row-level security|violates row-level/.test(msg)) {
    return 'refused';
  }
  // PGRST116 = "JSON object requested, multiple (or no) rows returned" — on a
  // write with `.single()` that is RLS filtering the RETURNING row away.
  if (code === 'PGRST116') return 'refused';
  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    /relation .* does not exist|could not find the (table|function)|schema cache/.test(msg)
  ) {
    return 'missing_relation';
  }
  if (code === 'PGRST301' || code === '42704' || /jwt|not authenticated|invalid token/.test(msg)) {
    return 'not_authenticated';
  }
  if (/failed to fetch|networkerror|network request failed|load failed/.test(msg)) {
    return 'unreachable';
  }
  return 'failed';
}

/**
 * The human sentence. Every branch says what happened AND what to do — a
 * notice with no remedy is a dead end for a non-technical user.
 */
export function userMessageFor(kind: DbFailureKind, site: DbCallSite): string {
  // A read and a write need different reassurance: "nothing was saved" is a
  // lie on a read, and "nothing is shown" is a lie on a write.
  const outcome =
    site.operation === 'select'
      ? 'Nothing is being shown for it — this is NOT an empty result.'
      : 'Nothing was saved.';
  switch (kind) {
    case 'refused':
      return `AI Matrx could not ${site.what}: the database refused the request because your account is not allowed to do it in this workspace. ${outcome} Check that you are in the right workspace from the account menu, then try again — if it keeps happening, ask a workspace admin for access.`;
    case 'missing_relation':
      return `AI Matrx could not ${site.what}: the data table this feature needs is not available in the database. ${outcome} Retrying will not help — this one is ours to fix, and it has been reported automatically.`;
    case 'no_workspace':
      return `AI Matrx could not ${site.what}: no workspace is selected, so the request was never sent. ${outcome} Pick a workspace from the account menu and try again.`;
    case 'not_authenticated':
      return `AI Matrx could not ${site.what}: your sign-in has expired. ${outcome} Open the account menu, sign in again, and repeat what you were doing.`;
    case 'unreachable':
      return `AI Matrx could not ${site.what}: the database could not be reached. ${outcome} Check your internet connection and try again.`;
    default:
      return `AI Matrx could not ${site.what}: the database rejected the request. ${outcome} Try again — if it keeps happening, it has already been reported to us automatically.`;
  }
}

/** Recursion guard — a failure of the reporting RPC never reports itself. */
let reporting = false;

/**
 * Record the failure in the platform's canonical client-error store via the
 * existing `log_client_error` RPC. Best-effort and never throws: reporting a
 * problem must never become a second problem.
 */
export async function recordDbFailure(
  site: DbCallSite,
  kind: DbFailureKind,
  error: DbErrorLike | null | undefined,
): Promise<void> {
  if (reporting) return;
  reporting = true;
  try {
    let organizationId: string | undefined;
    try {
      const { getActiveOrganizationId } = await import('@/lib/org/active-org');
      organizationId = (await getActiveOrganizationId()) ?? undefined;
    } catch {
      organizationId = undefined;
    }
    await getSupabase().rpc('log_client_error', {
      p_source: 'chrome-extension',
      p_message: `${site.operation} ${site.table} ${kind}: ${error?.message ?? 'no rows returned'}`,
      p_code: error?.code ?? kind,
      p_route: site.table,
      p_context: {
        client: 'matrx-extend',
        kind,
        table: site.table,
        operation: site.operation,
        what: site.what,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
      },
      ...(organizationId !== undefined && { p_organization_id: organizationId }),
    });
  } catch (err) {
    // The error channel itself is down. Say so locally; do not recurse.
    log.warn('supabase', 'could not record db failure to the platform error store', err);
  } finally {
    reporting = false;
  }
}

/**
 * Announce + record a database failure, then THROW. Never returns.
 *
 * Reporting is fired without awaiting so a slow error store never delays the
 * user-visible failure; the promise is caught inside `recordDbFailure`.
 */
export function failDbCall(site: DbCallSite, error: DbErrorLike | null | undefined): never {
  const kind = classifyDbFailure(error);
  const userMessage = userMessageFor(kind, site);
  const technical = `${error?.code ?? kind}: ${error?.message ?? 'no rows returned'}`;

  log.error('supabase', `${site.operation} ${site.table} → ${kind}`, {
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
  });
  pushNotice({
    tone: 'error',
    title: site.title,
    message: userMessage,
    detail: `${site.operation} ${site.table} · ${technical}`,
  });
  void recordDbFailure(site, kind, error);

  throw new DbFailureError({ kind, code: error?.code ?? null, site, userMessage, technical });
}
