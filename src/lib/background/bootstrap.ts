/**
 * SW initialization. Called lazily from entrypoints/background.ts on first
 * event so we don't pay the cost on every wake.
 *
 * Wires up:
 *   - chrome.alarms: token-refresh, desktop-probe
 *   - webext-bridge handlers: stream:start/cancel, scrape orchestration,
 *     auth flows, desktop RPC
 *   - chrome.runtime.onMessage hook for ad-hoc content-script signals
 *     (page navigation, picker results)
 */

import { ALARMS } from '@/config/env';
import { STORAGE_KEYS } from '@/config/env';
import {
  getAccessToken,
  getCurrentUser,
  refreshAccessToken,
  signIn,
  signOut,
} from '@/lib/auth/flow';
import { desktopRpc, probeDesktop, startDesktopProbeAlarm } from '@/lib/desktop/bridge';
import { CHANNELS } from '@/lib/messaging/schemas';
import { type StartStreamArgs, cancelStream, startStream } from '@/lib/stream/offscreen-proxy';
import { setSupabaseSession } from '@/lib/supabase/client';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { onMessage, sendMessage } from 'webext-bridge/background';

let bootstrapped = false;

export async function bootstrapBackground(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  console.log('[matrx-extend] background bootstrap');

  registerHandlers();
  setupAlarms();
  await rehydrateSupabaseSession();
  startDesktopProbeAlarm();
  void probeDesktop();
}

function setupAlarms(): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARMS.TOKEN_REFRESH) {
      console.log('[matrx-extend] alarm: token refresh');
      await refreshAccessToken();
      await rehydrateSupabaseSession();
    } else if (alarm.name === ALARMS.DESKTOP_PROBE) {
      const state = await probeDesktop();
      void sendMessage(
        CHANNELS.DESKTOP_AVAILABILITY as never,
        { transport: state.transport, lastChecked: state.lastChecked } as never,
        'sidepanel' as never,
      ).catch(() => undefined);
    }
  });
}

function registerHandlers(): void {
  // Auth
  onMessage(CHANNELS.AUTH_SIGN_IN as never, async () => {
    const result = await signIn();
    await rehydrateSupabaseSession();
    void sendMessage(
      CHANNELS.AUTH_STATE_CHANGED as never,
      { user: { id: result.user.id, email: result.user.email } } as never,
      'sidepanel' as never,
    ).catch(() => undefined);
    return { user: result.user } as never;
  });

  onMessage(CHANNELS.AUTH_SIGN_OUT as never, async () => {
    await signOut();
    void sendMessage(
      CHANNELS.AUTH_STATE_CHANGED as never,
      { user: null } as never,
      'sidepanel' as never,
    ).catch(() => undefined);
    return { ok: true } as never;
  });

  // Streaming proxy
  onMessage(CHANNELS.STREAM_START as never, async (msg: { data: unknown }) => {
    await startStream(msg.data as StartStreamArgs);
    return { ok: true } as never;
  });
  onMessage(CHANNELS.STREAM_CANCEL as never, async (msg: { data: unknown }) => {
    const { runId } = msg.data as { runId: string };
    await cancelStream(runId);
    return { ok: true } as never;
  });
  onMessage(CHANNELS.STREAM_CHUNK as never, async (msg: { data: unknown }) => {
    void sendMessage(CHANNELS.STREAM_CHUNK as never, msg.data as never, 'sidepanel' as never).catch(
      () => undefined,
    );
    return { ok: true } as never;
  });

  // Desktop RPC pass-through
  onMessage(CHANNELS.DESKTOP_RPC as never, async (msg: { data: unknown }) => {
    return desktopRpc(msg.data as Parameters<typeof desktopRpc>[0]) as never;
  });

  // Page navigation hint from content scripts (legacy chrome.runtime.sendMessage).
  chrome.runtime.onMessage.addListener((rawMsg, _sender, sendResponse) => {
    if (!rawMsg || typeof rawMsg !== 'object' || !('__matrx' in rawMsg)) return false;
    const m = rawMsg as { kind: string; url?: string; fields?: unknown };
    void (async () => {
      if (m.kind === CHANNELS.PAGE_NAVIGATED && m.url) {
        const captured = await lookupCapturedByUrl(m.url);
        if (captured) {
          void sendMessage(
            CHANNELS.PAGE_ALREADY_CAPTURED as never,
            { url: m.url, capturedAt: captured.captured_at, id: captured.id } as never,
            'sidepanel' as never,
          ).catch(() => undefined);
        }
      } else if (m.kind === CHANNELS.DATA_PICKER_RESULT) {
        void sendMessage(
          CHANNELS.DATA_PICKER_RESULT as never,
          { fields: m.fields ?? [] } as never,
          'sidepanel' as never,
        ).catch(() => undefined);
      } else if (m.kind === CHANNELS.DATA_PICKER_EXIT) {
        void sendMessage(
          CHANNELS.DATA_PICKER_EXIT as never,
          {} as never,
          'sidepanel' as never,
        ).catch(() => undefined);
      }
      sendResponse({ ok: true });
    })();
    return true; // async response
  });
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

export { getAccessToken, getCurrentUser };
