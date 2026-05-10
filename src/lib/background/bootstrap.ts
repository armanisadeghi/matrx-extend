/**
 * Background SW initialization. Called SYNCHRONOUSLY from
 * entrypoints/background.ts so onMessage handlers are registered before
 * the first wake-up event has a chance to fire.
 *
 * What lives here:
 *   - chrome.runtime.onMessage handlers for stream:start / stream:cancel /
 *     desktop:rpc and the legacy page:navigated / data:picker-* signals
 *   - chrome.alarms registration for token refresh + desktop probe
 *   - lazy supabase session rehydration
 *
 * Auth (sign-in / sign-out) does NOT run through the SW — it runs in the
 * sidepanel context directly via @/lib/auth/flow because chrome.identity
 * works fine there and avoids the lazy-message-handler race.
 */

import { ALARMS, STORAGE_KEYS } from '@/config/env';
import { startAudibleLog } from '@/lib/audio/audible-log';
import {
  registerAgendaNotificationClicks,
  scanAndNotify,
  startAgendaScanner,
} from '@/lib/agenda/scanner';
import { refreshAccessToken } from '@/lib/auth/flow';
import { logExtensionIdentityOnce } from '@/lib/auth/identity';
import { hydrateBridgeTrafficEnabled, recordBridgeTraffic } from '@/lib/debug/bridge-traffic';
import { log, startDebugRelay } from '@/lib/debug/log';
import { desktopRpc, probeDesktop, startDesktopProbeAlarm } from '@/lib/desktop/bridge';
import { connectWs, onWsMessage, sendWs } from '@/lib/desktop/ws-client';
import type { CapturedEvent } from '@/lib/demos/event-capture';
import { onCapturedEvent } from '@/lib/demos/recorder';
import {
  FRONTEND_RPC_CHANNEL,
  FrontendRpcEnvelopeSchema,
  type FrontendRpcResponse,
  handleFrontendRpc,
} from '@/lib/frontend-bridge/handler';
import { connectBroadcast } from '@/lib/frontend-bridge/broadcast';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { matchesAllowedOrigin } from '@/lib/origin-allowlist';
import type { MicRequestPayload, MicRunPayload } from '@/lib/audio/mic-types';
import {
  ensureOffscreen,
  type StartStreamArgs,
  cancelStream,
  startStream,
} from '@/lib/stream/offscreen-proxy';
import type {
  VideoErrorEvent,
  VideoRequestPayload,
  VideoRunPayload,
} from '@/lib/video/video-types';
import { setSupabaseSession } from '@/lib/supabase/client';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { setupContextMenus } from '@/lib/context-menus/setup';
import { handleWebmcpCall, recordAssignedTab, startToolDispatcher } from '@/lib/tools/dispatch';
import { registerToolsOnActiveTab } from '@/lib/webmcp/register';
import { usePilotStore } from '@/state/pilot';

let bootstrapped = false;

