/**
 * Persist a captured screenshot to cld_files and index it in
 * `wbx_screenshot` keyed by the active page's canonical URL.
 *
 * This is the single shared persistence path used by:
 *   - the `take_screenshot` tool handler (agent calls)
 *   - the Screenshots side-panel tab's "Take screenshot" button
 *
 * Both flows call `take_screenshot.run()` which calls this helper, so
 * everything ends up in the same place — the Screenshots tab gallery
 * shows agent and user captures alongside each other automatically.
 *
 * Lazy-imported by the handler to keep the SW boot path lean: the
 * Supabase client + cld_files HTTP client are only loaded when a
 * screenshot is actually being taken.
 */

import { uploadFile } from '@/lib/api/routes/files';
import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { saveScreenshot, type ScreenshotSource } from '@/lib/supabase/queries';
import { normalizeUrl } from '@/lib/url/match';

interface PersistInput {
  tab: chrome.tabs.Tab;
  /** Base64-encoded image bytes (without the data: prefix). */
  base64: string;
  /** Final mime type, e.g. 'image/jpeg' or 'image/png'. */
  mimeType: string;
  format: 'jpeg' | 'png';
  width: number;
  height: number;
  source: ScreenshotSource;
}

export interface PersistResult {
  fileId: string | null;
  fileUrl: string | null;
  screenshotId: string | null;
}

/**
 * Payload for the SCREENSHOT_SAVED broadcast. Receivers (the Screenshots
 * side-panel gallery) can either re-query Supabase for the canonical URL
 * or optimistically prepend a row built from these fields.
 */
export interface ScreenshotSavedPayload {
  screenshotId: string;
  fileId: string;
  fileUrl: string | null;
  pageUrlCanonical: string;
  pageUrlFull: string;
  pageTitle: string | null;
  width: number;
  height: number;
  mimeType: string;
  byteLength: number;
  source: ScreenshotSource;
  capturedAt: string;
}

/**
 * Decode the base64 payload, upload to cld_files, then insert a
 * wbx_screenshot row keyed by canonical URL. Either step failing
 * cleanly returns nulls instead of throwing, so the caller can keep
 * the inline image regardless.
 */
export async function persistScreenshot(input: PersistInput): Promise<PersistResult> {
  const url = input.tab.url ?? '';
  if (!url) {
    log.info('sw', 'persistScreenshot skipped — no tab url');
    return { fileId: null, fileUrl: null, screenshotId: null };
  }
  const canonical = normalizeUrl(url);
  if (!canonical) {
    log.info('sw', 'persistScreenshot skipped — non-normalizable url', { url });
    return { fileId: null, fileUrl: null, screenshotId: null };
  }

  let fileId: string | null = null;
  let fileUrl: string | null = null;
  let byteLength: number | null = null;
  try {
    const buffer = base64ToArrayBuffer(input.base64);
    byteLength = buffer.byteLength;
    const blob = new Blob([buffer], { type: input.mimeType });
    const ext = input.format === 'jpeg' ? 'jpg' : 'png';
    const filename = `screenshot-${Date.now()}.${ext}`;
    const upload = await uploadFile(blob, filename, {
      path: `browser-agent/screenshots/${filename}`,
      metadata: {
        kind: 'screenshot',
        page_url: url,
        page_url_canonical: canonical,
        source: input.source,
        width: input.width,
        height: input.height,
      },
    });
    fileId = upload.file_id;
    fileUrl = upload.url ?? upload.cdn_url ?? null;
  } catch (err) {
    log.warn('sw', 'persistScreenshot — cld_files upload failed', err);
    return { fileId: null, fileUrl: null, screenshotId: null };
  }

  let screenshotId: string | null = null;
  try {
    const row = await saveScreenshot({
      page_url_canonical: canonical,
      page_url_full: url,
      page_title: input.tab.title ?? null,
      file_id: fileId,
      file_url: fileUrl,
      width: input.width,
      height: input.height,
      mime_type: input.mimeType,
      byte_length: byteLength,
      source: input.source,
    });
    screenshotId = row?.id ?? null;
  } catch (err) {
    log.warn('sw', 'persistScreenshot — wbx_screenshot insert failed', err);
  }

  // Notify any open Screenshots tab to refresh — independent of the
  // tool dispatcher's TOOL_TIMELINE_EVENT (which only fires for the
  // streaming-agent code path; the user's "Take screenshot" button
  // and the Tools-tab manual run both bypass that). Same-context
  // listeners won't receive this (chrome.runtime.sendMessage doesn't
  // loop back to the sender), so the gallery additionally refreshes
  // locally on the user-button path.
  if (screenshotId && fileId) {
    const payload: ScreenshotSavedPayload = {
      screenshotId,
      fileId,
      fileUrl,
      pageUrlCanonical: canonical,
      pageUrlFull: url,
      pageTitle: input.tab.title ?? null,
      width: input.width,
      height: input.height,
      mimeType: input.mimeType,
      byteLength: byteLength ?? 0,
      source: input.source,
      capturedAt: new Date().toISOString(),
    };
    broadcast(CHANNELS.SCREENSHOT_SAVED, payload);
  }

  return { fileId, fileUrl, screenshotId };
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}
