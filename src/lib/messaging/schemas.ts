/**
 * Cross-context message channel registry.
 *
 * Wire format: `{ __matrx: true, kind, payload }`. Receivers filter by `kind`.
 *
 * IMPORTANT: separate channel names for each direction so the SW doesn't
 * accidentally catch its own broadcast. Specifically:
 *
 *   sidepanel ──STREAM_START──▶ SW
 *   SW        ──STREAM_RUN────▶ offscreen
 *   offscreen ──STREAM_CHUNK──▶ all surfaces
 */

export const CHANNELS = {
  // Auth — broadcast only (no request/response)
  AUTH_STATE_CHANGED: 'auth:state-changed',

  // Streaming
  STREAM_START: 'stream:start',           // sidepanel → SW: start a new stream
  STREAM_RUN: 'stream:run',               // SW → offscreen: actually run the fetch
  STREAM_CANCEL: 'stream:cancel',         // sidepanel → SW: cancel
  STREAM_KILL: 'stream:kill',             // SW → offscreen: abort the fetch
  STREAM_CHUNK: 'stream:chunk',           // offscreen → all surfaces

  // Scrape (sidepanel → content script via chrome.tabs.sendMessage)
  SCRAPE_CAPTURE: 'scrape:capture-page',

  // Data picker (content → SW → sidepanel)
  DATA_PICKER_RESULT: 'data:picker-result',
  DATA_PICKER_EXIT: 'data:picker-exit',

  // Desktop bridge
  DESKTOP_AVAILABILITY: 'desktop:availability',
  DESKTOP_RPC: 'desktop:rpc',

  // Page recognition (content → SW)
  PAGE_NAVIGATED: 'page:navigated',
  PAGE_ALREADY_CAPTURED: 'page:already-captured',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
