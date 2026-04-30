import { apiGet, withSchema } from '@/lib/api/client';
import { z } from 'zod';

export const HealthSchema = z.object({
  status: z.string(),
  service: z.string(),
  timestamp: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

export async function healthCheck() {
  const r = await apiGet<unknown>('/health/');
  return withSchema(r, HealthSchema);
}

export async function healthCheckDetailed() {
  return apiGet<Record<string, unknown>>('/health/detailed');
}
