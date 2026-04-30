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
import { refreshAccessToken } from '@/lib/auth/flow';
import { log, startDebugRelay } from '@/lib/debug/log';
import { desktopRpc, probeDesktop, startDesktopProbeAlarm } from '@/lib/desktop/bridge';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { type StartStreamArgs, cancelStream, startStream } from '@/lib/stream/offscreen-proxy';
import { setSupabaseSession } from '@/lib/supabase/client';
import { lookupCapturedByUrl } from '@/lib/supabase/queries';
import { startToolDispatcher } from '@/lib/tools/dispatch';

let bootstrapped = false;

export function bootstrapBackground(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  startDebugRelay();
  log.info('sw', 'background bootstrap (sync)');

  // ── 1. Register message handlers SYNCHRONOUSLY so they're ready immediately.
  registerHandlers();

  // ── 2. Tool dispatcher subscribes to STREAM_OPENED + STREAM_CHUNK.
  //       Per-run permission mode is latched from the chat hook; this default
  //       only kicks in if the sidepanel forgot to pass one.
  startToolDispatcher({ defaultPermissionMode: () => 'ask' });

  // ── 3. Alarms — also synchronous registration.
  setupAlarms();
  startDesktopProbeAlarm();

  // ── 3. Async housekeeping: rehydrate Supabase session, probe desktop.
  void rehydrateSupabaseSession();
  void probeDesktop().then((state) => {
    lastDesktopTransport = state.transport;
    broadcast(CHANNELS.DESKTOP_AVAILABILITY, {
      transport: state.transport,
      lastChecked: state.lastChecked,
    });
  });
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
        lastDesktopTransport = state.transport;
        log.info('desktop', `transport changed → ${state.transport}`);
        broadcast(CHANNELS.DESKTOP_AVAILABILITY, {
          transport: state.transport,
          lastChecked: state.lastChecked,
        });
      }
    }
  });
}

function registerHandlers(): void {
  on<StartStreamArgs, { ok: boolean }>(CHANNELS.STREAM_START, async (payload) => {
    await startStream(payload);
    return { ok: true };
  });

  on<{ runId: string }, { ok: boolean }>(CHANNELS.STREAM_CANCEL, async (payload) => {
    await cancelStream(payload.runId);
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
