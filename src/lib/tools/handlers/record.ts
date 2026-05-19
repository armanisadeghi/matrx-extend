/**
 * Tier: ACTION (admin-only, requires `debugger` optional permission).
 *
 * `record_gif` records browser actions on a tab via CDP screencast and
 * exports an animated GIF, optionally dropping it onto a page element.
 *
 * Actions:
 *   - start_recording: attach CDP, begin Page.startScreencast, begin
 *     buffering JPEG frames + tool-call overlays.
 *   - stop_recording:  send Page.stopScreencast, keep frames in memory
 *     until export or clear.
 *   - export:          encode buffered frames to GIF, upload to cld_files,
 *     and either chrome.downloads.download (when `download:true`) or
 *     synthesize a drag-drop onto a page element (default).
 *   - clear:           drop buffered frames + events for the tab.
 *
 * Recording lives entirely in the SW. State is lost if the SW restarts —
 * acceptable since CDP attachment dies with the SW too.
 *
 * 📝 Design notes & known limitations:
 *    .research/record-gif-design-notes.md
 *    (Read before changing the recorder, the overlay compositor, or
 *    the GIF encoder — every gotcha there cost real time to find.)
 */
import { z } from 'zod';
import { uploadFile } from '@/lib/api/routes/files';
import {
  clearRecording,
  getRecording,
  isRecording,
  startRecording,
  stopRecording,
} from '@/lib/recording/state';
import {
  DEFAULT_RENDER_OPTIONS,
  renderRecordingToGif,
  type RenderOptions,
} from '@/lib/recording/render';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';

const OptionsSchema = z
  .object({
    showClickIndicators: z.boolean().optional(),
    showDragPaths: z.boolean().optional(),
    showActionLabels: z.boolean().optional(),
    showProgressBar: z.boolean().optional(),
    showWatermark: z.boolean().optional(),
    quality: z.number().int().min(1).max(30).optional(),
  })
  .optional();

const RecordGifArgs = z.object({
  action: z.enum(['start_recording', 'stop_recording', 'export', 'clear']),
  tab_id: z.string(),
  download: z.boolean().optional(),
  ref: z.string().optional(),
  coordinate: z.array(z.number()).length(2).optional(),
  filename: z.string().optional(),
  options: OptionsSchema,
});
type RecordGifArgs = z.infer<typeof RecordGifArgs>;

function parseTabId(tabIdStr: string): number | null {
  const id = Number.parseInt(tabIdStr, 10);
  return Number.isFinite(id) ? id : null;
}

