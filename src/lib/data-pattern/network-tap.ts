/**
 * MAIN-world fetch/XHR interceptor + ISOLATED-world relay.
 *
 * These two functions cross the chrome.scripting boundary as `func:` payloads
 * (toString'd and re-evaluated in the page). They MUST be self-contained.
 *
 * Architecture:
 *   page MAIN world  → window.postMessage         (via networkTapMain)
 *   page ISOLATED    → chrome.runtime.sendMessage (via networkRelayIsolated)
 *   service worker   → broadcast NET_CAPTURE_EVENT
 *   sidepanel        → on(NET_CAPTURE_EVENT)
 */

export interface CapturedNetEvent {
  ts_ms: number;
  source: 'fetch' | 'xhr';
  method: string;
  url: string;
  status: number;
  status_text?: string;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  body: string;
  body_truncated: boolean;
  body_size: number;
  content_type?: string;
}

/**
 * Runs in MAIN world. Patches fetch + XMLHttpRequest. Idempotent — uses a
 * sentinel on window to avoid double-patching if executed multiple times.
 */
export function networkTapMain(maxBodyBytes = 1_000_000): void {
  const SENTINEL = '__matrx_net_tap_installed__';
  type W = Window & { [K in typeof SENTINEL]?: boolean };
  const w = window as W;
  if (w[SENTINEL]) return;
  w[SENTINEL] = true;

  const post = (event: Record<string, unknown>) => {
    try {
      window.postMessage({ __matrx_net: true, event }, window.location.origin);
    } catch {
      // ignore
    }
  };

  const truncate = (s: string): { body: string; truncated: boolean; size: number } => {
    const size = s.length;
    return size > maxBodyBytes
      ? { body: s.slice(0, maxBodyBytes), truncated: true, size }
      : { body: s, truncated: false, size };
  };

  const headersToObj = (h: Headers): Record<string, string> => {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  };

  // ── fetch patch ─────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const t0 = Date.now();
    const reqUrl =
      typeof args[0] === 'string'
        ? args[0]
        : args[0] instanceof URL
          ? args[0].href
          : (args[0] as Request).url;
    const reqMethod =
      typeof args[0] === 'string' || args[0] instanceof URL
        ? (args[1]?.method ?? 'GET')
        : ((args[0] as Request).method ?? 'GET');

    let res: Response;
    try {
      res = await origFetch.apply(this, args);
    } catch (err) {
      post({
        ts_ms: t0,
        source: 'fetch',
        method: reqMethod,
        url: reqUrl,
        status: 0,
        body: '',
        body_truncated: false,
        body_size: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // Clone the body off the response so the page still gets the original.
    res
      .clone()
      .text()
      .then((text) => {
        const t = truncate(text);
        post({
          ts_ms: t0,
          source: 'fetch',
          method: reqMethod,
          url: reqUrl,
          status: res.status,
          status_text: res.statusText,
          response_headers: headersToObj(res.headers),
          body: t.body,
          body_truncated: t.truncated,
          body_size: t.size,
          content_type: res.headers.get('content-type') ?? undefined,
        });
      })
      .catch(() => {
        // body might be a stream that's already consumed elsewhere; ignore
      });

    return res;
  };

  // ── XHR patch ───────────────────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR(): XMLHttpRequest {
    const xhr = new OrigXHR();
    let url = '';
    let method = 'GET';
    const t0 = Date.now();
    const origOpen = xhr.open;
    xhr.open = function (this: XMLHttpRequest, m: string, u: string | URL, ...rest: unknown[]) {
      method = m;
      url = typeof u === 'string' ? u : u.href;
      return (origOpen as unknown as (...args: unknown[]) => void).apply(this, [
        m,
        u,
        ...rest,
      ] as unknown[]);
    } as typeof xhr.open;
    xhr.addEventListener('load', () => {
      try {
        const respText =
          xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : '';
        const t = truncate(respText);
        const headersRaw = xhr.getAllResponseHeaders();
        const responseHeaders: Record<string, string> = {};
        for (const line of headersRaw.split('\r\n')) {
          const colon = line.indexOf(':');
          if (colon < 0) continue;
          responseHeaders[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
        post({
          ts_ms: t0,
          source: 'xhr',
          method,
          url,
          status: xhr.status,
          status_text: xhr.statusText,
          response_headers: responseHeaders,
          body: t.body,
          body_truncated: t.truncated,
          body_size: t.size,
          content_type: responseHeaders['content-type'],
        });
      } catch {
        // ignore
      }
    });
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  (window as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
    PatchedXHR as unknown as typeof XMLHttpRequest;
}

/**
 * Runs in ISOLATED world. Listens for window messages from the MAIN-world
 * tap and forwards via chrome.runtime.sendMessage with the NET_CAPTURE_EVENT
 * channel. Also idempotent.
 */
export function networkRelayIsolated(): void {
  const SENTINEL = '__matrx_net_relay_installed__';
  type W = Window & { [K in typeof SENTINEL]?: boolean };
  const w = window as W;
  if (w[SENTINEL]) return;
  w[SENTINEL] = true;

  window.addEventListener(
    'message',
    (e) => {
      if (e.source !== window) return;
      const data = e.data as { __matrx_net?: boolean; event?: unknown };
      if (!data || data.__matrx_net !== true) return;
      try {
        chrome.runtime.sendMessage({
          __matrx: true,
          kind: 'net-capture:event',
          payload: data.event,
        });
      } catch {
        // sidepanel may be closed; that's OK, SW still buffers
      }
    },
    false,
  );
}
