/**
 * Offscreen-side microphone recorder.
 *
 * Lives in the offscreen document (reasons include USER_MEDIA). Holds the
 * actual MediaStream + MediaRecorder + analyser, rotates chunks, and
 * broadcasts MIC_EVENT messages back to all surfaces.
 *
 * Why it lives here: in Chrome MV3, side-panel getUserMedia is unreliable
 * (the permission prompt sometimes never appears, and a previous deny is
 * sticky with no UI to recover). Offscreen with reason USER_MEDIA shows the
 * standard Chrome mic prompt against the extension origin and persists the
 * grant for subsequent calls.
 *
 * Recording-pipeline gotchas this file works around (all proven in 2026-05-09
 * incident investigation):
 *
 *   1. After a fresh getUserMedia in offscreen — especially when the popup
 *      grant flow JUST released the device — the audio track can come back
 *      in a `muted: true` state for a brief window while the OS allocates
 *      the device. MediaRecorder happily records silence in that window.
 *      We wait (bounded) for the first 'unmute' before kicking off the
 *      MediaRecorder.
 *
 *   2. AudioContext in offscreen documents starts in 'suspended' state
 *      (no user-gesture context). We resume() it explicitly so the level
 *      meter actually pulses; otherwise the user gets no visual confirmation
 *      that the mic is alive.
 *
 *   3. We do NOT pass a timeslice to `recorder.start()`. Each MediaRecorder
 *      lifecycle is one-blob: start → stop. Rotation happens by calling
 *      `recorder.stop()` and creating a fresh recorder. WebM container
 *      headers are emitted on the first dataavailable for each new recorder,
 *      so concatenating timesliced fragments is unnecessary and was
 *      occasionally causing weird playback issues across surfaces.
 *
 *   4. Watchdog: if the first `ondataavailable` doesn't arrive within 4s
 *      of starting, we emit a NO_AUDIO_DATA error so the user sees something
 *      instead of a silent recording.
 */

import { log } from '@/lib/debug/log';
import { blobToBase64 } from '@/lib/messaging/binary-transport';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type {
  MicChunkEvent,
  MicErrorEvent,
  MicEvent,
  MicLevelEvent,
  MicLifecycleEvent,
  MicRunPayload,
} from './mic-types';

const DEFAULT_CHUNK_MS = 2000;
const LEVEL_BROADCAST_HZ = 10;
const FIRST_CHUNK_MS = 1500;
const SECOND_CHUNK_MS = 2000;
const THIRD_CHUNK_MS = 3000;
/** Max time to wait for an initially-muted track to unmute before giving up. */
const UNMUTE_WAIT_MS = 1500;
/** If no audio data arrives within this window of starting, raise the alarm. */
const NO_DATA_WATCHDOG_MS = 4000;

interface RecorderState {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  rotationTimer: ReturnType<typeof setTimeout> | null;
  levelTimer: ReturnType<typeof setInterval> | null;
  watchdogTimer: ReturnType<typeof setTimeout> | null;
  /** Becomes true the first time any chunk produces a non-zero blob. */
  receivedAnyData: boolean;
  startTime: number;
  pausedAt: number;
  pausedDuration: number;
  chunkIndex: number;
  chunkDurationMs: number;
  mimeType: string;
  /** Per-chunk session-relative window. Set on creation, finalized on stop. */
  chunkTimings: Map<number, { tStart: number; tEnd: number }>;
}

const state: RecorderState = {
  stream: null,
  recorder: null,
  audioCtx: null,
  analyser: null,
  rotationTimer: null,
  levelTimer: null,
  watchdogTimer: null,
  receivedAnyData: false,
  startTime: 0,
  pausedAt: 0,
  pausedDuration: 0,
  chunkIndex: 0,
  chunkDurationMs: DEFAULT_CHUNK_MS,
  mimeType: 'audio/webm',
  chunkTimings: new Map(),
};

function emit(event: MicEvent): void {
  broadcast(CHANNELS.MIC_EVENT, event);
}

function sessionRelativeSec(): number {
  if (!state.startTime) return 0;
  const elapsed = Date.now() - state.startTime - state.pausedDuration;
  return Math.max(0, elapsed) / 1000;
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'audio/webm';
}

function clearTimers(): void {
  if (state.rotationTimer) {
    clearTimeout(state.rotationTimer);
    state.rotationTimer = null;
  }
  if (state.levelTimer) {
    clearInterval(state.levelTimer);
    state.levelTimer = null;
  }
  if (state.watchdogTimer) {
    clearTimeout(state.watchdogTimer);
    state.watchdogTimer = null;
  }
}

