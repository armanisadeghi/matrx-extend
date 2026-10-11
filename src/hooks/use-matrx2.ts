import type { Matrx2State } from '@/lib/desktop/matrx2/connection';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useCallback, useEffect, useState } from 'react';

/** Matrx 2's connection to this browser, as the service worker holds it, kept live. */
export function useMatrx2(): { state: Matrx2State | null; reconnect: () => Promise<void> } {
  const [state, setState] = useState<Matrx2State | null>(null);
  useEffect(() => {
    let alive = true;
    void send<unknown, Matrx2State>(CHANNELS.MATRX2_GET_STATE, {})
      .then((s) => {
        if (alive) setState(s);
      })
      .catch(() => undefined);
    const off = on<Matrx2State, { ack: true }>(CHANNELS.MATRX2_STATE, (s) => {
      setState(s);
      return { ack: true };
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  const reconnect = useCallback(async () => {
    const s = await send<unknown, Matrx2State>(CHANNELS.MATRX2_RECONNECT, {}).catch(() => null);
    if (s) setState(s);
  }, []);
  return { state, reconnect };
}

/** What a person reads for each state. */
export function matrx2StatusText(state: Matrx2State | null): string {
  if (!state) return 'Checking…';
  switch (state.status) {
    case 'not_found':
      return 'Matrx 2 is not running on this computer';
    case 'off':
      return 'Browser connection is off in Matrx 2';
    case 'connecting':
      return 'Connecting…';
    case 'disconnected':
      return 'Disconnected in Matrx 2';
    case 'error':
      return state.lastError ?? 'Could not connect';
    case 'connected': {
      const s = state.session?.state;
      if (s === 'connected') return 'Connected';
      if (s === 'different_account') return 'Signed in to a different account than Matrx 2';
      if (s === 'extension_signed_out')
        return 'Sign in to AI Matrx to let Matrx 2 use this browser';
      if (s === 'device_signed_out') return 'Matrx 2 is signed out';
      return 'Account not checked yet';
    }
  }
}