export function bootstrapBackground(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  startDebugRelay();
  // Restore the Debug → Bridges traffic-buffer flag (off by default; persisted).
  void hydrateBridgeTrafficEnabled();
  log.info('sw', 'background bootstrap (sync)');
  // Emit the runtime identity bundle (extension id, redirect URI, OAuth
  // client id) so any future ID drift is visible in the user's debug log
  // before sign-in is ever attempted. See .research/v0.1.4-auth-incident.md.
  logExtensionIdentityOnce();

  // ── 1. Register message handlers SYNCHRONOUSLY so they're ready immediately.
  registerHandlers();

  // ── 2. Tool dispatcher subscribes to STREAM_OPENED + STREAM_CHUNK.
  //       Per-run permission mode is latched from the chat hook; this default
  //       only kicks in if the sidepanel forgot to pass one.
  startToolDispatcher({ defaultPermissionMode: () => 'ask' });

  // ── 2a. Audio log: track when each tab last produced sound so
  //        `tab_audio_inspect` can answer "recently audible" queries.
  startAudibleLog();

  // ── 3. Alarms — also synchronous registration.
  setupAlarms();
  startDesktopProbeAlarm();
  startAgendaScanner();
  registerAgendaNotificationClicks();

  // ── 3. Async housekeeping: rehydrate Supabase session, probe desktop.
  void rehydrateSupabaseSession();
  void probeDesktop().then((state) => {
    lastDesktopTransport = state.transport;
    broadcast(CHANNELS.DESKTOP_AVAILABILITY, {
      transport: state.transport,
      lastChecked: state.lastChecked,
    });
    // Phase 2 C2.a — open the persistent WS only when HTTP transport is
    // active. Native messaging IS already a long-lived bidirectional
    // channel; doubling up would waste resources.
    if (state.transport === 'http') {
      void connectWs();
    }
  });

  // ── 4. WebMCP page-side bridge: when an allowlisted page finishes
  //       loading, register matrx-extend's tools on its
  //       `navigator.modelContext` so external agents on the page can
  //       discover and call them.
  registerWebmcpTabUpdateGate();

  // ── 5. Phase 2 C1 — externally_connectable bridge from matrx-frontend.
  //       Allowlisted page origins (configured in wxt.config.ts) can talk
  //       to us via chrome.runtime.sendMessage(extId, FRONTEND_RPC envelope).
  registerFrontendRpcExternalListener();

  // ── 6. Phase 2 C1.c — Supabase Broadcast subscriber for the same
  //       FRONTEND_RPC envelope shape (per-user channel). Best-effort:
  //       failures log warnings, don't throw.
  void connectBroadcast();

  // ── 7. Phase 2 C2 — persistent WebSocket reverse channel with matrx-local.
  //       Wired via the offscreen document (long-lived) — opens lazily when
  //       the desktop bridge is reachable over HTTP. If native messaging is
  //       the active transport, that connection IS the reverse channel and
  //       we skip WS.
  registerWsReverseInvocationHandler();

  // ── 7b. Right-click context menus. "Ask Matrx about \"%s\"" pre-fills
  //        the chat draft with the page selection; "Open Matrx side panel"
  //        is a fallback for users who haven't pinned the action button.
  setupContextMenus();

  // ── 8. Pilot session lifecycle (CLAUDE.md roadmap item #9).
  //       Watch for tab / group removal so we can reset the persisted pilot
  //       session record when its group disappears externally (last tab
  //       closed by the user, group dissolved, etc.). Without this the
  //       sidepanel would think a pilot session is still active and refuse
  //       new actions until the user explicitly clicked "End Session".
  registerPilotLifecycleListeners();
}

let lastDesktopTransport: 'native' | 'http' | 'none' | null = null;

function setupAlarms(): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARMS.TOKEN_REFRESH) {
      console.log('[matrx-extend] alarm: token refresh');
      await refreshAccessToken();
      await rehydrateSupabaseSession();
    } else if (alarm.name === ALARMS.DESKTOP_PROBE) {
      const state = await probeDesktop();
      // Only broadcast when transport actually changes — every-30s probes
      // were drowning the debug log.
      if (state.transport !== lastDesktopTransport) {
        const prev = lastDesktopTransport;
        lastDesktopTransport = state.transport;
        log.info('desktop', `transport changed → ${state.transport}`);
        broadcast(CHANNELS.DESKTOP_AVAILABILITY, {
          transport: state.transport,
          lastChecked: state.lastChecked,
        });
        // Phase 2 C2 — open WS when HTTP transport just became active
        // (and we weren't on HTTP before).
        if (state.transport === 'http' && prev !== 'http') {
          void connectWs();
        }
      }
    } else if (alarm.name === ALARMS.AGENDA_SCAN) {
      await scanAndNotify();
    }
  });
}

