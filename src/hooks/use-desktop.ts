import type { DesktopHealth } from '@/lib/desktop/types';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useDesktopStore } from '@/state/desktop';
import { useEffect } from 'react';

export function useDesktopBridge() {
  const state = useDesktopStore();
  useEffect(() => {
    return on<
      {
        transport: 'native' | 'http' | 'none';
        health: DesktopHealth | null;
        lastChecked: number;
      },
      { ack: true }
    >(CHANNELS.DESKTOP_AVAILABILITY, (payload) => {
      useDesktopStore.getState().set({
        transport: payload.transport,
        health: payload.health ?? null,
        lastChecked: payload.lastChecked,
      });
      return { ack: true };
    });
  }, []);
  return state;
}

export async function callDesktop<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  return send<
    { command: string; args?: Record<string, unknown> },
    { ok: boolean; data?: T; error?: string }
  >(CHANNELS.DESKTOP_RPC, { command, ...(args !== undefined ? { args } : {}) });
}
