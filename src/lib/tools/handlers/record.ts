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
import { log } from '@/lib/debug/log';
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
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { runVideoCapture } from '@/lib/video/video-sw';

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
  name: 'chrome_record_gif',
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

// ────────────────────────────────────────────────────────────────────────────
// chrome_record_tab_video — record the active tab as a WebM video.
//
// Unlike record_gif (CDP screencast → GIF, multi-step start/stop/export), this
// is a single blocking call: it captures `duration_ms` of tab video via the
// shared offscreen tabCapture + MediaRecorder pipeline (the same one the
// Tools-tab Recorder pane uses), uploads to cld_files, and returns the file
// reference. The SW-side `runVideoCapture` resolver was built for exactly this
// path — see src/lib/video/video-sw.ts.
// ────────────────────────────────────────────────────────────────────────────
const RecordTabVideoArgs = z.object({
  /** Recording length in ms (1000–60000). Default 5000. */
  duration_ms: z.number().int().min(1_000).max(60_000).optional().default(5_000),
  /** Capture tab audio in addition to video. Default false. */
  audio: z.boolean().optional().default(false),
  /**
   * 'tab' (default) uses chrome.tabCapture on the assigned tab; 'display'
   * uses getDisplayMedia (user picks a surface — only useful interactively).
   */
  source: z.enum(['tab', 'display']).optional().default('tab'),
  /** Optional explicit tab id (string). Defaults to the agent's assigned tab. */
  tab_id: z.string().optional(),
});
type RecordTabVideoArgs = z.infer<typeof RecordTabVideoArgs>;

export const record_tab_video: ToolHandler<RecordTabVideoArgs, unknown> = {
  name: 'chrome_record_tab_video',
  tier: 'action',
  admin_only: true,
  required_optional_permissions: ['tabCapture'],
  supportedBrowsers: ['chrome'],
  description:
    "Record the active tab as a video (WebM) for `duration_ms` and upload it to cloud storage. This is a single blocking call — it returns once the recording finishes. Pass `audio:true` to also capture tab audio. Returns { ok, file_id, file_url, mime_type, duration_ms, size_bytes }. Use the returned file_id with upload_file / drop_file, or share the file_url. For a lightweight annotated GIF of agent actions instead, use chrome_record_gif. The recording also appears in the Tools-tab Recorder list.",
  argsSchema: RecordTabVideoArgs,
  run: async (args, ctx) => {
    let tabId: number | null;
    if (args.tab_id) {
      tabId = parseTabId(args.tab_id);
      if (tabId == null) return { ok: false, reason: `Invalid tab_id: ${args.tab_id}` };
    } else {
      tabId = await getAssignedTabId(ctx);
    }
    if (tabId == null) return { ok: false, reason: 'No active tab to record.' };

    // Snapshot tab metadata up front for the recordings list (the tab may
    // navigate during capture).
    let tabTitle: string | null = null;
    let tabUrl: string | null = null;
    try {
      const t = await chrome.tabs.get(tabId);
      tabTitle = t.title ?? null;
      tabUrl = t.url ?? null;
    } catch {
      // non-fatal — metadata only
    }

    const result = await runVideoCapture({
      targetTabId: tabId,
      audio: args.audio,
      durationMs: args.duration_ms,
      source: args.source,
    });
    if (!result.ok || !result.data) {
      return { ok: false, reason: result.reason ?? 'Recording produced no data.' };
    }
    if (result.data.byteLength === 0) {
      return { ok: false, reason: 'Recording produced an empty file.' };
    }

    const mimeType = result.mimeType ?? 'video/webm';
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const filename = `recording-${Date.now()}.${ext}`;
    // Copy through a fresh ArrayBuffer to satisfy the strict BlobPart type
    // (same reason as record_gif's GIF buffer).
    const buf = new ArrayBuffer(result.data.byteLength);
    new Uint8Array(buf).set(new Uint8Array(result.data));
    const blob = new Blob([buf], { type: mimeType });

    let upload: { file_id: string; url: string | null; cdn_url: string | null };
    try {
      upload = await uploadFile(blob, filename, {
        path: `browser-agent/recordings/${filename}`,
        metadata: {
          kind: 'tab-video',
          duration_ms: result.durationMs ?? args.duration_ms,
          audio: result.audio ?? args.audio,
          source: result.source ?? args.source,
          page_url: tabUrl ?? undefined,
        },
      });
    } catch (err) {
      return { ok: false, reason: `Upload failed: ${(err as Error).message}` };
    }

    const fileUrl = upload.url ?? upload.cdn_url ?? null;
    const durationMs = result.durationMs ?? args.duration_ms;
    const sizeBytes = result.sizeBytes ?? blob.size;

    // Mirror into the recordings list so agent captures show up in the
    // Tools-tab Recorder pane alongside the user's own. Hydrate first so we
    // merge with (never clobber) existing entries persisted by the sidepanel.
    try {
      const { useRecordingsStore } = await import('@/lib/video/recordings-store');
      await useRecordingsStore.getState().hydrate();
      await useRecordingsStore.getState().add({
        id: `agent-${Date.now()}`,
        capturedAt: new Date().toISOString(),
        tabTitle,
        tabUrl,
        fileId: upload.file_id,
        fileUrl,
        durationMs,
        sizeBytes,
        mimeType,
        audio: result.audio ?? args.audio,
        source: result.source ?? args.source,
      });
    } catch (err) {
      log.warn('sys', 'record_tab_video: failed to add to recordings list', err);
    }

    return {
      ok: true,
      file_id: upload.file_id,
      file_url: fileUrl,
      mime_type: mimeType,
      duration_ms: durationMs,
      size_bytes: sizeBytes,
    };
  },
};

export const record_handlers = [record_gif, record_tab_video];