function teardownStream(): void {
  if (state.audioCtx && state.audioCtx.state !== 'closed') {
    state.audioCtx.close().catch(() => {});
  }
  state.audioCtx = null;
  state.analyser = null;
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

function startLevelMeter(): void {
  if (state.levelTimer) clearInterval(state.levelTimer);
  state.levelTimer = setInterval(() => {
    const a = state.analyser;
    if (!a) return;
    const buf = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(buf);
    const avg = buf.reduce((acc, v) => acc + v, 0) / buf.length;
    const level = Math.min(100, (avg / 255) * 150);
    const ev: MicLevelEvent = { type: 'level', level };
    emit(ev);
  }, Math.round(1000 / LEVEL_BROADCAST_HZ));
}

function armWatchdog(): void {
  if (state.watchdogTimer) clearTimeout(state.watchdogTimer);
  state.watchdogTimer = setTimeout(() => {
    if (!state.receivedAnyData) {
      log.warn('audio', `WATCHDOG: no audio data in ${NO_DATA_WATCHDOG_MS}ms`, {
        watchdogMs: NO_DATA_WATCHDOG_MS,
      });
      emit({
        type: 'error',
        message:
          'No audio captured. The microphone may be muted at the OS level, in ' +
          'use by another app, or your input device may need to be re-selected.',
        code: 'NO_AUDIO_DATA',
      } as MicErrorEvent);
    }
  }, NO_DATA_WATCHDOG_MS);
}

function createRecorder(): MediaRecorder {
  if (!state.stream) throw new Error('No stream');
  const idx = state.chunkIndex++;
  const chunks: Blob[] = [];
  const mr = new MediaRecorder(state.stream, { mimeType: state.mimeType });

  state.chunkTimings.set(idx, { tStart: sessionRelativeSec(), tEnd: 0 });

  log.info('audio', 'startRecording: MediaRecorder constructed', {
    chunkIndex: idx,
    mimeType: state.mimeType,
    state: mr.state,
  });

  mr.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
      if (!state.receivedAnyData) {
        state.receivedAnyData = true;
        if (state.watchdogTimer) {
          clearTimeout(state.watchdogTimer);
          state.watchdogTimer = null;
        }
        log.success('audio', 'first audio data received', {
          chunkIndex: idx,
          size: e.data.size,
        });
      }
    }
  };
  mr.onstop = async () => {
    const timing = state.chunkTimings.get(idx);
    if (timing) timing.tEnd = sessionRelativeSec();
    const blob = new Blob(chunks, { type: state.mimeType });
    log.info('audio', 'recorder onstop', {
      chunkIndex: idx,
      blobSize: blob.size,
      partsCount: chunks.length,
    });
    if (blob.size === 0) return;
    try {
      // Encode to base64 — chrome.runtime.sendMessage uses JSON, NOT
      // structured clone, so an ArrayBuffer would round-trip as `{}`
      // and Whisper would transcribe silence. See binary-transport.ts.
      const data = await blobToBase64(blob);
      const ev: MicChunkEvent = {
        type: 'chunk',
        chunkIndex: idx,
        data,
        mimeType: state.mimeType,
        tStart: timing?.tStart ?? 0,
        tEnd: timing?.tEnd ?? 0,
      };
      log.success('audio', 'broadcast chunk', {
        chunkIndex: idx,
        originalBytes: blob.size,
        base64Length: data.length,
        tStart: ev.tStart,
        tEnd: ev.tEnd,
      });
      emit(ev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to package chunk';
      log.error('audio', 'chunk packaging failed', { chunkIndex: idx, msg, err });
      emit({ type: 'error', message: msg, code: 'CHUNK_PACKAGE_FAILED' } as MicErrorEvent);
    }
  };

  // Surface MediaRecorder runtime errors. Without this listener, a mid-
  // recording failure (codec error, source detached, OOM) goes silent
  // and the user sees nothing transcribed.
  mr.onerror = (event: Event) => {
    const ev = event as Event & { error?: { name?: string; message?: string } };
    const name = ev.error?.name ?? 'MediaRecorderError';
    const message = ev.error?.message ?? 'MediaRecorder failed';
    log.error('audio', 'MediaRecorder error', { chunkIndex: idx, name, message });
    emit({
      type: 'error',
      message: `${name}: ${message}`,
      code: 'RECORDER_ERROR',
    } as MicErrorEvent);
  };

  // No timeslice — see file header note (3). Each recorder lifecycle is one
  // blob; rotation is driven by stop() + new MediaRecorder.
  mr.start();
  return mr;
}

