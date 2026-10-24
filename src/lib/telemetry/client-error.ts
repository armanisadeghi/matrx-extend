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
import { type FunctionDescriptor, call, createDb } from '@ai-matrx/data/db';

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

type LogClientErrorArgs = {
  p_source_app: 'matrx-extend';
  p_source_feature: string;
  p_source: 'chrome-extension';
  p_message: string;
  p_code: string;
  p_route: string;
  p_request_id?: string;
  p_context: Record<string, unknown>;
  p_organization_id?: string;
};

const LOG_CLIENT_ERROR = {
  schema: 'public',
  name: 'log_client_error',
  roles: ['anon', 'authenticated', 'service_role'],
  registered: true,
} as FunctionDescriptor<LogClientErrorArgs, string>;

function databaseMessage(error: unknown): string {
  const wrapped = error as { name?: string; cause?: { message?: string }; message?: string } | null;
  if (wrapped?.name === 'DatabaseError' && wrapped.cause?.message) return wrapped.cause.message;
  return error instanceof Error ? error.message : String(error);
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
  const args: LogClientErrorArgs = {
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
  };
  let data: string;
  try {
    data = await call(createDb({ client: getSupabase() }), LOG_CLIENT_ERROR, args);
  } catch (error) {
    throw new Error(databaseMessage(error));
  }
  if (typeof data !== 'string' || data.length === 0)
    throw new Error('log_client_error returned no error id');
  return data;
}
