/**
 * The ONE door from this extension into the platform's client-error store:
 * `public.log_client_error` → `ops.system_error` (the `errors` MCP surface).
 * `recordDbFailure` and every non-database failure (a stream answer we could
 * not read, a save that stopped) go through here, so `source_app` is always
 * `matrx-extend` and the returned row id can be shown to the person as a
 * reference.
 */

import { getSupabase } from '@/lib/supabase/client';
import { mayReportExternalTelemetry } from '@/lib/telemetry/external-reporting';

export interface ClientErrorReport {
  /** Registered `source_feature` slug (`social`, `web-capture`, …). */
  feature: string;
  message: string;
  code: string;
  route: string;
  /** Server `X-Request-ID` of the call that failed: joins this row to the server's own. */
  requestId?: string;
  context: Record<string, unknown>;
  /** Defaults to the active organization. */
  organizationId?: string;
}

/**
 * Write one row and return its id. Returns null only when the person declined
 * diagnostics (Firefox); THROWS when the store could not record it, so callers
 * decide how loudly to say "this exists only in the local log".
 */
export async function recordClientError(report: ClientErrorReport): Promise<string | null> {
  if (!(await mayReportExternalTelemetry())) return null;
  let organizationId = report.organizationId;
  if (organizationId === undefined) {
    try {
      const { getActiveOrganizationId } = await import('@/lib/org/active-org');
      organizationId = (await getActiveOrganizationId()) ?? undefined;
    } catch {
      organizationId = undefined;
    }
  }
  const { data, error } = await getSupabase().rpc('log_client_error', {
    // DD-115: the value is checked against a closed list inside the database.
    p_source_app: 'matrx-extend',
    p_source_feature: report.feature,
    p_source: 'chrome-extension',
    p_message: report.message,
    p_code: report.code,
    p_route: report.route,
    ...(report.requestId !== undefined && { p_request_id: report.requestId }),
    p_context: { client: 'matrx-extend', ...report.context },
    ...(organizationId !== undefined && { p_organization_id: organizationId }),
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || data.length === 0)
    throw new Error('log_client_error returned no error id');
  return data;
}