function rotateChunk(): void {
  if (!state.stream || !state.recorder) return;
  if (state.recorder.state !== 'recording') return;
  log.info('audio', 'rotateChunk: stopping current recorder', {
    chunkIndex: state.chunkIndex,
    currentRecorderState: state.recorder.state,
  });
  state.recorder.stop();
  state.recorder = createRecorder();
}

function scheduleNextRotation(): void {
  // Front-load the first few chunks so the first transcription comes back
  // quickly rather than a full window later. `state.chunkIndex` here reflects
  // the index of the NEXT recorder to be created — so === 1 means "we just
  // created chunk 0 and are waiting on its rotation".
  let delay = state.chunkDurationMs;
  if (state.chunkIndex === 1) delay = FIRST_CHUNK_MS;
  else if (state.chunkIndex === 2) delay = SECOND_CHUNK_MS;
  else if (state.chunkIndex === 3) delay = THIRD_CHUNK_MS;

  state.rotationTimer = setTimeout(() => {
    rotateChunk();
    scheduleNextRotation();
  }, delay);
}

/**
 * Wait for the audio track to leave its initial 'muted' state, bounded so we
 * don't hang forever on devices that report a permanently-muted track. The
 * track will fire 'unmute' when audio frames start flowing.
 *
 * Returns the post-wait mute state. The caller decides whether to abort
 * the recording attempt — a track that stays muted past the wait window
 * is almost always an OS-level mute (macOS Sound prefs / Windows input
 * disabled) and recording silence into Whisper produces empty
 * transcripts with no actionable error for the user.
 */
async function waitForTrackUnmute(
  track: MediaStreamTrack,
): Promise<{ muted: boolean; timedOut: boolean }> {
  if (!track.muted) return { muted: false, timedOut: false };
  log.warn('audio', 'startRecording: track muted, waiting for unmute', {
    label: track.label,
    enabled: track.enabled,
    readyState: track.readyState,
  });
  return new Promise<{ muted: boolean; timedOut: boolean }>((resolve) => {
    let settled = false;
    const cleanup = (timedOut: boolean) => {
      if (settled) return;
      settled = true;
      track.removeEventListener('unmute', onUnmute);
      clearTimeout(timer);
      resolve({ muted: track.muted, timedOut });
    };
    const onUnmute = () => {
      log.info('audio', 'startRecording: track unmute event');
      cleanup(false);
    };
    track.addEventListener('unmute', onUnmute, { once: true });
    const timer = setTimeout(() => {
      log.warn('audio', 'startRecording: unmute wait timed out', {
        muted: track.muted,
      });
      cleanup(true);
    }, UNMUTE_WAIT_MS);
  });
}