function registerHandlers(): void {
  on<StartStreamArgs, { ok: boolean }>(CHANNELS.STREAM_START, async (payload) => {
    // Latch the assigned tab BEFORE forwarding to offscreen so the
    // dispatcher has it ready by the time the first tool_event lands. This
    // is what keeps the agent pinned to the user's tab even if the user
    // switches focus while the stream is running.
    if (payload.runId) {
      recordAssignedTab(payload.runId, payload.assignedTabId ?? null);
    }
    await startStream(payload);
    return { ok: true };
  });

  on<{ runId: string }, { ok: boolean }>(CHANNELS.STREAM_CANCEL, async (payload) => {
    await cancelStream(payload.runId);
    return { ok: true };
  });

  // Mic capture (TASK-002): sidepanel asks the SW to run a mic action;
  // SW ensures offscreen is up, then forwards via MIC_RUN. The actual
  // MediaRecorder lives in the offscreen document where USER_MEDIA reason
  // grants reliable mic access.
  //
  // Failure surfacing — every error path BOTH throws (so the sidepanel's
  // try/catch around sendMicRequest fires onError and the inline banner
  // shows) AND broadcasts a MIC_EVENT.error (so any other open surface
  // listening for mic events sees the failure too). Silent failures here
  // are forbidden — the user's mic button would otherwise hang in the
  // pre-start state with no signal.
  on<MicRequestPayload, { ok: boolean }>(CHANNELS.MIC_REQUEST, async (payload) => {
    log.info('audio', 'sw: MIC_REQUEST received', { action: payload.action, payload });
    try {
      await ensureOffscreen();
    } catch (err) {
      const message = (err as Error).message ?? 'Failed to open offscreen document';
      log.error('audio', 'sw: ensureOffscreen failed', err);
      broadcast(CHANNELS.MIC_EVENT, {
        type: 'error',
        message: `Couldn't start the microphone backend: ${message}`,
        code: 'OFFSCREEN_UNAVAILABLE',
      });
      throw new Error(message);
    }
    const runPayload: MicRunPayload = payload;
    let res: { __error?: string } | { ok?: true } | null = null;
    try {
      log.info('audio', 'sw: MIC_RUN forward to offscreen', { runPayload });
      res = (await chrome.runtime.sendMessage({
        __matrx: true,
        kind: CHANNELS.MIC_RUN,
        payload: runPayload,
      })) as { __error?: string } | { ok?: true } | null;
      log.info('audio', 'sw: MIC_RUN reply', { res });
    } catch (err) {
      const message = (err as Error).message ?? 'Mic forwarding failed';
      log.error('audio', 'sw: MIC_RUN forward failed', err);
      broadcast(CHANNELS.MIC_EVENT, {
        type: 'error',
        message: `Couldn't reach the mic backend: ${message}`,
        code: 'FORWARD_FAILED',
      });
      throw new Error(message);
    }
    if (res && typeof res === 'object' && '__error' in res && res.__error) {
      const message = res.__error;
      log.error('audio', 'sw: MIC_RUN handler returned error', { message });
      broadcast(CHANNELS.MIC_EVENT, {
        type: 'error',
        message: `Mic backend error: ${message}`,
        code: 'MIC_RUN_FAILED',
      });
      throw new Error(message);
    }
    return { ok: true };
  });

  // Video capture (TASK-003): sidepanel asks the SW to run a tab/display
  // recording. Same offscreen pattern as mic, plus a tab-capture stream id
  // resolution step here in the SW (chrome.tabCapture lives only in the SW
  // context). On 'start' for source==='tab' we resolve the streamId and
  // forward; on 'stop' we just forward the action.
  on<VideoRequestPayload, { ok: boolean }>(CHANNELS.VIDEO_REQUEST, async (payload) => {
    if (payload.action === 'start' && (payload.source ?? 'tab') === 'tab') {
      if (payload.targetTabId == null) {
        broadcast(CHANNELS.VIDEO_EVENT, {
          type: 'error',
          sessionId: payload.sessionId,
          message: 'targetTabId is required for tab capture',
          code: 'NO_TARGET_TAB',
        } satisfies VideoErrorEvent);
        return { ok: false };
      }
      if (!chrome.tabCapture?.getMediaStreamId) {
        broadcast(CHANNELS.VIDEO_EVENT, {
          type: 'error',
          sessionId: payload.sessionId,
          message:
            'Tab video capture not granted. Enable it from the Recorder pane in the Tools tab.',
          code: 'API_UNAVAILABLE',
        } satisfies VideoErrorEvent);
        return { ok: false };
      }
      let streamId: string;
      try {
        streamId = await new Promise<string>((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId(
            { targetTabId: payload.targetTabId! },
            (id) => {
              const err = chrome.runtime.lastError;
              if (err) reject(new Error(err.message ?? 'getMediaStreamId failed'));
              else if (!id) reject(new Error('empty streamId'));
              else resolve(id);
            },
          );
        });
      } catch (err) {
        broadcast(CHANNELS.VIDEO_EVENT, {
          type: 'error',
          sessionId: payload.sessionId,
          message: `tab capture stream id failed: ${(err as Error).message}`,
          code: 'STREAM_ID_FAILED',
        } satisfies VideoErrorEvent);
        return { ok: false };
      }
      await ensureOffscreen();
      const runPayload: VideoRunPayload = { ...payload, streamId };
      await chrome.runtime
        .sendMessage({ __matrx: true, kind: CHANNELS.VIDEO_RUN, payload: runPayload })
        .catch((err) => {
          log.error('sys', 'video forward failed', err);
          broadcast(CHANNELS.VIDEO_EVENT, {
            type: 'error',
            sessionId: payload.sessionId,
            message: `forward to offscreen failed: ${(err as Error).message}`,
            code: 'FORWARD_FAILED',
          } satisfies VideoErrorEvent);
        });
      return { ok: true };
    }
    // 'stop' action or non-tab source — pass through. getDisplayMedia runs
    // inside the offscreen document where the picker is permitted.
    await ensureOffscreen();
    const runPayload: VideoRunPayload = { ...payload };
    await chrome.runtime
      .sendMessage({ __matrx: true, kind: CHANNELS.VIDEO_RUN, payload: runPayload })
      .catch((err) => log.error('sys', 'video forward failed', err));
    return { ok: true };
  });

  // STREAM_CHUNK is broadcast by offscreen. The sidepanel listens directly;
  // the SW doesn't need to do anything. No handler registered to keep the
  // signal clean.

  on<Parameters<typeof desktopRpc>[0], Awaited<ReturnType<typeof desktopRpc>>>(
    CHANNELS.DESKTOP_RPC,
    (payload) => desktopRpc(payload),
  );

  // Legacy: content scripts use chrome.runtime.sendMessage directly with a
  // {__matrx, kind: PAGE_NAVIGATED, payload} envelope (see src/lib/content/bridge.ts).
  on<{ url: string }, { ack: true }>(CHANNELS.PAGE_NAVIGATED, async (payload) => {
    if (!payload?.url) return { ack: true };
    const captured = await lookupCapturedByUrl(payload.url);
    if (captured) {
      broadcast(CHANNELS.PAGE_ALREADY_CAPTURED, {
        url: payload.url,
        capturedAt: captured.captured_at,
        id: captured.id,
      });
    }
    return { ack: true };
  });

  on<{ fields: { name: string; selector: string }[] }, { ack: true }>(
    CHANNELS.DATA_PICKER_RESULT,
    (payload) => {
      broadcast(CHANNELS.DATA_PICKER_RESULT, payload);
      return { ack: true };
    },
  );

  on<unknown, { ack: true }>(CHANNELS.DATA_PICKER_EXIT, () => {
    broadcast(CHANNELS.DATA_PICKER_EXIT, {});
    return { ack: true };
  });

  on<unknown, { ack: true }>(CHANNELS.LIST_PICKER_RESULT, (payload) => {
    broadcast(CHANNELS.LIST_PICKER_RESULT, payload);
    return { ack: true };
  });

  on<unknown, { ack: true }>(CHANNELS.LIST_PICKER_EXIT, () => {
    broadcast(CHANNELS.LIST_PICKER_EXIT, {});
    return { ack: true };
  });

  on<unknown, { ack: true }>(CHANNELS.LIST_PICKER_ITEM_DETECTED, (payload) => {
    broadcast(CHANNELS.LIST_PICKER_ITEM_DETECTED, payload);
    return { ack: true };
  });

  // Demo recording: in-page event-capture function calls
  // chrome.runtime.sendMessage with a DEMO_EVENT envelope. We forward to
  // the recorder's per-tab state.
  on<CapturedEvent, { ack: true }>(CHANNELS.DEMO_EVENT, (payload, sender) => {
    onCapturedEvent(payload, sender.tab?.id);
    return { ack: true };
  });

  // Network capture: ISOLATED-world relay forwards every intercepted
  // fetch/XHR via NET_CAPTURE_EVENT. We just rebroadcast — sidepanel buffers.
  on<unknown, { ack: true }>(CHANNELS.NET_CAPTURE_EVENT, (payload) => {
    broadcast(CHANNELS.NET_CAPTURE_EVENT, payload);
    return { ack: true };
  });

  // WebMCP: pages on the allowlist (see src/lib/origin-allowlist.ts) can
  // call our registered tools through `navigator.modelContext.callTool`.
  // The webmcp-bridge content script forwards each call here; we resolve
  // the handler, run it, and reply with `{ ok, result?, error? }`.
  on<
    { callId: string; toolName: string; args: unknown },
    { ok: boolean; result?: unknown; error?: string }
  >(CHANNELS.WEBMCP_CALL, async (payload, sender) => {
    const senderUrl = sender.tab?.url ?? sender.url ?? '';
    if (!senderUrl || !matchesAllowedOrigin(senderUrl)) {
      return { ok: false, error: 'webmcp: origin not allowed' };
    }
    const mode = await readDefaultPermissionMode();
    return handleWebmcpCall(payload, { permissionMode: mode });
  });
}

