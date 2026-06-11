/**
 * Thin typed wrappers around chrome.runtime.* messaging.
 *
 * Why not webext-bridge: the sidepanel context isn't supported by
 * webext-bridge (no `webext-bridge/sidepanel` entry), and `webext-bridge/window`
 * is for content scripts injected into the page's main world. The native
 * chrome.runtime.* API works the same from every extension context — sidepanel,
 * popup, options, content script, offscreen, SW — so we just use it.
 *
 * Wire format: `{ __matrx: true, kind: string, payload: unknown }`.
 *
 * IMPORTANT: in MV3, chrome.runtime.onMessage listeners must be registered
 * SYNCHRONOUSLY at the top level of the SW script so they're ready when the
 * SW is woken by a message. See src/lib/background/bootstrap.ts.
 */

import { log } from '@/lib/debug/log';

export interface Envelope<T = unknown> {
  __matrx: true;
  kind: string;
  payload: T;
}

const isEnvelope = (m: unknown): m is Envelope => {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as Record<string, unknown>).__matrx === true &&
    typeof (m as Record<string, unknown>).kind === 'string'
  );
};

/**
 * Send a request and await a response.
 * Throws if the receiver returned an error envelope.
 */
export async function send<TReq, TRes>(kind: string, payload: TReq): Promise<TRes> {
  const env: Envelope<TReq> = { __matrx: true, kind, payload };
  log.info('msg', `→ send ${kind}`, payload);
  try {
    const response = (await chrome.runtime.sendMessage(env)) as
      | { __error: string }
      | TRes
      | undefined;
    if (response && typeof response === 'object' && '__error' in response) {
      const err = (response as { __error: string }).__error;
      log.error('msg', `← ${kind} error`, err);
      throw new Error(err);
    }
    if (response === undefined) {
      log.warn('msg', `← ${kind} undefined response (no listener?)`);
    } else {
      log.success('msg', `← ${kind} ok`);
    }
    return response as TRes;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg?.includes('Receiving end does not exist')) {
      log.error('msg', `${kind} — no listener registered for this kind`);
    }
    throw err;
  }
}

/**
 * Same-context fan-out registry. chrome.runtime.sendMessage NEVER delivers
 * to onMessage listeners in the SENDER'S OWN document — a fact several
 * surfaces silently tripped over: the Lists hub / TaskPanel mutated storage,
 * broadcast LISTS_CHANGED, and waited for their own (never-arriving)
 * broadcast to repaint, so every user edit looked dead; ToolsView's manual
 * runs never reached the local chat timeline for the same reason. `on()`
 * registers handlers here too, and `broadcast()` fans out locally — so a
 * broadcast now behaves like a true bus: every context INCLUDING the sender.
 * `send()` (request/response) deliberately does NOT self-deliver: callers
 * like the agenda scanner's tryBroadcastRunNow depend on "no OTHER context
 * answered" semantics.
 */
const localHandlers = new Map<string, Set<(payload: unknown) => void>>();

function dispatchLocal(env: Envelope): void {
  const handlers = localHandlers.get(env.kind);
  if (!handlers) return;
  for (const h of [...handlers]) {
    try {
      h(env.payload);
    } catch (err) {
      log.error('msg', `local handler(${env.kind}) threw`, err);
    }
  }
}

/**
 * Fire-and-forget broadcast. Used for state-change notifications.
 * Delivers to every OTHER context via chrome.runtime AND to this context's
 * own `on()` listeners (see localHandlers above).
 */
export function broadcast<T>(kind: string, payload: T): void {
  const env: Envelope<T> = { __matrx: true, kind, payload };
  log.info('msg', `↗ broadcast ${kind}`);
  chrome.runtime.sendMessage(env).catch((err) => {
    const msg = (err as Error).message ?? '';
    if (msg.includes('Receiving end does not exist')) {
      // Normal when no surface is open. Don't log as warning.
      return;
    }
    log.warn('msg', `broadcast(${kind}) failed`, err);
  });
  dispatchLocal(env);
}

type AsyncHandler<TReq, TRes> = (
  payload: TReq,
  sender: chrome.runtime.MessageSender,
) => Promise<TRes> | TRes;

/**
 * Listen for a kind. Returns an unsubscribe function.
 */
export function on<TReq, TRes>(kind: string, handler: AsyncHandler<TReq, TRes>): () => void {
  // Local fan-out registration (response ignored on this path — broadcasts
  // are fire-and-forget). The fake sender carries no tab/url, matching what
  // same-extension broadcasts look like.
  const localHandler = (payload: unknown) => {
    void handler(payload as TReq, {} as chrome.runtime.MessageSender);
  };
  let set = localHandlers.get(kind);
  if (!set) {
    set = new Set();
    localHandlers.set(kind, set);
  }
  set.add(localHandler);

  const listener = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    if (!isEnvelope(msg) || msg.kind !== kind) return false;
    log.info('msg', `← receive ${kind}`, msg.payload);
    let result: Promise<TRes> | TRes;
    try {
      result = handler(msg.payload as TReq, sender);
    } catch (err) {
      log.error('msg', `handler(${kind}) sync threw`, err);
      sendResponse({ __error: (err as Error).message });
      return false;
    }
    if (result && typeof (result as Promise<TRes>).then === 'function') {
      (result as Promise<TRes>)
        .then((r) => {
          log.success('msg', `→ reply ${kind}`);
          sendResponse(r);
        })
        .catch((err) => {
          log.error('msg', `handler(${kind}) async threw`, err);
          sendResponse({ __error: (err as Error).message });
        });
      return true; // keeps the channel open for the async response
    }
    sendResponse(result);
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    localHandlers.get(kind)?.delete(localHandler);
  };
}
