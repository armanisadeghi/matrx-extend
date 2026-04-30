import { CHANNELS } from '@/lib/messaging/schemas';
import { useDesktopStore } from '@/state/desktop';
import { useEffect } from 'react';
import { onMessage, sendMessage } from 'webext-bridge/window';

export function useDesktopBridge() {
  const state = useDesktopStore();
  useEffect(() => {
    onMessage(CHANNELS.DESKTOP_AVAILABILITY as never, (msg: { data: unknown }) => {
      const payload = msg.data as { transport: 'native' | 'http' | 'none'; lastChecked: number };
      useDesktopStore.getState().set({
        transport: payload.transport,
        lastChecked: payload.lastChecked,
      });
      return { ack: true } as never;
    });
  }, []);
  return state;
}

export async function callDesktop<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const r = (await sendMessage(
    CHANNELS.DESKTOP_RPC as never,
    { command, args: args ?? null } as never,
    'background' as never,
  )) as { ok: boolean; data?: T; error?: string };
  return r;
}
