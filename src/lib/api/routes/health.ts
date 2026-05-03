import { apiGet, getApiBaseUrl, withSchema } from '@/lib/api/client';
import { log } from '@/lib/debug/log';
import { z } from 'zod';

export const HealthSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  timestamp: z.string().optional(),
});
export type Health = z.infer<typeof HealthSchema>;

export async function healthCheck() {
  const r = await apiGet<unknown>('/health/', undefined, { silent: true });
  return withSchema(r, HealthSchema);
}

export async function healthCheckDetailed() {
  return apiGet<Record<string, unknown>>('/health/detailed');
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
  log.info('api', `health check (${reason}) → ${baseUrl}/health/`);
  const r = await healthCheck();
  if (r.ok) {
    log.success('api', `health ok — ${baseUrl} — ${r.data.status}`, r.data);
    return r.data;
  }
  return null;
}