async function activateTab(id: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const tab = await chrome.tabs.get(id);
    if (!tab.active) {
      await chrome.tabs.update(id, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Tab ${id} not found: ${(err as Error).message}` };
  }
}

function resolveRenderOptions(input: RecordGifArgs['options']): RenderOptions {
  return { ...DEFAULT_RENDER_OPTIONS, ...(input ?? {}) };
}

async function dropFileOnTarget(
  tabId: number,
  blob: Blob,
  filename: string,
  ref: string | undefined,
  coordinate: [number, number] | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  if (!ref && !coordinate) return { ok: false, reason: 'ref or coordinate required for drag-drop' };
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  const base64 = btoa(bin);
  const refSelector = ref ? `[data-matrx-ref="${ref.replace(/^ref:/, '')}"]` : null;
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel: string | null, coord: [number, number] | null, b64: string, fn: string) => {
      let target: Element | null = null;
      if (sel) target = document.querySelector(sel);
      else if (coord) target = document.elementFromPoint(coord[0], coord[1]);
      if (!(target instanceof HTMLElement)) return { ok: false, reason: 'No drop target' };
      const binStr = atob(b64);
      const arr = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) arr[i] = binStr.charCodeAt(i);
      const file = new File([arr], fn, { type: 'image/gif' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const rect = target.getBoundingClientRect();
      const cx = coord?.[0] ?? rect.left + rect.width / 2;
      const cy = coord?.[1] ?? rect.top + rect.height / 2;
      const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy };
      target.dispatchEvent(new DragEvent('dragenter', init));
      target.dispatchEvent(new DragEvent('dragover', init));
      target.dispatchEvent(new DragEvent('drop', init));
      return { ok: true };
    },
    args: [refSelector, coordinate ? [coordinate[0]!, coordinate[1]!] : null, base64, filename],
  });
  return r?.result ?? { ok: false, reason: 'drop failed' };
}

const READ_ACTIONS = new Set(['clear']);

export const record_gif: ToolHandler<RecordGifArgs, unknown> = {
  name: 'record_gif',
  tier: 'action',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  tierFor: (args): ToolTier => (READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  description:
    "Record browser actions and export as an animated GIF. Actions: 'start_recording', 'stop_recording', 'export' (generates and either downloads or drops onto a page element), 'clear' (discard frames). Take a screenshot right after start and right before stop to capture clean first/last frames. 'export' returns {file_id, file_url} when not dropping. Drop target accepts ref (preferred) or coordinate.",
  argsSchema: RecordGifArgs,
  run: async (args) => {
    const tabId = parseTabId(args.tab_id);
    if (tabId == null) return { ok: false, reason: `Invalid tab_id: ${args.tab_id}` };

    if (args.action === 'start_recording') {
      if (isRecording(tabId)) {
        return { ok: false, reason: 'A recording is already active on this tab.' };
      }
      const act = await activateTab(tabId);
      if (!act.ok) return { ok: false, reason: act.reason };
      const r = await startRecording(tabId);
      return r.ok ? { ok: true, recording: true } : { ok: false, reason: r.reason };
    }

    if (args.action === 'stop_recording') {
      if (!isRecording(tabId)) return { ok: false, reason: 'No active recording on this tab.' };
      const r = await stopRecording(tabId);
      return r.ok
        ? { ok: true, frame_count: r.frame_count, duration_ms: r.duration_ms }
        : { ok: false, reason: r.reason };
    }

    if (args.action === 'clear') {
      const r = clearRecording(tabId);
      return { ok: true, cleared_frames: r.cleared_frames };
    }

    // export
    const state = getRecording(tabId);
    if (!state) {
      return { ok: false, reason: 'No recording buffered for this tab. Did you call stop_recording?' };
    }
    if (state.frames.length === 0) {
      return { ok: false, reason: 'Recording has no frames to export.' };
    }
    if (state.cdpListener) {
      // Implicit stop — let agents call export without an explicit stop.
      await stopRecording(tabId);
    }

    const options = resolveRenderOptions(args.options);
    let gifBytes: Uint8Array;
    try {
      gifBytes = await renderRecordingToGif(state, options);
    } catch (err) {
      return { ok: false, reason: `GIF render failed: ${(err as Error).message}` };
    }

    const filename = args.filename ?? `recording-${Date.now()}.gif`;
    // The TS DOM lib's BlobPart wants a strict ArrayBuffer; copy through one
    // to satisfy the type and avoid any SharedArrayBuffer coercion.
    const gifBuffer = new ArrayBuffer(gifBytes.byteLength);
    new Uint8Array(gifBuffer).set(gifBytes);
    const blob = new Blob([gifBuffer], { type: 'image/gif' });

    let upload: { file_id: string; url: string | null; cdn_url: string | null };
    try {
      upload = await uploadFile(blob, filename, {
        path: `browser-agent/recordings/${filename}`,
      });
    } catch (err) {
      return { ok: false, reason: `Upload failed: ${(err as Error).message}` };
    }

    const file_url = upload.url ?? upload.cdn_url ?? null;
    // Frames have served their purpose; free the buffer so a second
    // recording on the same tab starts clean.
    clearRecording(tabId);

    if (args.download) {
      if (!file_url) {
        return {
          ok: false,
          reason: 'Upload succeeded but no downloadable URL was returned.',
          file_id: upload.file_id,
        };
      }
      try {
        const downloadId = await chrome.downloads.download({
          url: file_url,
          filename,
          conflictAction: 'uniquify',
        });
        return {
          ok: true,
          file_id: upload.file_id,
          file_url,
          download_id: downloadId,
          frame_count: state.frames.length,
        };
      } catch (err) {
        return {
          ok: false,
          reason: `Download failed: ${(err as Error).message}`,
          file_id: upload.file_id,
          file_url,
        };
      }
    }

    // Drop onto target.
    const dropResult = await dropFileOnTarget(
      tabId,
      blob,
      filename,
      args.ref,
      args.coordinate ? [args.coordinate[0]!, args.coordinate[1]!] : undefined,
    );
    if (!dropResult.ok) {
      return {
        ok: false,
        reason: dropResult.reason,
        file_id: upload.file_id,
        file_url,
      };
    }
    return {
      ok: true,
      file_id: upload.file_id,
      file_url,
      dropped: true,
      frame_count: state.frames.length,
    };
  },
};

export const record_handlers = [record_gif];
