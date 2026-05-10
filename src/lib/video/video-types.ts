/**
 * Wire-format types for the cross-context tab-video-capture protocol.
 *
 * Tab capture (and getDisplayMedia fallback) runs in the offscreen document
 * for the same reason mic capture does: side-panel getUserMedia / MediaRecorder
 * is unreliable in MV3, and offscreen with reason USER_MEDIA holds the stream
 * cleanly across SW restarts. The SW resolves a fresh tabCapture stream id
 * (10s expiry), forwards it to the offscreen document, and the offscreen doc
 * runs the actual MediaRecorder.
 *
 * Flow:
 *   sidepanel ──VIDEO_REQUEST───▶ SW (resolves streamId, ensures offscreen)
 *   SW        ──VIDEO_RUN───────▶ offscreen
 *   offscreen ──VIDEO_EVENT────▶ all surfaces (lifecycle, error, blob)
 *
 * The agent tool path uses the same SW resolver but skips the sidepanel entry
 * point — the dispatcher invokes the SW handler directly.
 */

/** Source for a recording: in-extension tab capture or user-picker screen capture. */
export type VideoSource = 'tab' | 'display';

export type VideoAction = 'start' | 'stop';

export interface VideoRequestPayload {
  /** Distinct id per recording session — used to correlate events back. */
  sessionId: string;
  action: VideoAction;
  /**
   * Set on `start`. Mandatory; no default — the caller decides which tab.
   * The SW calls chrome.tabCapture.getMediaStreamId before forwarding.
   */
  targetTabId?: number;
  /** Capture audio in addition to video. Default false. */
  audio?: boolean;
  /**
   * Optional ms duration. When set, the offscreen recorder will auto-stop
   * after this elapsed wall-clock time and emit `complete` with the blob.
   * Capped at 60_000 by the schema layer; the offscreen doc trusts what it
   * gets here.
   */
  durationMs?: number;
  /** Source: 'tab' uses chrome.tabCapture; 'display' uses navigator.mediaDevices.getDisplayMedia. */
  source?: VideoSource;
}

/** Forwarded from SW to offscreen with the resolved streamId attached. */
export interface VideoRunPayload extends VideoRequestPayload {
  /** When source==='tab', the chrome.tabCapture stream id (consume within ~10s). */
  streamId?: string;
}

export type VideoEventType = 'started' | 'stopped' | 'complete' | 'error';

export interface VideoStartedEvent {
  type: 'started';
  sessionId: string;
  mimeType: string;
  source: VideoSource;
  audio: boolean;
}

export interface VideoStoppedEvent {
  type: 'stopped';
  sessionId: string;
  /** The offscreen doc emits this immediately on stop; bytes follow in `complete`. */
  reason: 'manual' | 'duration' | 'track-ended';
}

export interface VideoCompleteEvent {
  type: 'complete';
  sessionId: string;
  /**
   * base64-encoded WebM bytes; decode via `base64ToBlob()` /
   * `base64ToArrayBuffer()` from `@/lib/messaging/binary-transport`
   * before use.
   *
   * Why base64 and not ArrayBuffer: chrome.runtime.sendMessage uses JSON
   * serialization (NOT structured clone), so an ArrayBuffer here would
   * round-trip as `{}` and the recorded bytes would be lost. Base64 is
   * JSON-safe, lossless, and ~4/3 the original byte count.
   *
   * Empty string ('') if the recording produced no data.
   */
  data: string;
  mimeType: string;
  /** Wall-clock duration the MediaRecorder ran in milliseconds. */
  durationMs: number;
  /** Original (decoded) payload size in bytes. */
  sizeBytes: number;
  source: VideoSource;
  audio: boolean;
}

export interface VideoErrorEvent {
  type: 'error';
  sessionId: string;
  message: string;
  code?: string;
}

export type VideoEvent =
  | VideoStartedEvent
  | VideoStoppedEvent
  | VideoCompleteEvent
  | VideoErrorEvent;
