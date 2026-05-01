/**
 * Chrome DevTools Protocol (CDP) client backed by `chrome.debugger`.
 *
 * Lifecycle:
 *   attach(tabId)   → opens CDP session, enables Page + Runtime + Network as
 *                    needed, marks tab as attached
 *   detach(tabId)   → closes session, removes listener
 *   send(tabId, method, params) → low-level CDP call
 *
 * The wrapper keeps a Set of attached tabIds so we don't call `attach` twice
 * (Chrome errors). It also subscribes to `chrome.debugger.onDetach` so we
 * notice when the user clicks "stop debugging" or the tab closes, and the
 * agent can recover by re-attaching.
 *
 * Network capture support: when capture is enabled, every Network event is
 * buffered per-tab so the agent can dump it on demand without subscribing to
 * a stream.
 */

const PROTOCOL_VERSION = '1.3';

const attachedTabs = new Set<number>();
const networkBuffers = new Map<number, NetworkRecord[]>();
const networkRequests = new Map<number, Map<string, Partial<NetworkRecord>>>();

interface NetworkRecord {
  request_id: string;
  url: string;
  method: string;
  status?: number;
  status_text?: string;
  mime_type?: string;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  body?: string;
  body_base64?: boolean;
  finished?: boolean;
  failed?: boolean;
  error_text?: string;
  ts_ms: number;
}

let listenersInstalled = false;

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  chrome.debugger.onDetach.addListener((source, _reason) => {
    if (typeof source.tabId === 'number') {
      attachedTabs.delete(source.tabId);
      networkBuffers.delete(source.tabId);
      networkRequests.delete(source.tabId);
    }
  });
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (typeof source.tabId !== 'number') return;
    if (!networkBuffers.has(source.tabId)) return;
    handleNetworkEvent(source.tabId, method, params as Record<string, unknown>);
  });
}

function handleNetworkEvent(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
): void {
  const requests = networkRequests.get(tabId);
  if (!requests) return;
  const requestId = params.requestId as string | undefined;
  if (!requestId) return;
  const existing = requests.get(requestId) ?? { ts_ms: Date.now() };

  if (method === 'Network.requestWillBeSent') {
    const req = (params.request ?? {}) as Record<string, unknown>;
    existing.request_id = requestId;
    existing.url = String(req.url ?? '');
    existing.method = String(req.method ?? 'GET');
    existing.request_headers = (req.headers ?? {}) as Record<string, string>;
    existing.ts_ms = Date.now();
    requests.set(requestId, existing);
  } else if (method === 'Network.responseReceived') {
    const res = (params.response ?? {}) as Record<string, unknown>;
    existing.status = Number(res.status ?? 0);
    existing.status_text = String(res.statusText ?? '');
    existing.mime_type = String(res.mimeType ?? '');
    existing.response_headers = (res.headers ?? {}) as Record<string, string>;
    requests.set(requestId, existing);
  } else if (method === 'Network.loadingFinished') {
    existing.finished = true;
    requests.set(requestId, existing);
    // Move to buffer.
    networkBuffers.get(tabId)?.push(existing as NetworkRecord);
    requests.delete(requestId);
  } else if (method === 'Network.loadingFailed') {
    existing.failed = true;
    existing.error_text = String(params.errorText ?? '');
    requests.set(requestId, existing);
    networkBuffers.get(tabId)?.push(existing as NetworkRecord);
    requests.delete(requestId);
  }
}

export function isAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

export function attachedTabsList(): number[] {
  return Array.from(attachedTabs);
}

export async function attach(tabId: number): Promise<{ ok: boolean; reason?: string }> {
  installListeners();
  if (attachedTabs.has(tabId)) return { ok: true };
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    attachedTabs.add(tabId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? String(err) };
  }
}

export async function detach(tabId: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    await chrome.debugger.detach({ tabId });
    attachedTabs.delete(tabId);
    networkBuffers.delete(tabId);
    networkRequests.delete(tabId);
    return { ok: true };
  } catch (err) {
    attachedTabs.delete(tabId);
    return { ok: false, reason: (err as Error).message ?? String(err) };
  }
}

export async function send<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!attachedTabs.has(tabId)) {
    const r = await attach(tabId);
    if (!r.ok) throw new Error(`attach failed: ${r.reason}`);
  }
  const result = (await chrome.debugger.sendCommand(
    { tabId },
    method,
    params,
  )) as T;
  return result;
}

export async function startNetworkCapture(tabId: number): Promise<void> {
  installListeners();
  if (!attachedTabs.has(tabId)) {
    const r = await attach(tabId);
    if (!r.ok) throw new Error(`attach failed: ${r.reason}`);
  }
  if (!networkBuffers.has(tabId)) {
    networkBuffers.set(tabId, []);
    networkRequests.set(tabId, new Map());
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  }
}

export async function stopNetworkCapture(tabId: number): Promise<void> {
  if (!networkBuffers.has(tabId)) return;
  networkBuffers.delete(tabId);
  networkRequests.delete(tabId);
  if (attachedTabs.has(tabId)) {
    await chrome.debugger
      .sendCommand({ tabId }, 'Network.disable')
      .catch(() => {});
  }
}

export function drainNetworkCapture(tabId: number, max = 200): NetworkRecord[] {
  const buf = networkBuffers.get(tabId);
  if (!buf) return [];
  const out = buf.splice(0, max);
  return out;
}

/** Fetch the body for one captured request (lazy — bodies are big). */
export async function fetchResponseBody(
  tabId: number,
  requestId: string,
): Promise<{ body: string; base64Encoded: boolean }> {
  return send<{ body: string; base64Encoded: boolean }>(tabId, 'Network.getResponseBody', {
    requestId,
  });
}