async function readDefaultPermissionMode(): Promise<'ask' | 'act'> {
  try {
    const r = await chrome.storage.local.get(['matrx.settings']);
    const settings = r['matrx.settings'] as { defaultPermissionMode?: 'ask' | 'act' } | undefined;
    if (settings?.defaultPermissionMode === 'act') return 'act';
  } catch {
    // fall through to default
  }
  return 'ask';
}

function registerWebmcpTabUpdateGate(): void {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    const url = tab.url;
    if (!url || !matchesAllowedOrigin(url)) return;
    try {
      const isAdmin = await readIsAdmin();
      const result = await registerToolsOnActiveTab({ isAdmin, tabId });
      if (result.ok) {
        log.info('sw',`registered ${result.count ?? 0} tools on ${url}`);
      } else if (result.reason && result.reason !== 'WebMCP unavailable') {
        // Don't log "WebMCP unavailable" — it's the expected state on
        // any Chrome older than 146.
        log.info('sw',`register skipped: ${result.reason}`, { url });
      }
    } catch (err) {
      log.warn('sw', `webmcp register failed`, err);
    }
  });
}

async function readIsAdmin(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get([STORAGE_KEYS.IS_ADMIN]);
    return r[STORAGE_KEYS.IS_ADMIN] === true;
  } catch {
    return false;
  }
}

