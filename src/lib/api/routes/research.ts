/**
 * Subset of /research/* used by the Tasks tab + scrape submission.
 * Full surface lives in matrx-chrome/utils/api-client.ts; we'll port more
 * as features land. Endpoint paths are stable.
 */

import { apiGet, apiPatch, apiPost, withSchema } from '@/lib/api/client';
import { z } from 'zod';

export const ScrapeQueueItemSchema = z.object({
  id: z.string().uuid().optional(),
  topic_id: z.string().uuid(),
  source_id: z.string().uuid(),
  url: z.string().url(),
  status: z.string().optional(),
  created_at: z.string().optional(),
  topic_name: z.string().optional(),
  notes: z.string().optional(),
});
export type ScrapeQueueItem = z.infer<typeof ScrapeQueueItemSchema>;

export async function getExtensionScrapeQueue() {
  const r = await apiGet<unknown>('/research/extension/scrape-queue');
  return withSchema(r, z.array(ScrapeQueueItemSchema));
}

export async function submitExtensionContent(
  topicId: string,
  sourceId: string,
  htmlContent: string,
) {
  return apiPost<{ status: string; source_id: string }>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}/extension-content`,
    { html_content: htmlContent },
  );
}

export const ResearchSourceSchema = z.object({
  id: z.string().uuid(),
  topic_id: z.string().uuid(),
  url: z.string().url(),
  hostname: z.string().optional(),
  scrape_status: z.string().optional(),
  is_included: z.boolean().optional(),
  source_type: z.string().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export async function updateSource(
  topicId: string,
  sourceId: string,
  updates: Partial<ResearchSource>,
) {
  return apiPatch<ResearchSource>(
    `/research/topics/${encodeURIComponent(topicId)}/sources/${encodeURIComponent(sourceId)}`,
    updates,
  );
}
