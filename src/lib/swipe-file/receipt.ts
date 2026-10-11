import { z } from 'zod';

export const SocialPostMediaSchema = z.object({
  file_id: z.string(),
  role: z.string(),
  source_index: z.number().int().nonnegative().nullable().optional(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  door: z.string(),
});
export type SocialPostMedia = z.infer<typeof SocialPostMediaSchema>;

export const MediaCoverageSchema = z.object({
  expected_items: z.number().int().nonnegative().nullable(),
  observed_items: z.number().int().nonnegative(),
  stored_items: z.number().int().nonnegative(),
  missing_items: z.number().int().nonnegative().nullable(),
  status: z.enum(['complete', 'partial', 'unknown', 'embed', 'not_requested']),
  browser_capture: z
    .object({
      status: z.enum(['pending', 'complete', 'partial']),
      observed_items: z.number().int().nonnegative(),
      stored_items: z.number().int().nonnegative(),
      failed_items: z.number().int().nonnegative(),
      notes: z.array(z.string()),
    })
    .nullish(),
});
export type MediaCoverage = z.infer<typeof MediaCoverageSchema>;

export const SwipeCaptureReceiptSchema = z.object({
  postId: z.string(),
  url: z.string().optional(),
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
  /** The post's shape as the server reads it ("carousel", "video"...). */
  format: z.string().nullish(),
  coverage: MediaCoverageSchema.optional(),
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

const isCarousel = (r: SwipeCaptureReceipt) => r.format === 'carousel';

/** Observations, never a claim that every original asset was archived. */
export function captureReceiptSummary(receipt: SwipeCaptureReceipt): string {
  if (receipt.platform === 'youtube') return 'YouTube playback · video not archived';
  const coverage = receipt.coverage;
  if (coverage?.expected_items != null)
    return isCarousel(receipt)
      ? `${coverage.stored_items} of ${coverage.expected_items} slides saved`
      : `${coverage.stored_items} of ${coverage.expected_items} media items stored`;
  const media = receipt.media.filter((m) => m.role !== 'thumbnail');
  return media.length
    ? `${media.length} stored ${media.length === 1 ? 'file' : 'files'}`
    : 'No stored media';
}

/**
 * A server note in the person's words, or null to drop it. Notes arrive from
 * the server verbatim and can carry vendor names, internal stage names or
 * advice that does not apply (arman 2026-10-09: no vendors, no jargon).
 */
export function plainReceiptNote(note: string): string | null {
  const n = note.trim();
  if (!n) return null;
  if (/^(platform transcript|speech-to-text)/i.test(n)) return null; // folded into one transcript line
  if (/^Some slides may be missing/i.test(n)) return null; // the count says it
  const file = /^(?:image|video)_(\d+): (.*)$/i.exec(n) ?? /^(thumbnail|video): (.*)$/i.exec(n);
  if (file) {
    const what = /^\d+$/.test(file[1]!) ? `Slide ${file[1]}` : 'The video';
    return /stored|file id/i.test(file[2]!)
      ? `${what} was downloaded but could not be filed`
      : `${what} could not be downloaded`;
  }
  if (/provider|scrapecreators|api key|credential/i.test(n))
    return /author/i.test(n) ? null : 'Some details of this post could not be read';
  return n;
}

export function captureReceiptWarnings(receipt: SwipeCaptureReceipt): string[] {
  const unit = isCarousel(receipt) ? 'slide' : 'media item';
  const missing = receipt.coverage?.missing_items;
  return [
    ...new Set(
      [
        ...receipt.mediaNotes.map((n) => plainReceiptNote(n)),
        ...(receipt.coverage?.status === 'partial'
          ? [
              missing != null
                ? `${missing} ${missing === 1 ? unit : `${unit}s`} missing`
                : 'Some media could not be captured',
            ]
          : []),
        ...(receipt.coverage?.status === 'unknown'
          ? ['Full media coverage could not be verified']
          : []),
        ...receipt.transcript.notes.map((n) => plainReceiptNote(n)),
        ...(receipt.transcript.status === 'none' ? ['Transcript unavailable'] : []),
        ...(receipt.transcript.status === 'unknown' ? ['Transcript status unavailable'] : []),
      ].filter((n): n is string => !!n),
    ),
  ];
}