/**
 * Phase 2 C1.b — listen for `chrome.runtime.sendMessage(extId, envelope)`
 * from allowlisted page origins (configured in `wxt.config.ts`'s
 * `externally_connectable.matches`). Validate the origin against the same
 * allowlist used by WebMCP, validate the envelope shape with Zod, route
 * through `handleFrontendRpc`.
 */
function registerFrontendRpcExternalListener(): void {
  if (!chrome.runtime.onMessageExternal) {
    log.warn('sw', 'chrome.runtime.onMessageExternal unavailable — frontend bridge disabled');
    return;
  }
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    // Filter to FRONTEND_RPC envelopes only — Chrome may also deliver
    // messages from other extensions / contexts.
    if (
      !msg ||
      typeof msg !== 'object' ||
      (msg as { channel?: unknown }).channel !== FRONTEND_RPC_CHANNEL
    ) {
      // Not for us; let other listeners (if any) handle it.
      return false;
    }

    // Origin gate. Manifest's externally_connectable already gates ON
    // ORIGIN at the platform layer, but we double-check defensively
    // because Chrome's ID-based externally_connectable (NOT used here)
    // bypasses host matching.
    const senderUrl = sender.url ?? sender.origin ?? '';
    if (!senderUrl || !matchesAllowedOrigin(senderUrl)) {
      const requestId =
        typeof (msg as { requestId?: unknown }).requestId === 'string'
          ? (msg as { requestId: string }).requestId
          : '';
      const reply: FrontendRpcResponse = {
        ok: false,
        error: 'origin not allowed',
        requestId,
      };
      sendResponse(reply);
      log.warn('sw', `frontend-rpc rejected from ${senderUrl}`);
      return false;
    }

    const parsed = FrontendRpcEnvelopeSchema.safeParse(msg);
    if (!parsed.success) {
      const requestId =
        typeof (msg as { requestId?: unknown }).requestId === 'string'
          ? (msg as { requestId: string }).requestId
          : '';
      const reply: FrontendRpcResponse = {
        ok: false,
        error: `invalid envelope: ${JSON.stringify(parsed.error.format())}`,
        requestId,
      };
      sendResponse(reply);
      return false;
    }

    handleFrontendRpc(parsed.data, { url: senderUrl, origin: sender.origin })
      .then((response) => {
        // Optional Debug-tab buffer (no-op when disabled).
        recordBridgeTraffic({
          stream: 'frontend-rpc',
          direction: 'in',
          action: parsed.data.action,
          requestId: parsed.data.requestId,
          sender: senderUrl,
          payload: parsed.data.payload,
          response,
          ok: response.ok,
          error: response.ok ? undefined : response.error,
        });
        try {
          sendResponse(response);
        } catch {
          // Channel may have closed; nothing we can do.
        }
      })
      .catch((err) => {
        const reply: FrontendRpcResponse = {
          ok: false,
          error: (err as Error)?.message ?? 'handler crashed',
          requestId: parsed.data.requestId,
        };
        recordBridgeTraffic({
          stream: 'frontend-rpc',
          direction: 'in',
          action: parsed.data.action,
          requestId: parsed.data.requestId,
          sender: senderUrl,
          payload: parsed.data.payload,
          response: reply,
          ok: false,
          error: reply.error,
        });
        try {
          sendResponse(reply);
        } catch {
          /* channel closed */
        }
      });
    return true; // keep the message channel open for async sendResponse
  });
  log.info('sw', 'frontend-rpc external listener installed');
}

