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
  /** Opaque producer-computed identity; raw request data never leaves the page. */
  request_body_key?: string;
  /** Initiation order within this document, independent of response completion. */
  request_sequence?: number;
  status: number;
  status_text?: string;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  body: string;
  body_truncated: boolean;
  body_size: number;
  content_type?: string;
  /** Stamped by the SW relay from sender.tab.id — null for non-tab senders. */
  tab_id?: number | null;
}

/**
 * Runs in MAIN world. Patches fetch + XMLHttpRequest. Idempotent — uses a
 * sentinel on window to avoid double-patching if executed multiple times.
 */
export function networkTapMain(maxBodyBytes = 1_000_000, bindingName?: string): void {
  const SENTINEL = '__matrx_net_tap_installed__';
  type W = Window & { [K in typeof SENTINEL]?: { manual: boolean } };
  const w = window as W;
  if (w[SENTINEL]) {
    if (!bindingName) w[SENTINEL].manual = true;
    return;
  }
  w[SENTINEL] = { manual: !bindingName };

  let active = true;
  const post = (event: Record<string, unknown>) => {
    if (!active) return;
    try {
      if (bindingName) {
        const binding = (window as unknown as Record<string, unknown>)[bindingName];
        if (typeof binding === 'function') binding(JSON.stringify(event));
      }
      // A saved privileged capture has no page-message recipient. Only an
      // explicitly started manual capture may use the legacy isolated relay.
      if (w[SENTINEL]?.manual) window.postMessage({ __matrx_net: true, event }, window.location.origin);
    } catch {
      // ignore
    }
  };

  // `body_size` is rendered with formatFileSize, so it is UTF-8 BYTES — a
  // string's `.length` is UTF-16 code units (2026-09-12).
  //
  // AND SO IS THE CAP. `maxBodyBytes` is a BYTE budget, and until the sixth
  // adversarial review the truncation was `s.slice(0, maxBodyBytes)` — a
  // CHARACTER slice, so a body of non-ASCII text (any CJK or emoji payload)
  // was stored well ABOVE the cap it claims to enforce, up to 3× it. Bytes is
  // the honest unit here: what this cap protects is the message we post and
  // the row we store, both measured in bytes, so the budget stays bytes and
  // the slice moved to them — never the other way round.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const truncate = (s: string): { body: string; truncated: boolean; sizeBytes: number } => {
    const bytes = encoder.encode(s);
    const sizeBytes = bytes.length;
    if (sizeBytes <= maxBodyBytes) return { body: s, truncated: false, sizeBytes };
    // Never cut a multi-byte sequence in half: walk back off continuation
    // bytes (0b10xxxxxx) so the decoded tail is text, not a replacement char.
    let end = maxBodyBytes;
    while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    return { body: decoder.decode(bytes.subarray(0, end)), truncated: true, sizeBytes };
  };

  const headersToObj = (h: Headers): Record<string, string> => {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  };

  let requestSequence = 0;
  const absoluteUrl = (input: string): string => {
    try {
      const url = new URL(input, document.baseURI);
      url.hash = ''; // Fragments never reach the server.
      return url.href;
    } catch {
      return input;
    }
  };
  const digestBytes = async (bytes: ArrayBuffer): Promise<string> => {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return `sha256:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      return 'unavailable';
    }
  };
  const boundedBodyKey = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
    if (!stream) return 'none';
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBodyBytes) {
          void reader.cancel().catch(() => {});
          return 'unavailable';
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return digestBytes(bytes.buffer);
    } catch {
      return 'unavailable';
    } finally {
      reader.releaseLock();
    }
  };
  // Multipart boundaries and streaming bodies are not stable replay identities.
  // Keep their data local; the UI offers an explicit broader matcher instead.
  const bodyKey = async (
    body: XMLHttpRequestBodyInit | ReadableStream | null | undefined,
  ): Promise<string> => {
    if (body == null) return 'none';
    if (body instanceof FormData || body instanceof ReadableStream) return 'unavailable';
    try {
      return await boundedBodyKey(new Response(body).body);
    } catch {
      return 'unavailable';
    }
  };
  const fetchBodyKey = async (input: RequestInfo | URL, init?: RequestInit): Promise<string> => {
    if (init?.body != null) return bodyKey(init.body);
    if (!(input instanceof Request) || input.body === null) return 'none';
    if (input.headers.get('content-type')?.toLowerCase().includes('multipart/form-data'))
      return 'unavailable';
    try {
      return await boundedBodyKey(input.clone().body);
    } catch {
      return 'unavailable';
    }
  };

  // ── fetch patch ─────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  const patchedFetch: typeof window.fetch = async function (...args) {
    const t0 = Date.now();
    const sequence = ++requestSequence;
    const input = args[0];
    const reqUrl = absoluteUrl(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const reqMethod = (
      args[1]?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    // Clone before fetch can consume a Request. Hashing never delays the page's request.
    const identity = fetchBodyKey(input, args[1]);

    let res: Response;
    try {
      res = await origFetch.apply(window, args);
    } catch (err) {
      void identity.then((request_body_key) =>
        post({
          request_body_key,
          request_sequence: sequence,
          ts_ms: t0,
          source: 'fetch',
          method: reqMethod,
          url: reqUrl,
          status: 0,
          body: '',
          body_truncated: false,
          body_size: 0,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    }

    // Clone the body off the response so the page still gets the original.
    res
      .clone()
      .text()
      .then(async (text) => {
        const t = truncate(text);
        post({
          request_body_key: await identity,
          request_sequence: sequence,
          ts_ms: t0,
          source: 'fetch',
          method: reqMethod,
          url: reqUrl,
          status: res.status,
          status_text: res.statusText,
          ...(bindingName ? {} : { response_headers: headersToObj(res.headers) }),
          body: t.body,
          body_truncated: t.truncated,
          body_size: t.sizeBytes,
          content_type: res.headers.get('content-type') ?? undefined,
        });
      })
      .catch(() => {
        // body might be a stream that's already consumed elsewhere; ignore
      });

    return res;
  };

  window.fetch = patchedFetch;

  // ── XHR patch ───────────────────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR(): XMLHttpRequest {
    const xhr = new OrigXHR();
    let url = '';
    let method = 'GET';
    let t0 = 0;
    let sequence = 0;
    let identity: Promise<string> = Promise.resolve('none');
    const origOpen = xhr.open;
    xhr.open = function (this: XMLHttpRequest, m: string, u: string | URL, ...rest: unknown[]) {
      method = m.toUpperCase();
      url = absoluteUrl(typeof u === 'string' ? u : u.href);
      return (origOpen as unknown as (...args: unknown[]) => void).apply(this, [
        m,
        u,
        ...rest,
      ] as unknown[]);
    } as typeof xhr.open;
    const origSend = xhr.send;
    xhr.send = function (body) {
      t0 = Date.now();
      sequence = ++requestSequence;
      identity = body instanceof Document ? Promise.resolve('unavailable') : bodyKey(body);
      // Reflect preserves both native send overloads (Document and BodyInit).
      return Reflect.apply(origSend, this, [body]);
    };
    xhr.addEventListener('load', async () => {
      const requestBodyKey = identity;
      const requestSequenceAtLoad = sequence;
      const startedAt = t0;
      const requestUrl = url;
      const requestMethod = method;
      const responseStatus = xhr.status;
      const responseStatusText = xhr.statusText;
      try {
        const respText =
          xhr.responseType === 'json'
            ? JSON.stringify(xhr.response)
            : xhr.responseType === '' || xhr.responseType === 'text'
              ? xhr.responseText
              : '';
        const t = truncate(respText);
        const headersRaw = bindingName ? '' : xhr.getAllResponseHeaders();
        const responseHeaders: Record<string, string> = {};
        for (const line of headersRaw.split('\r\n')) {
          const colon = line.indexOf(':');
          if (colon < 0) continue;
          responseHeaders[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
        }
        post({
          request_body_key: await requestBodyKey,
          request_sequence: requestSequenceAtLoad,
          ts_ms: startedAt,
          source: 'xhr',
          method: requestMethod,
          url: requestUrl,
          status: responseStatus,
          status_text: responseStatusText,
          ...(bindingName ? {} : { response_headers: responseHeaders }),
          body: t.body,
          body_truncated: t.truncated,
          body_size: t.sizeBytes,
          content_type: bindingName ? xhr.getResponseHeader('content-type') : responseHeaders['content-type'],
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
  if (bindingName) {
    const cleanupKey = `${bindingName}_cleanup`;
    Object.defineProperty(window, cleanupKey, { configurable: true, value: () => {
      if (w[SENTINEL]?.manual) {
        bindingName = undefined;
        delete (window as unknown as Record<string, unknown>)[cleanupKey];
        return;
      }
      active = false;
      if (window.fetch === patchedFetch) window.fetch = origFetch;
      if (window.XMLHttpRequest === (PatchedXHR as unknown as typeof XMLHttpRequest)) window.XMLHttpRequest = OrigXHR;
      delete w[SENTINEL];
      delete (window as unknown as Record<string, unknown>)[cleanupKey];
    } });
  }
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
      } catch (err) {
        // No one is buffering: if the SW/sidepanel isn't listening the event
        // is gone. Surface it so a silently-dead capture is debuggable.
        console.warn('[matrx-net-relay] sendMessage failed:', err);
      }
    },
    false,
  );
}
