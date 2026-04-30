/**
 * Capability-detected desktop bridge. Prefers native messaging; falls back to
 * localhost HTTP. Re-probes every 30 s.
 */

import { ALARMS } from '@/config/env';
import { probeHttp, rpcHttp } from '@/lib/desktop/http';
import { probeNative, rpcNative } from '@/lib/desktop/native';
import type { DesktopHealth, DesktopRpcRequest, DesktopRpcResponse } from '@/lib/desktop/types';

export type Transport = 'native' | 'http' | 'none';

interface BridgeState {
  transport: Transport;
  health: DesktopHealth | null;
  lastChecked: number;
}

let state: BridgeState = { transport: 'none', health: null, lastChecked: 0 };
const listeners = new Set<(s: BridgeState) => void>();

export function getDesktopState(): BridgeState {
  return state;
}

export function onDesktopChange(cb: (s: BridgeState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function probeDesktop(): Promise<BridgeState> {
  const native = await probeNative();
  if (native) {
    state = { transport: 'native', health: native, lastChecked: Date.now() };
    listeners.forEach((cb) => cb(state));
    return state;
  }
  const http = await probeHttp();
  if (http) {
    state = { transport: 'http', health: http, lastChecked: Date.now() };
    listeners.forEach((cb) => cb(state));
    return state;
  }
  state = { transport: 'none', health: null, lastChecked: Date.now() };
  listeners.forEach((cb) => cb(state));
  return state;
}

export async function desktopRpc(req: DesktopRpcRequest): Promise<DesktopRpcResponse> {
  if (state.transport === 'native') return rpcNative(req);
  if (state.transport === 'http') return rpcHttp(req);
  return { ok: false, error: 'desktop unavailable' };
}

export function startDesktopProbeAlarm(): void {
  chrome.alarms.create(ALARMS.DESKTOP_PROBE, { periodInMinutes: 0.5 });
}
