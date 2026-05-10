/**
 * Offscreen-side tab/display video recorder.
 *
 * Runs in the offscreen document (reasons include USER_MEDIA). Holds the
 * MediaStream + MediaRecorder for a single recording session, then broadcasts
 * a VIDEO_EVENT `complete` with the encoded bytes when stopped (manually,
 * by elapsed `durationMs`, or because the source track ended — typically the
 * user revoking display-capture or closing the tab).
 *
 * Concurrency: only ONE recording at a time. Starting a new session while
 * another is active stops the previous one first (it will still emit its own
 * `complete` event before the new session's `started`).
 */

import { log } from '@/lib/debug/log';
import { blobToBase64 } from '@/lib/messaging/binary-transport';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type {
  VideoCompleteEvent,
  VideoErrorEvent,
  VideoEvent,
  VideoRunPayload,
  VideoSource,
  VideoStartedEvent,
  VideoStoppedEvent,
} from './video-types';

interface SessionState {
  sessionId: string;
  source: VideoSource;
  audio: boolean;
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
  startWallMs: number;
  /** Set when a duration was requested; cleared on stop. */
  autoStopTimer: ReturnType<typeof setTimeout> | null;
  /** Latched on the first stop trigger so we don't double-emit `stopped`. */
  stopReason: VideoStoppedEvent['reason'] | null;
}

let active: SessionState | null = null;

function emit(event: VideoEvent): void {
  broadcast(CHANNELS.VIDEO_EVENT, event);
}

function pickMimeType(audio: boolean): string {
  // Prefer VP9 → VP8 → fallback. Audio codec only matters when audio is on.
  const candidates = audio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
      ]
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

function attachTrackEndListeners(state: SessionState): void {
  // If the user revokes screen-share or the captured tab navigates away,
  // tracks end on their own. Treat that as a stop with reason 'track-ended'
  // so the UI can finalize cleanly.
  for (const track of state.stream.getTracks()) {
    track.addEventListener('ended', () => {
      void stopRecording('track-ended');
    });
  }
}

async function buildStream(payload: VideoRunPayload): Promise<MediaStream> {
  const source: VideoSource = payload.source ?? 'tab';
  if (source === 'tab') {
    if (!payload.streamId) {
      throw new Error('tab capture requires a streamId resolved by the SW');
    }
    // Cast through `unknown` because the TS lib's MediaTrackConstraints type
    // doesn't model Chrome's mandatory tab-capture extension.
    const constraints = {
      audio: payload.audio
        ? ({
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: payload.streamId,
            },
          } as unknown as MediaTrackConstraints)
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: payload.streamId,
        },
      } as unknown as MediaTrackConstraints,
    };
    return await navigator.mediaDevices.getUserMedia(constraints);
  }
  // 'display' — falls back to the standard browser screen-share picker.
  // Useful when tabCapture isn't permitted or the user wants a window/screen.
  return await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: payload.audio ?? false,
  });
}

async function startRecording(payload: VideoRunPayload): Promise<void> {
  // If a previous session leaked, stop it cleanly so its `complete` flushes
  // before we start a new one.
  if (active) {
    await stopRecording('manual');
  }

  const sessionId = payload.sessionId;
  const source: VideoSource = payload.source ?? 'tab';
  const audio = !!payload.audio;

  let stream: MediaStream;
  try {
    stream = await buildStream(payload);
  } catch (err) {
    const e = err as Error;
    const code =
      e.name === 'NotAllowedError'
        ? 'PERMISSION_DENIED'
        : e.name === 'NotFoundError'
          ? 'NO_SOURCE'
          : 'STREAM_FAILED';
    const ev: VideoErrorEvent = {
      type: 'error',
      sessionId,
      message: e.message || 'Failed to acquire video stream',
      code,
    };
    emit(ev);
    return;
  }

  const mimeType = pickMimeType(audio);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    emit({
      type: 'error',
      sessionId,
      message: `MediaRecorder construction failed: ${(err as Error).message}`,
      code: 'RECORDER_INIT',
    });
    return;
  }

  const state: SessionState = {
    sessionId,
    source,
    audio,
    stream,
    recorder,
    chunks: [],
    mimeType,
    startWallMs: Date.now(),
    autoStopTimer: null,
    stopReason: null,
  };
  active = state;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) state.chunks.push(e.data);
  };
  recorder.onerror = (e) => {
    emit({
      type: 'error',
      sessionId,
      message: (e as unknown as { error?: { message?: string } })?.error?.message ?? 'recorder error',
      code: 'RECORDER_ERROR',
    });
  };
  recorder.onstop = async () => {
    const durationMs = Date.now() - state.startWallMs;
    state.stream.getTracks().forEach((t) => t.stop());
    if (state.autoStopTimer) {
      clearTimeout(state.autoStopTimer);
      state.autoStopTimer = null;
    }
    try {
      const blob = new Blob(state.chunks, { type: state.mimeType });
      // Encode to base64 — chrome.runtime.sendMessage uses JSON, NOT
      // structured clone, so an ArrayBuffer would round-trip as `{}`
      // and the recording would arrive empty. See binary-transport.ts.
      const data = await blobToBase64(blob);
      const ev: VideoCompleteEvent = {
        type: 'complete',
        sessionId: state.sessionId,
        data,
        mimeType: state.mimeType,
        durationMs,
        sizeBytes: blob.size,
        source: state.source,
        audio: state.audio,
      };
      log.success('sys', 'video: broadcast complete', {
        sessionId: state.sessionId,
        originalBytes: blob.size,
        base64Length: data.length,
        durationMs,
      });
      emit(ev);
    } catch (err) {
      emit({
        type: 'error',
        sessionId: state.sessionId,
        message: `failed to package recording: ${(err as Error).message}`,
        code: 'PACKAGING_FAILED',
      });
    } finally {
      if (active === state) active = null;
    }
  };

  attachTrackEndListeners(state);

  // Start with a small timeslice so chunks materialize even on aborted runs.
  recorder.start(500);

  const startedEv: VideoStartedEvent = {
    type: 'started',
    sessionId,
    mimeType,
    source,
    audio,
  };
  emit(startedEv);

  if (typeof payload.durationMs === 'number' && payload.durationMs > 0) {
    state.autoStopTimer = setTimeout(() => {
      void stopRecording('duration');
    }, payload.durationMs);
  }
}

async function stopRecording(reason: VideoStoppedEvent['reason']): Promise<void> {
  const state = active;
  if (!state) return;
  if (state.stopReason) return; // already stopping
  state.stopReason = reason;

  if (state.autoStopTimer) {
    clearTimeout(state.autoStopTimer);
    state.autoStopTimer = null;
  }

  emit({ type: 'stopped', sessionId: state.sessionId, reason });

  if (state.recorder.state !== 'inactive') {
    state.recorder.stop();
    // The `complete` payload is emitted from `recorder.onstop` above. Give
    // the event loop a tick so callers awaiting this can rely on `complete`
    // having been broadcast.
    await new Promise((r) => setTimeout(r, 50));
  } else {
    // Recorder already inactive — clean up manually.
    state.stream.getTracks().forEach((t) => t.stop());
    if (active === state) active = null;
  }
}

export async function handleVideoRun(
  payload: VideoRunPayload,
): Promise<{ ok: boolean; reason?: string }> {
  switch (payload.action) {
    case 'start':
      await startRecording(payload);
      return { ok: true };
    case 'stop':
      await stopRecording('manual');
      return { ok: true };
    default:
      return { ok: false, reason: `unknown action: ${(payload as { action: string }).action}` };
  }
}

export function isRecordingActive(): boolean {
  return active != null;
}
