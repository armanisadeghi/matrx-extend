/**
 * SW-side coordinator for tab/display video capture.
 *
 * The dispatcher (and any other SW caller) imports `runVideoCapture` and gets
 * back a Promise that resolves when the recording finishes — handling stream
 * id resolution, offscreen lifecycle, and event correlation.
 *
 * Tab capture flow:
 *   1. Caller invokes runVideoCapture({ targetTabId, audio, durationMs }).
 *   2. We resolve a tab-capture stream id (10s TTL) via chrome.tabCapture.
 *   3. ensureOffscreen() (if not running already).
 *   4. Forward { streamId, sessionId, audio, durationMs } to offscreen via
 *      VIDEO_RUN.
 *   5. Subscribe to VIDEO_EVENT broadcasts; resolve on `complete` or `error`.
 *
 * The sidepanel UI uses the same offscreen-side recorder via VIDEO_REQUEST →
 * VIDEO_RUN, but skips this Promise wrapper — it watches the broadcasts
 * directly for live indicator + recording-list updates.
 */

import { log } from '@/lib/debug/log';
import { base64ToArrayBuffer } from '@/lib/messaging/binary-transport';
import { CHANNELS } from '@/lib/messaging/schemas';
import { ensureOffscreen } from '@/lib/stream/offscreen-proxy';
import type {
  VideoCompleteEvent,
  VideoErrorEvent,
  VideoEvent,
  VideoRunPayload,
  VideoSource,
} from '@/lib/video/video-types';

export interface RunVideoCaptureArgs {
  targetTabId: number;
  audio: boolean;
  durationMs: number;
  source?: VideoSource;
}

export interface RunVideoCaptureResult {
  ok: boolean;
  reason?: string;
  data?: ArrayBuffer;
  mimeType?: string;
  durationMs?: number;
  sizeBytes?: number;
  source?: VideoSource;
  audio?: boolean;
}

let nextSessionCounter = 0;
function newSessionId(): string {
  nextSessionCounter++;
  return `vid-${Date.now().toString(36)}-${nextSessionCounter}`;
}

async function getTabCaptureStreamId(targetTabId: number): Promise<string> {
  if (!chrome.tabCapture?.getMediaStreamId) {
    throw new Error('chrome.tabCapture.getMediaStreamId is unavailable');
  }
  return new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message ?? 'getMediaStreamId failed'));
        return;
      }
      if (!streamId) {
        reject(new Error('getMediaStreamId returned an empty id'));
        return;
      }
      resolve(streamId);
    });
  });
}

/**
 * Drive a single video-capture session end-to-end. Returns the encoded blob
 * via ArrayBuffer when the recording finishes, or a structured error.
 *
 * The promise rejects only on unexpected internal failures — declared error
 * conditions (permission missing, stream id failed, recorder error) come back
 * as `{ ok: false, reason }` so callers can return them as tool results
 * without try/catch boilerplate.
 */
export async function runVideoCapture(args: RunVideoCaptureArgs): Promise<RunVideoCaptureResult> {
  const sessionId = newSessionId();
  const source: VideoSource = args.source ?? 'tab';

  let streamId: string | undefined;
  if (source === 'tab') {
    try {
      streamId = await getTabCaptureStreamId(args.targetTabId);
    } catch (err) {
      return {
        ok: false,
        reason: `tab capture stream id failed: ${(err as Error).message}`,
      };
    }
  }

  await ensureOffscreen();

  // Subscribe FIRST so we don't race the offscreen broadcast.
  const result = await new Promise<RunVideoCaptureResult>((resolve) => {
    let settled = false;
    const finish = (r: RunVideoCaptureResult): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(r);
    };

    // Listen on raw chrome.runtime.onMessage so we can passively observe
    // VIDEO_EVENT broadcasts without intercepting sendResponse from peer
    // listeners (which use the typed `on(...)` helper for request/response).
    const peek = (
      msg: unknown,
      _sender: chrome.runtime.MessageSender,
      _send: (response?: unknown) => void,
    ): boolean => {
      if (
        !msg ||
        typeof msg !== 'object' ||
        (msg as { __matrx?: unknown }).__matrx !== true ||
        (msg as { kind?: unknown }).kind !== CHANNELS.VIDEO_EVENT
      ) {
        return false;
      }
      const event = (msg as { payload?: VideoEvent }).payload;
      if (!event || event.sessionId !== sessionId) return false;
      if (event.type === 'error') {
        const e = event as VideoErrorEvent;
        finish({ ok: false, reason: e.message });
      } else if (event.type === 'complete') {
        const e = event as VideoCompleteEvent;
        // The wire payload is base64 (chrome.runtime.sendMessage uses JSON,
        // not structured clone). Decode back to ArrayBuffer at this
        // boundary so the public RunVideoCaptureResult contract stays
        // a plain binary buffer for callers.
        const buffer = e.data ? base64ToArrayBuffer(e.data) : new ArrayBuffer(0);
        finish({
          ok: true,
          data: buffer,
          mimeType: e.mimeType,
          durationMs: e.durationMs,
          sizeBytes: e.sizeBytes,
          source: e.source,
          audio: e.audio,
        });
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(peek);
    const unsubscribe = (): void => {
      chrome.runtime.onMessage.removeListener(peek);
    };

    const runPayload: VideoRunPayload = {
      sessionId,
      action: 'start',
      audio: args.audio,
      durationMs: args.durationMs,
      source,
      targetTabId: args.targetTabId,
      streamId,
    };

    // Use chrome.runtime.sendMessage directly so the offscreen recorder
    // receives this without bouncing through `broadcast` (which would fan
    // out to every surface). The offscreen `on(VIDEO_RUN)` handler picks
    // it up specifically.
    chrome.runtime
      .sendMessage({ __matrx: true, kind: CHANNELS.VIDEO_RUN, payload: runPayload })
      .catch((err) => {
        log.error('sys', 'video forward failed', err);
        finish({ ok: false, reason: `forward to offscreen failed: ${(err as Error).message}` });
      });

    // Belt-and-braces: a runaway recorder shouldn't keep the SW promise alive
    // forever. Cap the wait at durationMs + 30s slack so we always settle.
    const safetyMs = args.durationMs + 30_000;
    setTimeout(() => {
      if (!settled) {
        finish({
          ok: false,
          reason: `recording timed out (no complete event after ${safetyMs}ms)`,
        });
      }
    }, safetyMs);
  });

  return result;
}
