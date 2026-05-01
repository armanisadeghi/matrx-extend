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
  STREAM_START: 'stream:start', // sidepanel → SW: start a new stream
  STREAM_RUN: 'stream:run', // SW → offscreen: actually run the fetch
  STREAM_CANCEL: 'stream:cancel', // sidepanel → SW: cancel
  STREAM_KILL: 'stream:kill', // SW → offscreen: abort the fetch
  STREAM_CHUNK: 'stream:chunk', // offscreen → all surfaces
  STREAM_OPENED: 'stream:opened', // offscreen → all: { runId, conversationId, requestId } once the SSE response opens

  // Tool dispatch (agent-driven actions in the browser)
  TOOL_CONFIRM_REQUEST: 'tool:confirm-request', // SW → sidepanel: please render approval card
  TOOL_CONFIRM_RESPONSE: 'tool:confirm-response', // sidepanel → SW: user clicked allow / deny
  TOOL_ASK_USER_REQUEST: 'tool:ask-user-request', // SW → sidepanel: agent asked the user a question
  TOOL_ASK_USER_RESPONSE: 'tool:ask-user-response', // sidepanel → SW: user's answer
  TOOL_TIMELINE_EVENT: 'tool:timeline-event', // SW → sidepanel: render in the chat (started / completed / error)

  // Scrape (sidepanel → content script via chrome.tabs.sendMessage)
  SCRAPE_CAPTURE: 'scrape:capture-page',

  // Tasks user-gated overlay (in-page injected button → sidepanel via chrome.runtime.sendMessage)
  TASKS_USER_GO: 'tasks:user-go',
  TASKS_USER_CANCEL: 'tasks:user-cancel',

  // Data picker (content → SW → sidepanel)
  DATA_PICKER_RESULT: 'data:picker-result',
  DATA_PICKER_EXIT: 'data:picker-exit',

  // List-pattern picker (content → SW → sidepanel)
  LIST_PICKER_RESULT: 'data:list-picker-result',
  LIST_PICKER_EXIT: 'data:list-picker-exit',

  // Network capture (ISOLATED-world relay → SW → sidepanel)
  NET_CAPTURE_EVENT: 'net-capture:event',

  // Desktop bridge
  DESKTOP_AVAILABILITY: 'desktop:availability',
  DESKTOP_RPC: 'desktop:rpc',

  // Page recognition (content → SW)
  PAGE_NAVIGATED: 'page:navigated',
  PAGE_ALREADY_CAPTURED: 'page:already-captured',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
