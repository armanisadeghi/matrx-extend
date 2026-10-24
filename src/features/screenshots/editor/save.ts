/**
 * Save an edited screenshot as a NEW file beside the original — the original
 * is never overwritten, so a bad crop is never a lost capture. When the edit
 * came from a gallery row it is indexed on the same page, so it shows up in
 * the Screenshots tab (and the agent sees it) immediately.
 */

import { uploadFile } from '@/lib/api/routes/files';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { ScreenshotSavedPayload } from '@/lib/screenshot/persist';
import { type ScreenshotRow, saveScreenshot } from '@/lib/supabase/queries';

export interface SavedEdit {
  fileId: string;
  screenshotId: string | null;
}

export async function saveEditedScreenshot(input: {
  blob: Blob;
  width: number;
  height: number;
  sourceFileId: string;
  original: ScreenshotRow | null;
}): Promise<SavedEdit> {
  const { blob, width, height, sourceFileId, original } = input;
  const filename = `screenshot-${Date.now()}-edited.png`;
  const upload = await uploadFile(blob, filename, {
    path: `browser-agent/screenshots/${filename}`,
    metadata: {
      kind: 'screenshot',
      edited_from_file_id: sourceFileId,
      ...(original && {
        page_url: original.page_url_full,
        page_url_canonical: original.page_url_canonical,
      }),
      source: 'user',
      width,
      height,
    },
  });
  const fileId = upload.file_id;
  const fileUrl = upload.url ?? upload.cdn_url ?? null;
  if (!original) return { fileId, screenshotId: null };

  const row = await saveScreenshot({
    page_url_canonical: original.page_url_canonical,
    page_url_full: original.page_url_full,
    page_title: original.page_title,
    file_id: fileId,
    file_url: fileUrl,
    width,
    height,
    mime_type: 'image/png',
    byte_length: blob.size,
    source: 'user',
  });
  const screenshotId = row?.id ?? null;
  if (screenshotId) {
    const payload: ScreenshotSavedPayload = {
      screenshotId,
      fileId,
      fileUrl,
      pageUrlCanonical: original.page_url_canonical,
      pageUrlFull: original.page_url_full,
      pageTitle: original.page_title,
      width,
      height,
      mimeType: 'image/png',
      byteLength: blob.size,
      source: 'user',
      capturedAt: new Date().toISOString(),
    };
    broadcast(CHANNELS.SCREENSHOT_SAVED, payload);
  }
  return { fileId, screenshotId };
}