/**
 * Phase 2 C2 — register an inbound handler for the WS reverse channel.
 *
 * Two kinds of inbound payloads:
 *
 *   1. `{ type: "extension.invoke", callId, toolName, args }` — matrx-local
 *      asks the browser to run a registered tool. Routed through the same
 *      `handleWebmcpCall` path used by WebMCP and FRONTEND_RPC for uniform
 *      permission gating.
 *
 *   2. `{ type: "ws.catalog-stale" }` — the offscreen document detected a
 *      tool_catalog_hash mismatch on a pong. Kick off a background HTTP
 *      RPC `capabilities` refetch so the cached desktop capability state
 *      is brought back in sync.
 */
function registerWsReverseInvocationHandler(): void {
  onWsMessage((payload) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    const type = p.type as string | undefined;

    if (type === 'extension.invoke') {
      void handleExtensionInvoke(p);
      return;
    }
    if (type === 'ws.catalog-stale') {
      void handleCatalogStale();
      return;
    }
    // pong / other server frames are observed via this hook for telemetry
    // but require no SW action.
  });
}

async function handleExtensionInvoke(p: Record<string, unknown>): Promise<void> {
  const callId = typeof p.callId === 'string' ? p.callId : '';
  const toolName = typeof p.toolName === 'string' ? p.toolName : '';
  const args = p.args;
  if (!callId || !toolName) {
    log.warn('sw', 'ws extension.invoke missing callId/toolName', p);
    return;
  }
  const permissionMode = await readDefaultPermissionMode();
  const result = await handleWebmcpCall(
    { callId, toolName, args },
    { permissionMode },
  );
  // Wire result back to the engine.
  const wireFrame = result.ok
    ? { type: 'extension.result', callId, ok: true, result: result.result }
    : {
        type: 'extension.result',
        callId,
        ok: false,
        error: result.error ?? 'tool failed',
      };
  try {
    await sendWs(wireFrame);
  } catch (err) {
    log.warn('sw', `ws extension.result send failed for ${callId}`, (err as Error).message);
  }
}

