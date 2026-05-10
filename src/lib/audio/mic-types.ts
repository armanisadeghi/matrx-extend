/**
 * Wire-format types for the cross-context microphone-capture protocol.
 *
 * Voice capture runs in the offscreen document (Chrome MV3 side panels
 * can't reliably prompt for / hold getUserMedia). The sidepanel sends
 * MIC_REQUEST, the SW ensures offscreen exists then forwards as MIC_RUN,
 * and offscreen broadcasts MIC_EVENT messages back to all surfaces.
 */

export type MicAction = 'start' | 'stop' | 'pause' | 'resume';

export interface MicRequestPayload {
  action: MicAction;
  /** Set on 'start' — milliseconds between chunk rotations. */
  chunkDurationMs?: number;
}

export interface MicRunPayload extends MicRequestPayload {}

export type MicEventType = 'started' | 'stopped' | 'paused' | 'resumed' | 'chunk' | 'level' | 'error';

export interface MicChunkEvent {
  type: 'chunk';
  chunkIndex: number;
  /**
   * base64-encoded WebM bytes; decode via `base64ToBlob()` from
   * `@/lib/messaging/binary-transport` before use.
   *
   * Why base64 and not ArrayBuffer: chrome.runtime.sendMessage uses JSON
   * serialization (NOT structured clone), so an ArrayBuffer here would
   * round-trip as `{}` and Whisper would transcribe silence. Base64 is
   * JSON-safe, lossless, and ~4/3 the original byte count.
   */
  data: string;
  mimeType: string;
  tStart: number; // session-relative seconds, paused time excluded
  tEnd: number;
}

export interface MicLevelEvent {
  type: 'level';
  /** 0-100. Throttled to ~10 Hz so messaging doesn't drown. */
  level: number;
}

export interface MicLifecycleEvent {
  type: 'started' | 'stopped' | 'paused' | 'resumed';
  /** Final accumulated mime type once we know which one MediaRecorder accepted. */
  mimeType?: string;
}

export interface MicErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}

export type MicEvent = MicChunkEvent | MicLevelEvent | MicLifecycleEvent | MicErrorEvent;
