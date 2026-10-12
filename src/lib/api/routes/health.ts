import { getApiBaseUrl, withSchema } from '@/lib/api/client';
import { runOpAs } from '@/lib/api/matrx-api';
import { detailedHealthCheck, healthCheck as healthCheckOp } from '@ai-matrx/api/architecture';
import { log } from '@/lib/debug/log';
import { z } from 'zod';

export const HealthSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  timestamp: z.string().optional(),
});
export type Health = z.infer<typeof HealthSchema>;

export async function healthCheck() {
  // No trailing slash — `/health/` 307s to `/health` and burns a round trip.
  const r = await runOpAs<unknown>((api, o) => healthCheckOp(api, undefined, o), { silent: true });
  return withSchema(r, HealthSchema);
}

export async function healthCheckDetailed() {
  return runOpAs<Record<string, unknown>>((api, o) => detailedHealthCheck(api, undefined, o));
}

/**
 * Run a health check and log the result prominently in the Debug tab.
 * Use this on:
 *   - app boot (sidepanel mount, after session restore)
 *   - every backend URL / env switch
 *   - the manual health-check button
 */
export async function pingHealth(reason: string): Promise<Health | null> {
  const baseUrl = await getApiBaseUrl();
  log.info('api', `health check (${reason}) → ${baseUrl}/health`);
  const r = await healthCheck();
  if (r.ok) {
    log.success('api', `health ok — ${baseUrl} — ${r.data.status}`, r.data);
    return r.data;
  }
  return null;
}
