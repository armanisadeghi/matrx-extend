import { acquireSession } from '@/lib/cdp/client';
import { type CapturedNetEvent, networkTapMain } from './network-tap';

export interface DocumentCaptureOptions {
  tabId: number;
  captureId: string;
  maxBodyBytes: number;
  /** The caller's per-run duration also bounds Chrome's reload command. */
  timeoutMs: number;
  /** Per-run budget supplied by the caller; no global queue limit. */
  earlyBufferBytes: number;
  signal: AbortSignal;
  onEvent: (event: CapturedNetEvent & { capture_id: string; document_key: string }) => void;
  onFailure: (error: Error) => void;
  expectedPage?: { url: string; documentId: string };
  onArmed?: () => void;
}

/** Runs only in the SW, so all CDP clients share attachment ownership. */
export async function startDocumentNetworkCapture(opts: DocumentCaptureOptions) {
  if (!chrome.debugger?.sendCommand)
    throw new Error('Document-start capture is unavailable in this browser.');
  for (const budget of [opts.maxBodyBytes, opts.earlyBufferBytes, opts.timeoutMs]) {
    if (!Number.isSafeInteger(budget) || budget <= 0)
      throw new Error('Capture byte budgets must be positive integers.');
  }
  const lease = await acquireSession(opts.tabId);
  const bindingName = `__matrx_capture_${opts.captureId.replaceAll('-', '_')}`;
  let scriptId: string | null = null;
  let bindingAdded = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let settleSetup!: () => void;
  const setupSettled = new Promise<void>((resolve) => {
    settleSetup = resolve;
  });
  let reloadIssued = false;
  let mainFrame = '';
  let initialUrl = '';
  let committed = false;
  let documentContext: { id: number; uniqueId: string } | null = null;
  const oldContexts = new Set<string>();
  const contexts = new Map<number, { uniqueId: string; frameId: string; isDefault: boolean }>();
  const early: Array<{ event: CapturedNetEvent; bytes: number }> = [];
  let earlyBytes = 0;
  const canonicalUrl = (url: string) => {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  };
  const assertOpen = () => {
    if (closed || opts.signal.aborted) throw new Error('Network replay was cancelled.');
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    early.length = 0;
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    opts.signal.removeEventListener('abort', onAbort);
    closePromise = (async () => {
      await setupSettled;
      const failures: unknown[] = [];
      const attempt = async (method: string, params: Record<string, unknown>) => {
        try {
          await lease.send(method, params);
        } catch (error) {
          failures.push(error);
        }
      };
      if (scriptId)
        await attempt('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
      if (documentContext)
        await attempt('Runtime.evaluate', {
          expression: `globalThis[${JSON.stringify(`${bindingName}_cleanup`)}]?.()`,
          uniqueContextId: documentContext.uniqueId,
        });
      if (bindingAdded) await attempt('Runtime.removeBinding', { name: bindingName });
      await lease.release();
      // A detached/closed tab has already destroyed the capture. Other cleanup failures remain visible.
      if (failures.length && !detached)
        throw new Error(
          'Capture stopped, but Chrome did not confirm removal of every capture hook. Reload the tab before capturing again.',
        );
    })();
    return closePromise;
  };
  const fail = (message: string) => {
    if (closed) return;
    void close().then(
      () => opts.onFailure(new Error(message)),
      (error: unknown) => {
        opts.onFailure(error instanceof Error ? error : new Error(String(error)));
      },
    );
  };
  let detached = false;
  const onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId !== opts.tabId) return;
    detached = true;
    fail('Chrome detached the capture or closed the tab. Start the saved replay again.');
  };
  const onAbort = () => fail('Network replay was cancelled.');
  const emit = (event: CapturedNetEvent) => {
    if (!documentContext || closed) return;
    opts.onEvent({
      ...event,
      tab_id: opts.tabId,
      capture_id: opts.captureId,
      document_key: documentContext.uniqueId,
    });
  };
  const flush = () => {
    if (!committed || !documentContext) return;
    for (const { event } of early.splice(0)) emit(event);
    earlyBytes = 0;
  };
  const onEvent = (
    source: chrome.debugger.Debuggee & { sessionId?: string },
    method: string,
    raw?: object,
  ) => {
    if (closed || source.tabId !== opts.tabId || source.sessionId) return;
    const params = (raw ?? {}) as Record<string, unknown>;
    if (method === 'Runtime.executionContextCreated') {
      const context = params.context as {
        id: number;
        uniqueId: string;
        auxData?: { frameId?: string; isDefault?: boolean };
      };
      if (!context?.uniqueId) {
        if (context?.auxData?.isDefault && context.auxData.frameId === mainFrame)
          fail('Chrome did not provide a unique document context. Capture is unavailable.');
        return;
      }
      const frameId = context.auxData?.frameId ?? '';
      contexts.set(context.id, {
        uniqueId: context.uniqueId,
        frameId,
        isDefault: context.auxData?.isDefault === true,
      });
      if (!reloadIssued) oldContexts.add(context.uniqueId);
      else if (
        frameId === mainFrame &&
        context.auxData?.isDefault &&
        !oldContexts.has(context.uniqueId)
      ) {
        if (documentContext && documentContext.uniqueId !== context.uniqueId) {
          fail('The page changed again during replay. Run the recipe on the intended document.');
          return;
        }
        documentContext = { id: context.id, uniqueId: context.uniqueId };
        flush();
      }
    } else if (method === 'Page.navigatedWithinDocument' && params.frameId === mainFrame) {
      fail('The page route changed during replay. Run the recipe on the intended page.');
    } else if (method === 'Page.frameNavigated') {
      const frame = params.frame as { id?: string; parentId?: string; url?: string };
      if (!frame || frame.parentId) return;
      if (!mainFrame) {
        fail('The page navigated while capture was preparing. Run again.');
        return;
      }
      if (frame.id !== mainFrame) return;
      if (!reloadIssued || committed || !frame.url || canonicalUrl(frame.url) !== initialUrl) {
        fail(
          'The page navigated away while replay was preparing or listening. Run the recipe on the intended page.',
        );
        return;
      }
      committed = true;
      flush();
    } else if (method === 'Runtime.bindingCalled' && params.name === bindingName) {
      const context = contexts.get(Number(params.executionContextId));
      if (
        !reloadIssued ||
        !documentContext ||
        !context?.isDefault ||
        context.frameId !== mainFrame ||
        context.uniqueId !== documentContext.uniqueId ||
        oldContexts.has(context.uniqueId)
      )
        return;
      if (typeof params.payload !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(params.payload);
      } catch {
        fail('The page returned malformed capture data.');
        return;
      }
      const e = parsed as Partial<CapturedNetEvent> | null;
      if (
        !e ||
        (e.source !== 'fetch' && e.source !== 'xhr') ||
        typeof e.url !== 'string' ||
        typeof e.method !== 'string' ||
        typeof e.body !== 'string' ||
        typeof e.status !== 'number' ||
        typeof e.ts_ms !== 'number' ||
        typeof e.body_size !== 'number' ||
        typeof e.body_truncated !== 'boolean' ||
        !Number.isSafeInteger(e.request_sequence)
      ) {
        fail('The page returned incomplete capture data.');
        return;
      }
      if (new TextEncoder().encode(e.body).byteLength > opts.maxBodyBytes) {
        fail('A captured response exceeded this run’s byte budget.');
        return;
      }
      // Whitelist the established response contract. Never forward raw headers or request bodies.
      const event: CapturedNetEvent = {
        source: e.source,
        url: e.url,
        method: e.method,
        body: e.body,
        status: e.status,
        ts_ms: e.ts_ms,
        body_size: e.body_size,
        body_truncated: e.body_truncated,
        request_sequence: e.request_sequence!,
        ...(typeof e.request_body_key === 'string' &&
          /^(none|unavailable|sha256:[a-f0-9]{64})$/.test(e.request_body_key) && {
            request_body_key: e.request_body_key,
          }),
        ...(typeof e.content_type === 'string' && { content_type: e.content_type }),
      };
      if (!committed) {
        const bytes = new TextEncoder().encode(params.payload).byteLength;
        if (earlyBytes + bytes > opts.earlyBufferBytes) {
          fail(
            'Capture started, but document confirmation exceeded this run’s early-event byte budget. Increase the capture budget and run again.',
          );
          return;
        }
        early.push({ event, bytes });
        earlyBytes += bytes;
      } else emit(event);
    } else if (method === 'Runtime.executionContextDestroyed') {
      const id = Number(params.executionContextId);
      if (documentContext?.id === id)
        fail('The replay document was replaced. Run the recipe again.');
      contexts.delete(id);
    } else if (method === 'Runtime.executionContextsCleared') {
      if (documentContext) fail('The replay document was replaced. Run the recipe again.');
      contexts.clear();
    }
  };
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);
  opts.signal.addEventListener('abort', onAbort, { once: true });
  const arm = async () => {
    try {
      assertOpen();
      await lease.send('Page.enable');
      assertOpen();
      const tree = await lease.send<{ frameTree: { frame: { id: string; url: string } } }>(
        'Page.getFrameTree',
      );
      assertOpen();
      mainFrame = tree.frameTree.frame.id;
      initialUrl = canonicalUrl(tree.frameTree.frame.url);
      await lease.send('Runtime.enable');
      assertOpen();
      await lease.send('Runtime.addBinding', { name: bindingName });
      bindingAdded = true;
      assertOpen();
      const script = await lease.send<{ identifier: string }>(
        'Page.addScriptToEvaluateOnNewDocument',
        {
          source: `if (window === window.top) (${networkTapMain.toString()})(${JSON.stringify(opts.maxBodyBytes)}, ${JSON.stringify(bindingName)});`,
        },
      );
      scriptId = script.identifier;
      assertOpen();
      // Approval binds both document and SPA route. Recheck after potentially slow
      // CDP setup, immediately before issuing the reload of that approved page.
      if (opts.expectedPage) {
        const [tab, frames] = await Promise.all([
          chrome.tabs.get(opts.tabId),
          chrome.scripting.executeScript({ target: { tabId: opts.tabId }, func: () => null }),
        ]);
        assertOpen();
        if (
          tab.url !== opts.expectedPage.url ||
          frames[0]?.documentId !== opts.expectedPage.documentId ||
          initialUrl !== canonicalUrl(opts.expectedPage.url)
        ) {
          throw new Error('The approved page changed before reload. Run the saved recipe again.');
        }
      }
      reloadIssued = true;
      // All setup resources are known now. Closing while Page.reload is pending
      // can remove the script and release the lease without waiting for Chrome.
      settleSetup();
      opts.onArmed?.();
      let reloadTimer: ReturnType<typeof setTimeout> | undefined;
      let abortReload: (() => void) | undefined;
      const interrupted = new Promise<never>((_resolve, reject) => {
        abortReload = () => reject(new Error('Network replay was cancelled.'));
        opts.signal.addEventListener('abort', abortReload, { once: true });
        reloadTimer = setTimeout(
          () =>
            reject(
              new Error(
                'Chrome did not confirm the page reload in time. Capture stopped; the page may still reload. Run again.',
              ),
            ),
          opts.timeoutMs,
        );
      });
      try {
        await Promise.race([lease.send('Page.reload'), interrupted]);
        assertOpen();
      } finally {
        if (reloadTimer !== undefined) clearTimeout(reloadTimer);
        if (abortReload) opts.signal.removeEventListener('abort', abortReload);
      }
    } finally {
      settleSetup();
    }
  };
  try {
    await arm();
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
