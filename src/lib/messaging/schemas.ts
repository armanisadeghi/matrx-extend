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

  // Demo recording — content script (in active recording tab) sends a
  // captured user event to the SW recorder.
  DEMO_EVENT: 'demos:event',

  // SW → offscreen: fetch a URL, parse the HTML, run the scrape pipeline.
  // Offscreen replies with the SoupResult (or an error envelope).
  OFFSCREEN_FETCH_PAGE: 'offscreen:fetch-page',

  // Guidance — user clicked the in-page Stop button on the recording
  // banner injected during a demo / GIF capture. SW + sidepanel listen.
  GUIDANCE_BANNER_STOP: 'guidance:banner-stop',
  // Live recording state changes (idle / demo-recording / gif-recording +
  // step counts). SW broadcasts; sidepanel updates the header chip.
  GUIDANCE_RECORDING_STATE: 'guidance:recording-state',

  // Tool dispatch (agent-driven actions in the browser)
  TOOL_CONFIRM_REQUEST: 'tool:confirm-request', // SW → sidepanel: please render approval card
  TOOL_CONFIRM_RESPONSE: 'tool:confirm-response', // sidepanel → SW: user clicked allow / deny
  TOOL_ASK_USER_REQUEST: 'tool:ask-user-request', // SW → sidepanel: agent asked the user a question
  TOOL_ASK_USER_RESPONSE: 'tool:ask-user-response', // sidepanel → SW: user's answer
  TOOL_TIMELINE_EVENT: 'tool:timeline-event', // SW → sidepanel: render in the chat (started / completed / error)

  // Scrape (sidepanel → content script via chrome.tabs.sendMessage)
  SCRAPE_CAPTURE: 'scrape:capture-page',

  // Scroll sync — keep the Scrape tab's article view scrolled in step with
  // the live page so the user can compare the capture against the source.
  // sidepanel → content script: turn the in-page scroll listener on/off.
  PAGE_SCROLL_SUBSCRIBE: 'page:scroll-subscribe',
  PAGE_SCROLL_UNSUBSCRIBE: 'page:scroll-unsubscribe',
  // content script → sidepanel via chrome.runtime.sendMessage (broadcast).
  PAGE_SCROLL: 'page:scroll',

  // Tasks user-gated overlay (in-page injected button → sidepanel via chrome.runtime.sendMessage)
  TASKS_USER_GO: 'tasks:user-go',
  TASKS_USER_CANCEL: 'tasks:user-cancel',
  // User looked at the page and decided BEFORE capturing:
  TASKS_USER_DEAD: 'tasks:user-dead', // 404 / page is gone — apply dead_link verdict, no scrape
  TASKS_USER_GATED: 'tasks:user-gated', // login / paywall / captcha — apply gated verdict, no scrape
  TASKS_USER_EXPECT_THIN: 'tasks:user-expect-thin', // capture, but auto-accept thin result

  // Data picker (content → SW → sidepanel)
  DATA_PICKER_RESULT: 'data:picker-result',
  DATA_PICKER_EXIT: 'data:picker-exit',

  // List-pattern picker (content → SW → sidepanel)
  LIST_PICKER_RESULT: 'data:list-picker-result',
  LIST_PICKER_EXIT: 'data:list-picker-exit',
  /**
   * Fired the moment Phase 1 succeeds (an item is picked, siblings detected),
   * BEFORE the user clicks Done. Lets the sidepanel show Suggested Fields
   * immediately so the user can add fields via one-click while still in the
   * picker, or skip manual picking entirely.
   */
  LIST_PICKER_ITEM_DETECTED: 'data:list-picker-item-detected',

  // Network capture (ISOLATED-world relay → SW → sidepanel)
  NET_CAPTURE_EVENT: 'net-capture:event',

  // Desktop bridge
  DESKTOP_AVAILABILITY: 'desktop:availability',
  DESKTOP_RPC: 'desktop:rpc',

  // Page recognition (content → SW)
  PAGE_NAVIGATED: 'page:navigated',
  PAGE_ALREADY_CAPTURED: 'page:already-captured',

  // WebMCP page → SW: a page registered via navigator.modelContext invoked
  // one of our tools. The webmcp-bridge content script forwards the call
  // here; the dispatcher runs the handler and replies with the result.
  WEBMCP_CALL: 'webmcp:call',

  // Frontend bridge (Phase 2 C1) — matrx-frontend admin app sends RPC
  // envelopes via chrome.runtime.sendMessage(extId, …) (externally_connectable)
  // or via Supabase Broadcast. This channel constant is for cross-context
  // messaging WITHIN the extension (e.g., side panel calling the same
  // routing). The externally-connectable listener uses the literal string
  // "FRONTEND_RPC" as the envelope's `channel` field, NOT this Chrome
  // message kind.
  FRONTEND_RPC: 'frontend:rpc',

  // Persistent WebSocket reverse channel (Phase 2 C2) — offscreen ↔ SW
  // proxy messages used by ws-client.ts. The actual on-the-wire WS frames
  // use their own JSON schema (see ws-client.ts) — these channels are
  // strictly offscreen-document plumbing.
  WS_SEND: 'ws:send', // SW → offscreen: forward this payload over the WS
  WS_MESSAGE: 'ws:message', // offscreen → SW: an inbound WS frame
  WS_STATE: 'ws:state', // offscreen → SW: open / closed transitions
  WS_START: 'ws:start', // SW → offscreen: open the WS (idempotent)
  WS_STOP: 'ws:stop', // SW → offscreen: close the WS

  // Agenda (SW → sidepanel)
  AGENDA_RUN_NOW: 'agenda:run-now', // SW alarm fired an auto task; sidepanel should switch + run

  // Context menus (SW → sidepanel). Right-click → "Ask Matrx about
  // selection" stashes the selected text and broadcasts here; the
  // sidepanel switches to the chat tab and pre-fills the draft.
  CHAT_DRAFT_FROM_SELECTION: 'chat:draft-from-selection',

  // Parallel-runs orchestration (SW → sidepanel) — `parallel_for_each_tab`
  // tool spawns N child agent streams; each lifecycle event (started, text
  // delta, data, completed, error, timeout, session_finished) is broadcast
  // here so the Tasks tab's ParallelRunsPanel can render live status
  // without each surface having to subscribe to STREAM_CHUNK with N
  // sub-runIds.
  PARALLEL_RUN_EVENT: 'parallel:run-event',

  // Microphone capture for voice input (TASK-002).
  // getUserMedia in a side panel is unreliable in MV3 — Chrome sometimes
  // suppresses the prompt and won't re-prompt after a deny. Capture runs
  // in the offscreen document with reason USER_MEDIA, which works robustly.
  //
  //   sidepanel ──MIC_REQUEST──▶ SW (ensures offscreen) ──MIC_RUN──▶ offscreen
  //   offscreen ──MIC_EVENT─────▶ all surfaces (chunks, level, errors, lifecycle)
  MIC_REQUEST: 'mic:request',
  MIC_RUN: 'mic:run',
  MIC_EVENT: 'mic:event',

  // Tab video capture (TASK-003).
  // Same offscreen-document pattern as the mic protocol — MediaRecorder
  // lives in the offscreen doc with reason USER_MEDIA. The SW resolves a
  // chrome.tabCapture stream id (10s expiry) and ships it to offscreen.
  //
  //   sidepanel ──VIDEO_REQUEST──▶ SW (resolves streamId, ensures offscreen)
  //                                ──VIDEO_RUN─────▶ offscreen
  //   offscreen ──VIDEO_EVENT─────▶ all surfaces (lifecycle, error, complete)
  VIDEO_REQUEST: 'video:request',
  VIDEO_RUN: 'video:run',
  VIDEO_EVENT: 'video:event',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
