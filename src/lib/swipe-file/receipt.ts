import { z } from 'zod';

export const SocialPostMediaSchema = z.object({
  file_id: z.string(),
  role: z.string(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  door: z.string(),
});
export type SocialPostMedia = z.infer<typeof SocialPostMediaSchema>;

export const SwipeCaptureReceiptSchema = z.object({
  postId: z.string(),
  organizationId: z.string(),
  platform: z.string(),
  capturedAt: z.string(),
  media: z.array(SocialPostMediaSchema),
  mediaNotes: z.array(z.string()),
  transcript: z.object({
    status: z.enum(['available', 'none', 'unknown']),
    notes: z.array(z.string()),
  }),
  reused: z.boolean(),
});
export type SwipeCaptureReceipt = z.infer<typeof SwipeCaptureReceiptSchema>;
const receiptKey = (postId: string) => `matrx.swipe.receipt.${postId}`;

/** Diagnostic metadata only; canonical content is always read from the platform. */
export async function writeSwipeReceipt(receipt: SwipeCaptureReceipt): Promise<void> {
  await chrome.storage.local.set({ [receiptKey(receipt.postId)]: receipt });
}

export async function readSwipeReceipt(postId: string): Promise<SwipeCaptureReceipt | null> {
  const key = receiptKey(postId);
  const rows = await chrome.storage.local.get(key);
  const parsed = SwipeCaptureReceiptSchema.safeParse(rows[key]);
  return parsed.success ? parsed.data : null;
}

/** Observations, never a claim that every original asset was archived. */
export function captureReceiptSummary(receipt: SwipeCaptureReceipt): string {
  if (receipt.platform === 'youtube') return 'YouTube playback · video not archived';
  const media = receipt.media.filter((m) => m.role !== 'thumbnail');
  return media.length
    ? `${media.length} stored ${media.length === 1 ? 'file' : 'files'}`
    : 'No stored media';
}

export function captureReceiptWarnings(receipt: SwipeCaptureReceipt): string[] {
  return [
    ...new Set([
      ...receipt.mediaNotes,
      ...receipt.transcript.notes,
      ...(receipt.transcript.status === 'none' ? ['Transcript unavailable'] : []),
      ...(receipt.transcript.status === 'unknown' ? ['Transcript status unavailable'] : []),
    ]),
  ];
}
