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
 */

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

interface RecorderState {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  rotationTimer: ReturnType<typeof setTimeout> | null;
  levelTimer: ReturnType<typeof setInterval> | null;
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

function createRecorder(): MediaRecorder {
  if (!state.stream) throw new Error('No stream');
  const idx = state.chunkIndex++;
  const chunks: Blob[] = [];
  const mr = new MediaRecorder(state.stream, { mimeType: state.mimeType });

  state.chunkTimings.set(idx, { tStart: sessionRelativeSec(), tEnd: 0 });

  mr.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mr.onstop = async () => {
    const timing = state.chunkTimings.get(idx);
    if (timing) timing.tEnd = sessionRelativeSec();
    const blob = new Blob(chunks, { type: state.mimeType });
    if (blob.size === 0) return;
    try {
      const buffer = await blob.arrayBuffer();
      const ev: MicChunkEvent = {
        type: 'chunk',
        chunkIndex: idx,
        data: buffer,
        mimeType: state.mimeType,
        tStart: timing?.tStart ?? 0,
        tEnd: timing?.tEnd ?? 0,
      };
      emit(ev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to package chunk';
      console.error('[matrx-audio] chunk packaging failed', { chunkIndex: idx, msg });
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
    console.error('[matrx-audio] MediaRecorder error', { chunkIndex: idx, name, message });
    emit({
      type: 'error',
      message: `${name}: ${message}`,
      code: 'RECORDER_ERROR',
    } as MicErrorEvent);
  };

  mr.start(100);
  return mr;
}

function rotateChunk(): void {
  if (!state.stream || !state.recorder) return;
  if (state.recorder.state !== 'recording') return;
  state.recorder.stop();
  state.recorder = createRecorder();
}

function scheduleNextRotation(): void {
  // Front-load the first few chunks so the first transcription comes back
  // quickly rather than a full window later.
  let delay = state.chunkDurationMs;
  if (state.chunkIndex === 1) delay = Math.min(3000, state.chunkDurationMs * 1.5);
  else if (state.chunkIndex === 2) delay = Math.min(3000, state.chunkDurationMs * 1.5);
  else if (state.chunkIndex === 3) delay = Math.min(4000, state.chunkDurationMs * 2);

  state.rotationTimer = setTimeout(() => {
    rotateChunk();
    scheduleNextRotation();
  }, delay);
}

async function startRecording(chunkDurationMs?: number): Promise<void> {
  // If a previous session leaked, clean it up before starting fresh.
  if (state.stream || state.recorder) {
    await stopRecording();
  }

  state.chunkDurationMs = chunkDurationMs ?? DEFAULT_CHUNK_MS;
  state.chunkIndex = 0;
  state.pausedAt = 0;
  state.pausedDuration = 0;
  state.chunkTimings.clear();

  let stream: MediaStream;
  try {
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
    console.error('[matrx-audio] getUserMedia failed', { code, name: e.name, message: e.message });
    emit({
      type: 'error',
      message: e.message || 'Microphone access failed',
      code,
    } as MicErrorEvent);
    return;
  }

  state.stream = stream;
  state.mimeType = pickMimeType();

  state.audioCtx = new AudioContext();
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.analyser.smoothingTimeConstant = 0.8;
  state.audioCtx.createMediaStreamSource(stream).connect(state.analyser);

  startLevelMeter();

  state.startTime = Date.now();
  state.recorder = createRecorder();
  scheduleNextRotation();

  emit({ type: 'started', mimeType: state.mimeType } as MicLifecycleEvent);
}

async function stopRecording(): Promise<void> {
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

  emit({ type: 'stopped' } as MicLifecycleEvent);
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
  emit({ type: 'resumed' } as MicLifecycleEvent);
}

export async function handleMicRun(payload: MicRunPayload): Promise<{ ok: boolean }> {
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
