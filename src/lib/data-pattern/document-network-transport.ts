import { startDocumentNetworkCapture } from './document-network-capture';
import type { CapturedNetEvent } from './network-tap';

const PORT = 'matrx:document-network-capture';
type Event = CapturedNetEvent & { capture_id: string; document_key: string };
interface Request {
  tabId: number;
  captureId: string;
  maxBodyBytes: number;
  timeoutMs: number;
}
interface Options extends Request {
  expectedPage?: { url: string; documentId: string };
  onArmed?: () => void;
  signal: AbortSignal;
  onEvent: (event: Event) => void;
  onFailure: (error: Error) => void;
}
interface Capture {
  close: () => Promise<void>;
}
const active = new Map<number, AbortController>();

async function startOwned(options: Options): Promise<Capture> {
  const controller = new AbortController();
  active.get(options.tabId)?.abort();
  active.set(options.tabId, controller);
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  // Setup has its own bounded budget. The matching window begins onArmed,
  // immediately before the already-prepared reload; setup does not consume it.
  let setupTimedOut = false;
  const deadline = setTimeout(() => {
    setupTimedOut = true;
    controller.abort();
  }, options.timeoutMs);
  let rejectSetup!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectSetup = reject;
  });
  const interrupt = () =>
    rejectSetup(
      new Error(
        setupTimedOut
          ? 'Network capture setup timed out; Chrome may not have confirmed capture-hook cleanup. Reload the tab before trying again.'
          : 'Network replay was cancelled.',
      ),
    );
  controller.signal.addEventListener('abort', interrupt, { once: true });
  if (controller.signal.aborted) interrupt();
  const release = () => {
    clearTimeout(deadline);
    options.signal.removeEventListener('abort', abort);
    if (active.get(options.tabId) === controller) active.delete(options.tabId);
  };
  try {
    const starting = startDocumentNetworkCapture({
      ...options,
      earlyBufferBytes: options.maxBodyBytes,
      signal: controller.signal,
      onArmed: () => {
        clearTimeout(deadline);
        options.onArmed?.();
      },
      onFailure: (error) => {
        release();
        options.onFailure(error);
      },
    });
    // Return an honest terminal result even if Chrome's setup promise stalls.
    // The core still observes abort and releases any late-created lease/script.
    const capture = await Promise.race([starting, interrupted]);
    controller.signal.removeEventListener('abort', interrupt);
    let closing: Promise<void> | undefined;
    return {
      close: () =>
        (closing ??= (async () => {
          try {
            await capture.close();
          } finally {
            release();
          }
        })()),
    };
  } catch (error) {
    controller.signal.removeEventListener('abort', interrupt);
    release();
    throw error;
  }
}

/** Internal prepared-operation call. No public raw-capture port endpoint exists. */
export function openDocumentNetworkCapture(options: Options): Promise<Capture> {
  return startOwned(options);
}

export function registerDocumentNetworkCaptureHost(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT || port.sender?.id !== chrome.runtime.id || port.sender.tab) return;
    let started = false;
    let connected = true;
    const controller = new AbortController();
    const reply = (message: unknown) => {
      if (connected) port.postMessage(message);
    };
    port.onDisconnect.addListener(() => {
      connected = false;
      controller.abort();
    });
    port.onMessage.addListener((message: { kind?: string; patternId?: string; tabId?: number }) => {
      if (message.kind === 'cancel') {
        controller.abort();
        return;
      }
      if (message.kind !== 'run' || started) return;
      started = true;
      if (typeof message.patternId !== 'string' || !Number.isInteger(message.tabId)) {
        reply({ kind: 'error', message: 'Invalid saved replay request.' });
        return;
      }
      // Only saved identity crosses the port. Never trust client approval/context/config.
      void import('@/lib/tools/dispatch')
        .then(({ runLocalSavedPattern }) =>
          runLocalSavedPattern(message.patternId!, message.tabId!, controller.signal, (note) =>
            reply({ kind: 'progress', note }),
          ),
        )
        .then(
          (result) => reply({ kind: 'result', result }),
          (error) =>
            reply({
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            }),
        );
    });
  });
}
export function openSavedPatternOperation(
  patternId: string,
  tabId: number,
  options: { signal?: AbortSignal; onProgress?: (note: string) => void } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: PORT });
    let settled = false;
    const finish = (error: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      port.postMessage({ kind: 'cancel' });
      finish(new Error('Replay cancelled.'));
    };
    port.onMessage.addListener((message) => {
      if (message.kind === 'progress') options.onProgress?.(String(message.note));
      else if (message.kind === 'result') finish(null, message.result);
      else if (message.kind === 'error') finish(new Error(String(message.message)));
    });
    port.onDisconnect.addListener(() =>
      finish(new Error('The replay connection ended. Run again.')),
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    port.postMessage({ kind: 'run', patternId, tabId });
  });
}