async function startRecording(chunkDurationMs?: number): Promise<void> {
  log.info('audio', 'startRecording invoked', {
    chunkDurationMs,
    hadPriorStream: !!state.stream,
    hadPriorRecorder: !!state.recorder,
  });

  // If a previous session leaked, clean it up before starting fresh.
  if (state.stream || state.recorder) {
    await stopRecording();
  }

  state.chunkDurationMs = chunkDurationMs ?? DEFAULT_CHUNK_MS;
  state.chunkIndex = 0;
  state.pausedAt = 0;
  state.pausedDuration = 0;
  state.receivedAnyData = false;
  state.chunkTimings.clear();

  let stream: MediaStream;
  try {
    log.info('audio', 'startRecording: getUserMedia call starting');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16_000,
      },
    });
  } catch (err) {
    const e = err as Error;
    const code =
      e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'
        ? 'PERMISSION_DENIED'
        : e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError'
          ? 'NO_DEVICE'
          : e.name === 'NotReadableError' || e.name === 'TrackStartError'
            ? 'DEVICE_BUSY'
            : 'UNKNOWN_ERROR';
    log.error('audio', 'startRecording: getUserMedia failed', {
      code,
      name: e.name,
      message: e.message,
    });
    emit({
      type: 'error',
      message: e.message || 'Microphone access failed',
      code,
    } as MicErrorEvent);
    return;
  }

  const tracks = stream.getAudioTracks();
  const trackStates = tracks.map((t) => ({
    kind: t.kind,
    label: t.label,
    muted: t.muted,
    enabled: t.enabled,
    readyState: t.readyState,
  }));
  log.info('audio', 'startRecording: getUserMedia returned', {
    trackCount: tracks.length,
    trackStates,
  });

  const primaryTrack = tracks[0];
  if (!primaryTrack) {
    emit({
      type: 'error',
      message: 'No audio tracks in the stream',
      code: 'NO_DEVICE',
    } as MicErrorEvent);
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  // Wait (bounded) for any initially-muted track to start flowing audio.
  // The popup grant flow releases the device 1.5s before the offscreen
  // re-acquires it; on some macOS / Linux setups the track comes back muted
  // for a brief window while the OS finishes allocating the device.
  const muteResult = await waitForTrackUnmute(primaryTrack);

  // If the track is still muted after the wait window, abort with a
  // clear OS-level remediation hint. Proceeding records silence; Whisper
  // returns an empty transcript and the user has no actionable error.
  if (muteResult.muted && muteResult.timedOut) {
    log.error('audio', 'startRecording: track permanently muted, aborting', {
      label: primaryTrack.label,
      enabled: primaryTrack.enabled,
      readyState: primaryTrack.readyState,
    });
    emit({
      type: 'error',
      message:
        'Microphone is muted at the OS level. On macOS check System ' +
        'Settings → Sound → Input. On Windows check Sound settings → ' +
        'Input device. Then try recording again.',
      code: 'TRACK_PERMANENTLY_MUTED',
    } as MicErrorEvent);
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  state.stream = stream;
  state.mimeType = pickMimeType();

  state.audioCtx = new AudioContext();
  log.info('audio', 'startRecording: AudioContext state', {
    state: state.audioCtx.state,
    sampleRate: state.audioCtx.sampleRate,
  });
  // Offscreen documents have no user-gesture context, so AudioContext often
  // starts suspended. Without resume() the analyser returns zeros and the
  // level meter stays flat — the user has no way to tell the mic is alive.
  if (state.audioCtx.state === 'suspended') {
    try {
      await state.audioCtx.resume();
      log.success('audio', 'startRecording: AudioContext resumed', {
        state: state.audioCtx.state,
      });
    } catch (err) {
      log.warn('audio', 'startRecording: AudioContext resume failed', err);
    }
  }
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.analyser.smoothingTimeConstant = 0.8;
  state.audioCtx.createMediaStreamSource(stream).connect(state.analyser);

  startLevelMeter();

  state.startTime = Date.now();
  state.recorder = createRecorder();
  scheduleNextRotation();
  armWatchdog();

  emit({ type: 'started', mimeType: state.mimeType } as MicLifecycleEvent);
  log.success('audio', 'startRecording: started broadcast emitted', {
    mimeType: state.mimeType,
  });
}

async function stopRecording(): Promise<void> {
  log.info('audio', 'stopRecording invoked', {
    hadRecorder: !!state.recorder,
    recorderState: state.recorder?.state,
    hadStream: !!state.stream,
  });
  clearTimers();

  const mr = state.recorder;
  state.recorder = null;
  if (mr && mr.state !== 'inactive') {
    // The 'stop' handler will fire ondataavailable and broadcast the final
    // chunk asynchronously. Don't tear down the stream until after it has
    // had a chance to flush — give it a tick.
    mr.stop();
    await new Promise((r) => setTimeout(r, 50));
  }

  teardownStream();
  state.startTime = 0;
  state.pausedAt = 0;
  state.pausedDuration = 0;
  state.receivedAnyData = false;

  emit({ type: 'stopped' } as MicLifecycleEvent);
  log.success('audio', 'stopped broadcast emitted');
}

function pauseRecording(): void {
  if (!state.recorder || state.recorder.state !== 'recording') return;
  clearTimers();
  state.recorder.stop();
  state.recorder = null;
  state.pausedAt = Date.now();
  emit({ type: 'paused' } as MicLifecycleEvent);
}

function resumeRecording(): void {
  if (!state.stream) return;
  if (state.pausedAt) {
    state.pausedDuration += Date.now() - state.pausedAt;
    state.pausedAt = 0;
  }
  state.recorder = createRecorder();
  startLevelMeter();
  scheduleNextRotation();
  armWatchdog();
  emit({ type: 'resumed' } as MicLifecycleEvent);
}

export async function handleMicRun(payload: MicRunPayload): Promise<{ ok: boolean }> {
  log.info('audio', 'MIC_RUN received', { action: payload.action, payload });
  switch (payload.action) {
    case 'start':
      await startRecording(payload.chunkDurationMs);
      return { ok: true };
    case 'stop':
      await stopRecording();
      return { ok: true };
    case 'pause':
      pauseRecording();
      return { ok: true };
    case 'resume':
      resumeRecording();
      return { ok: true };
  }
}