async function handleCatalogStale(): Promise<void> {
  log.info('sw', 'ws catalog-stale → refetching capabilities');
  try {
    const r = await desktopRpc({ command: 'capabilities' });
    if (!r.ok) {
      log.warn('sw', 'capabilities refetch failed', r.error);
      return;
    }
    // The bridge state caches health, not capabilities — stash the result
    // under a stable key so any UI that wants the freshest catalog can pick
    // it up. We deliberately don't add a new typed cache module here; the
    // raw RPC response is sufficient until the consumer arrives.
    await chrome.storage.local.set({
      'matrx.desktop.lastCapabilities': {
        data: r.data,
        fetchedAt: Date.now(),
      },
    });
    log.success('sw', 'capabilities refetched and stashed');
  } catch (err) {
    log.warn('sw', 'capabilities refetch threw', (err as Error).message);
  }
}

/**
 * Pilot lifecycle listeners — CLAUDE.md roadmap item #9.
 *
 * The Pilot session ties an agent run to a specific Chrome tab group.
 * If that group disappears for any reason that didn't go through
 * `usePilotStore.endSession()` (user manually closed the last tab, user
 * removed the group from the strip, Chrome restored a session without it),
 * we need to reset the persisted record so the Pilot view UI doesn't keep
 * showing "session active" forever.
 *
 * Two signals catch every disappearance path:
 *   - `chrome.tabs.onRemoved` fires when the LAST tab in the group goes
 *     away; Chrome auto-removes the (now-empty) group. The check here
 *     scans the group: if zero tabs remain, reset.
 *   - `chrome.tabGroups.onRemoved` fires when the group is dissolved
 *     directly (user right-clicks → ungroup, etc.).
 *
 * Both listeners read the persisted session through the zustand store —
 * which itself is hydrated from `chrome.storage.local`, so the SW always
 * has the latest record even after a wake from idle.
 */
function registerPilotLifecycleListeners(): void {
  if (chrome.tabGroups?.onRemoved) {
    chrome.tabGroups.onRemoved.addListener((group) => {
      const session = usePilotStore.getState().session;
      if (session.active && session.groupId === group.id) {
        log.info('pilot', `tabGroups.onRemoved → resetting session group=${group.id}`);
        usePilotStore.getState().resetLocal();
      }
    });
  } else {
    log.warn('pilot', 'chrome.tabGroups.onRemoved unavailable — cannot watch for external group dissolution');
  }
  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener(async () => {
      const session = usePilotStore.getState().session;
      if (!session.active || session.groupId == null) return;
      // Has the group gone empty? Chrome auto-removes empty groups, but
      // tabGroups.onRemoved fires AFTER the last tab's onRemoved settles —
      // so on some platforms the group is briefly observable. Cheaper and
      // more robust to count surviving tabs.
      try {
        const survivors = await chrome.tabs.query({ groupId: session.groupId });
        if (survivors.length === 0) {
          log.info('pilot', 'tabs.onRemoved → group empty, resetting session');
          usePilotStore.getState().resetLocal();
        }
      } catch {
        /* the group may already be gone — onRemoved listener will catch it */
      }
    });
  }
}

async function rehydrateSupabaseSession(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN_ENC,
    STORAGE_KEYS.REFRESH_TOKEN_IV,
  ]);
  const access = stored[STORAGE_KEYS.ACCESS_TOKEN] as string | undefined;
  if (!access) return;
  const { decryptString } = await import('@/lib/auth/crypto');
  const ct = stored[STORAGE_KEYS.REFRESH_TOKEN_ENC] as string | undefined;
  const iv = stored[STORAGE_KEYS.REFRESH_TOKEN_IV] as string | undefined;
  if (!ct || !iv) return;
  try {
    const refresh = await decryptString({ ct, iv });
    await setSupabaseSession(access, refresh);
  } catch (err) {
    console.warn('[matrx-extend] rehydrate failed', err);
  }
}
