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
const consoleBuffers = new Map<number, ConsoleRecord[]>();

export interface ConsoleRecord {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose' | string;
  text: string;
  url?: string;
  line?: number;
  column?: number;
  ts_ms: number;
}

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

/**
 * Idle auto-detach (audit P2-7). The "is being debugged" banner used to
 * persist FOREVER after a run: the cdp.ts header claimed "we auto-detach
 * when the run ends" but no run-end detach existed anywhere — and detaching
 * on the stream's terminal event would be wrong anyway (aidream
 * hard-suspends the stream around EVERY delegated tool call, so multi-step
 * CDP workflows span many short streams). Instead: every attach/send
 * touches a per-tab idle timer; 10 minutes without any CDP command =
 * detach + buffer cleanup. In-memory timers die with the SW, so
 * `reconcileOnBoot` (called from bootstrap) also sweeps attachments that
 * survived an SW restart with no live timer.
 */
const IDLE_DETACH_MS = 10 * 60_000;
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

function touchIdleTimer(tabId: number): void {
  const prev = idleTimers.get(tabId);
  if (prev) clearTimeout(prev);
  idleTimers.set(
    tabId,
    setTimeout(() => {
      idleTimers.delete(tabId);
      void detach(tabId);
    }, IDLE_DETACH_MS),
  );
}

/**
 * Bootstrap hook (audit P1: listeners were registered lazily inside
 * attach(), so an SW restart with a surviving chrome.debugger attachment
 * dropped every Network/Console event and never saw onDetach). Called
 * synchronously from the SW bootstrap; also detaches attachments orphaned
 * by the restart — the in-memory buffers/capture state they fed are gone,
 * so a lingering attachment is pure stuck-banner.
 */
export function reconcileOnBoot(): void {
  try {
    installListeners();
    chrome.debugger.getTargets((targets) => {
      for (const t of targets) {
        if (t.attached && typeof t.tabId === 'number' && !attachedTabs.has(t.tabId)) {
          // Attached but not in OUR memory — either another debugger (the
          // detach below fails harmlessly) or our own pre-restart orphan.
          chrome.debugger.detach({ tabId: t.tabId }, () => {
            // Swallow lastError — not-ours / already-detached are both fine.
            void chrome.runtime.lastError;
          });
        }
      }
    });
  } catch {
    /* debugger permission can be absent in dev builds — never block boot */
  }
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
      consoleBuffers.delete(source.tabId);
    }
  });
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (typeof source.tabId !== 'number') return;
    if (networkBuffers.has(source.tabId)) {
      handleNetworkEvent(source.tabId, method, params as Record<string, unknown>);
    }
    if (consoleBuffers.has(source.tabId)) {
      handleConsoleEvent(source.tabId, method, params as Record<string, unknown>);
    }
  });
}

function handleConsoleEvent(tabId: number, method: string, params: Record<string, unknown>): void {
  const buf = consoleBuffers.get(tabId);
  if (!buf) return;
  if (method === 'Runtime.consoleAPICalled') {
    const args = (params.args as Array<{ value?: unknown; description?: string }>) ?? [];
    const text = args
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
      .join(' ');
    const stack = (
      params.stackTrace as {
        callFrames?: Array<{ url?: string; lineNumber?: number; columnNumber?: number }>;
      }
    )?.callFrames?.[0];
    buf.push({
      level: String(params.type ?? 'log'),
      text,
      url: stack?.url,
      line: stack?.lineNumber,
      column: stack?.columnNumber,
      ts_ms: Date.now(),
    });
  } else if (method === 'Runtime.exceptionThrown') {
    const ex = params.exceptionDetails as
      | {
          text?: string;
          url?: string;
          lineNumber?: number;
          columnNumber?: number;
          exception?: { description?: string };
        }
      | undefined;
    buf.push({
      level: 'error',
      text: ex?.exception?.description ?? ex?.text ?? 'unknown exception',
      url: ex?.url,
      line: ex?.lineNumber,
      column: ex?.columnNumber,
      ts_ms: Date.now(),
    });
  }
}

export async function startConsoleCapture(tabId: number): Promise<void> {
  installListeners();
  if (!attachedTabs.has(tabId)) {
    const r = await attach(tabId);
    if (!r.ok) throw new Error(`attach failed: ${r.reason}`);
  }
  if (!consoleBuffers.has(tabId)) {
    consoleBuffers.set(tabId, []);
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
  }
}

export async function stopConsoleCapture(tabId: number): Promise<void> {
  if (!consoleBuffers.has(tabId)) return;
  consoleBuffers.delete(tabId);
}

export function drainConsoleCapture(
  tabId: number,
  opts?: { max?: number; level_filter?: string[]; pattern?: RegExp; clear?: boolean },
): ConsoleRecord[] {
  const buf = consoleBuffers.get(tabId);
  if (!buf) return [];
  const max = opts?.max ?? 200;
  // Default: drain (remove from buffer). Pass clear:false to peek without removing,
  // matching canonical `read_console_messages(clear:false)` semantics.
  let records: ConsoleRecord[] = opts?.clear === false ? buf.slice(0, max) : buf.splice(0, max);
  if (opts?.level_filter?.length) {
    const set = new Set(opts.level_filter);
    records = records.filter((r) => set.has(r.level));
  }
  if (opts?.pattern) {
    records = records.filter((r) => opts.pattern!.test(r.text));
  }
  return records;
}

function handleNetworkEvent(tabId: number, method: string, params: Record<string, unknown>): void {
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
    touchIdleTimer(tabId);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? String(err) };
  }
}

export async function detach(tabId: number): Promise<{ ok: boolean; reason?: string }> {
  const timer = idleTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    idleTimers.delete(tabId);
  }
  try {
    await chrome.debugger.detach({ tabId });
    attachedTabs.delete(tabId);
    networkBuffers.delete(tabId);
    networkRequests.delete(tabId);
    // Console buffers too (audit P2-7) — they held captured page output
    // (request bodies, auth headers, console text) keyed only by tabId,
    // drainable by a LATER conversation on the same tab.
    consoleBuffers.delete(tabId);
    return { ok: true };
  } catch (err) {
    attachedTabs.delete(tabId);
    networkBuffers.delete(tabId);
    networkRequests.delete(tabId);
    consoleBuffers.delete(tabId);
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
  touchIdleTimer(tabId);
  const result = (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
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
    await chrome.debugger.sendCommand({ tabId }, 'Network.disable').catch(() => {});
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
