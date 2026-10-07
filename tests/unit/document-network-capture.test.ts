import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ send: vi.fn(), release: vi.fn(), acquire: vi.fn() }));
vi.mock('@/lib/cdp/client', () => ({ acquireSession: harness.acquire }));
import { startDocumentNetworkCapture } from '@/lib/data-pattern/document-network-capture';
import { cleanupNetworkTapMain, networkTapCleanupPresent } from '@/lib/data-pattern/network-tap';
import { runNetworkCapturePattern } from '@/lib/data-pattern/run-interactive';
const events = new Set<(source: { tabId: number }, method: string, params: object) => void>();
const detaches = new Set<(source: { tabId: number }) => void>();
const emit = (method: string, params: object) => {
  for (const callback of events) callback({ tabId: 37 }, method, params);
};
const context = (id: number, uniqueId: string) =>
  emit('Runtime.executionContextCreated', {
    context: { id, uniqueId, auxData: { frameId: 'main-frame', isDefault: true } },
  });
let binding = '';
let baseCaptureSend: (method: string, params: Record<string, unknown>) => Promise<unknown>;
const nonce = 'a'.repeat(32);
const handshake = (contextId: number, hookNonce = nonce) =>
  emit('Runtime.bindingCalled', {
    name: binding,
    executionContextId: contextId,
    payload: JSON.stringify({ __matrx_capture_hook: 'network-tap', nonce: hookNonce }),
  });
const packet = (contextId: number, body: string, sequence: number) =>
  emit('Runtime.bindingCalled', {
    name: binding,
    executionContextId: contextId,
    payload: JSON.stringify({
      source: 'fetch',
      method: 'GET',
      url: 'https://electronic.vegas/api/events',
      body,
      request_body_key: 'none',
      request_sequence: sequence,
      status: 200,
      ts_ms: 1,
      body_size: body.length,
      body_truncated: false,
      request_headers: { authorization: 'nonsecret-canary' },
    }),
  });
const committed = () =>
  emit('Page.frameNavigated', {
    frame: {
      id: 'main-frame',
      url: 'https://electronic.vegas/calendar/',
      loaderId: 'replay-loader',
    },
  });
const started = (loaderId = 'replay-loader', navigationType = 'reload') =>
  emit('Page.frameStartedNavigating', {
    frameId: 'main-frame',
    loaderId,
    navigationType,
    url: 'https://electronic.vegas/calendar/',
  });
beforeEach(() => {
  harness.acquire.mockResolvedValue({ send: harness.send, release: harness.release });
  harness.release.mockResolvedValue(undefined);
  Object.assign(chrome, {
    debugger: {
      sendCommand: vi.fn(),
      onEvent: {
        addListener: (callback: typeof events extends Set<infer T> ? T : never) =>
          events.add(callback),
        removeListener: (callback: typeof events extends Set<infer T> ? T : never) =>
          events.delete(callback),
      },
      onDetach: {
        addListener: (callback: (source: { tabId: number }) => void) => detaches.add(callback),
        removeListener: (callback: (source: { tabId: number }) => void) =>
          detaches.delete(callback),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => [{ documentId: 'replayed-document', result: true }]),
    },
  });
  harness.send.mockImplementation(async (method, params) => {
    if (method === 'Page.getFrameTree')
      return {
        frameTree: {
          frame: {
            id: 'main-frame',
            url: 'https://electronic.vegas/calendar/',
            loaderId: 'original-loader',
          },
        },
      };
    if (method === 'Runtime.enable') context(1, 'prior-document');
    if (method === 'Runtime.addBinding') binding = params.name;
    if (method === 'Page.addScriptToEvaluateOnNewDocument')
      return { identifier: 'new-document-script' };
    return {};
  });
  baseCaptureSend = harness.send.getMockImplementation()!;
});
afterEach(() => {
  events.clear();
  detaches.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
});
const options = () => ({
  tabId: 37,
  captureId: '11111111-1111-4111-8111-111111111111',
  maxBodyBytes: 4096,
  earlyBufferBytes: 4096,
  timeoutMs: 5_000,
  signal: new AbortController().signal,
  onEvent: vi.fn(),
  onFailure: vi.fn(),
});
const savedReplay = (timeoutMs = 100) =>
  runNetworkCapturePattern(
    {
      url_filter: 'https://electronic.vegas/api/events',
      method: 'GET',
      key_path: 'events',
      body_match: 'ignore',
    },
    37,
    { initiation: 'user', timeoutMs },
  );
const replayPacket = (contextId: number, title: string, sequence: number) =>
  packet(contextId, JSON.stringify({ events: [{ title }] }), sequence);
const emitReload = (duringReload: () => void) => {
  harness.send.mockImplementation(async (method, params) => {
    if (method === 'Page.reload') {
      started();
      context(2, 'reloaded-document');
      duringReload();
      committed();
      handshake(2);
    }
    return baseCaptureSend(method, params);
  });
};
const waitForReload = async (count: number) => {
  for (
    let i = 0;
    i < 100 &&
    harness.send.mock.calls.filter(([method]) => method === 'Page.reload').length < count;
    i++
  ) {
    await Promise.resolve();
  }
  expect(harness.send.mock.calls.filter(([method]) => method === 'Page.reload')).toHaveLength(
    count,
  );
};

it('ends and releases its lease when Page.reload never settles', async () => {
  vi.useFakeTimers();
  const opts = { ...options(), timeoutMs: 5_000 };
  const baseSend = harness.send.getMockImplementation()!;
  harness.send.mockImplementation((method, params) =>
    method === 'Page.reload' ? new Promise(() => {}) : baseSend(method, params),
  );
  const status = startDocumentNetworkCapture(opts).then(
    () => 'resolved',
    () => 'rejected',
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(harness.send).toHaveBeenCalledWith('Page.reload', { loaderId: 'original-loader' });
  await vi.advanceTimersByTimeAsync(5_000);
  let verdict = 'pending';
  void status.then((value) => {
    verdict = value;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(verdict).toBe('rejected');
  expect(harness.release).toHaveBeenCalledOnce();
});

it('cancels and releases its lease while Page.reload is stalled', async () => {
  const controller = new AbortController();
  const opts = { ...options(), timeoutMs: 5_000, signal: controller.signal };
  const baseSend = harness.send.getMockImplementation()!;
  harness.send.mockImplementation((method, params) =>
    method === 'Page.reload' ? new Promise(() => {}) : baseSend(method, params),
  );
  const status = startDocumentNetworkCapture(opts).then(
    () => 'resolved',
    () => 'rejected',
  );
  await vi.waitFor(() =>
    expect(harness.send).toHaveBeenCalledWith('Page.reload', { loaderId: 'original-loader' }),
  );
  controller.abort();
  let verdict = 'pending';
  void status.then((value) => {
    verdict = value;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(verdict).toBe('rejected');
  expect(harness.release).toHaveBeenCalledOnce();
});

it('returns an honest terminal error and attempts release when cleanup never settles', async () => {
  vi.useFakeTimers();
  const opts = { ...options(), timeoutMs: 100 };
  const baseSend = harness.send.getMockImplementation()!;
  harness.send.mockImplementation((method, params) =>
    method === 'Page.removeScriptToEvaluateOnNewDocument'
      ? new Promise(() => {})
      : baseSend(method, params),
  );
  const capture = await startDocumentNetworkCapture(opts);
  const outcome = capture.close().then(
    () => 'success',
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toMatch(/did not confirm removal/);
  expect(harness.release).toHaveBeenCalledOnce();
  expect(harness.send).toHaveBeenCalledWith('Runtime.removeBinding', expect.any(Object));
});

it('returns an honest terminal error when owned debugger release never settles', async () => {
  vi.useFakeTimers();
  const opts = { ...options(), timeoutMs: 100 };
  harness.release.mockImplementation(() => new Promise(() => {}));
  const capture = await startDocumentNetworkCapture(opts);
  const outcome = capture.close().then(
    () => 'success',
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toMatch(/did not confirm removal/);
  expect(harness.release).toHaveBeenCalledOnce();
});

it.each(['old first', 'current first'] as const)(
  'arms before reload and retains the earliest new-document response with %s delivery',
  async (deliveryOrder) => {
    const opts = options();
    const baseSend = harness.send.getMockImplementation()!;
    harness.send.mockImplementation(async (method, params) => {
      if (method === 'Page.reload') {
        expect(
          harness.send.mock.calls.some(
            (call) => call[0] === 'Page.addScriptToEvaluateOnNewDocument',
          ),
        ).toBe(true);
        started();
        started(); // CDP may repeat a start for the same loader.
        context(2, 'reloaded-document');
        const oldPacket = () => packet(1, '[{"venue":"Prior venue"}]', 999);
        const currentPacket = () => packet(2, '[{"venue":"Brooklyn Bowl"}]', 1);
        if (deliveryOrder === 'old first') {
          oldPacket();
          currentPacket();
        } else {
          currentPacket();
          oldPacket();
        }
        expect(opts.onEvent).not.toHaveBeenCalled();
        committed();
        handshake(2);
      }
      return baseSend(method, params);
    });
    const capture = await startDocumentNetworkCapture(opts);
    expect(opts.onEvent).toHaveBeenCalledTimes(1);
    expect(opts.onEvent.mock.calls[0]![0]).toMatchObject({
      body: '[{"venue":"Brooklyn Bowl"}]',
      document_key: 'reloaded-document',
      capture_id: opts.captureId,
    });
    expect(opts.onEvent.mock.calls[0]![0]).not.toHaveProperty('request_headers');
    await capture.close();
    expect(harness.send).toHaveBeenCalledWith('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: 'new-document-script',
    });
    await vi.waitFor(() =>
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 37 },
          world: 'MAIN',
          func: networkTapCleanupPresent,
          args: [binding, nonce],
        }),
      ),
    );
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 37, documentIds: ['replayed-document'] },
        world: 'MAIN',
        func: cleanupNetworkTapMain,
        args: [binding, nonce],
      }),
    );
    expect(harness.send.mock.calls.some(([method]) => method === 'Runtime.evaluate')).toBe(false);
    expect(harness.release).toHaveBeenCalledTimes(1);
  },
);

it('refuses a stale-only response rather than delivering it as the replay document', async () => {
  const opts = options();
  const capture = await startDocumentNetworkCapture(opts);
  started();
  context(2, 'reloaded-document');
  packet(1, '[{"venue":"Prior venue"}]', 999);
  committed();
  handshake(2);
  expect(opts.onEvent).not.toHaveBeenCalled();
  await capture.close();
  expect(opts.onEvent).not.toHaveBeenCalled();
});

it('saved replay refuses stale-only rows and recovers on a fresh run', async () => {
  vi.useFakeTimers();
  emitReload(() => replayPacket(1, 'Prior venue', 999));
  const stale = savedReplay();
  const staleOutcome = stale.then(
    (rows) => ({ rows }),
    (error: Error) => ({ error: error.message }),
  );
  await waitForReload(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(await staleOutcome).toEqual({
    error: expect.stringMatching(/No successful request matching/),
  });

  emitReload(() => replayPacket(2, 'Brooklyn Bowl', 1));
  const recovered = savedReplay();
  const recoveredOutcome = recovered.then(
    (rows) => ({ rows }),
    (error: Error) => ({ error: error.message }),
  );
  await waitForReload(2);
  await vi.advanceTimersByTimeAsync(100);
  expect(await recoveredOutcome).toEqual({ rows: [{ title: 'Brooklyn Bowl' }] });
});

it('saved replay ignores a prior-run binding while accepting its own document', async () => {
  vi.useFakeTimers();
  emitReload(() => replayPacket(2, 'Earlier run', 1));
  const first = savedReplay();
  const firstOutcome = first.then(
    (rows) => ({ rows }),
    (error: Error) => ({ error: error.message }),
  );
  await waitForReload(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(await firstOutcome).toEqual({ rows: [{ title: 'Earlier run' }] });
  const oldBinding = binding;
  emitReload(() => {
    // A delayed event from the previous capture still bears its old binding.
    emit('Runtime.bindingCalled', {
      name: oldBinding,
      executionContextId: 2,
      payload: JSON.stringify({
        source: 'fetch',
        method: 'GET',
        url: 'https://electronic.vegas/api/events',
        body: '{"events":[{"title":"Earlier run late"}]}',
        request_sequence: 999,
        status: 200,
        ts_ms: 1,
        body_size: 41,
        body_truncated: false,
      }),
    });
    replayPacket(2, 'Current run', 1);
  });
  const second = savedReplay();
  const secondOutcome = second.then(
    (rows) => ({ rows }),
    (error: Error) => ({ error: error.message }),
  );
  await waitForReload(2);
  await vi.advanceTimersByTimeAsync(100);
  expect(await secondOutcome).toEqual({ rows: [{ title: 'Current run' }] });
});

it('saved replay rejects a higher old-document sequence on the real capture path', async () => {
  vi.useFakeTimers();
  emitReload(() => {
    replayPacket(2, 'Brooklyn Bowl', 1);
    replayPacket(1, 'Prior venue', 999);
  });
  const result = savedReplay();
  const outcome = result.then(
    (rows) => ({ rows }),
    (error: Error) => ({ error: error.message }),
  );
  await waitForReload(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toEqual({ rows: [{ title: 'Brooklyn Bowl' }] });
});

it('cleans a nonce-pinned hook when stopped after context creation but before frame commit', async () => {
  const capture = await startDocumentNetworkCapture(options());
  started();
  context(2, 'reloaded-document');
  handshake(2);
  await vi.waitFor(() => expect(chrome.scripting.executeScript).toHaveBeenCalledOnce());

  await capture.close();

  expect(chrome.scripting.executeScript).toHaveBeenLastCalledWith(
    expect.objectContaining({
      target: { tabId: 37, documentIds: ['replayed-document'] },
      world: 'MAIN',
      func: cleanupNetworkTapMain,
      args: [binding, nonce],
    }),
  );
  expect(harness.release).toHaveBeenCalledOnce();
});

it('refuses a replacement document when navigation arrives after the cleanup probe', async () => {
  let resolveProbe!: (value: Array<{ documentId: string; result: boolean }>) => void;
  Object.assign(chrome, {
    scripting: {
      executeScript: vi.fn(
        () =>
          new Promise<Array<{ documentId: string; result: boolean }>>((resolve) => {
            resolveProbe = resolve;
          }),
      ),
    },
  });
  const capture = await startDocumentNetworkCapture(options());
  started();
  context(2, 'reloaded-document');
  committed();
  handshake(2);
  await vi.waitFor(() => expect(chrome.scripting.executeScript).toHaveBeenCalledOnce());

  const closing = capture.close();
  // The browser has navigated, but its CDP frame event is delayed until after
  // close starts. The tab-scoped probe therefore runs in the replacement.
  context(3, 'replacement-document');
  committed();
  resolveProbe([{ documentId: 'replacement-document', result: false }]);

  await expect(closing).rejects.toThrow(/did not confirm removal/);
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  expect(chrome.scripting.executeScript).toHaveBeenLastCalledWith(
    expect.objectContaining({ args: [binding, nonce], func: networkTapCleanupPresent }),
  );
});

it('removes a late script registration when cancellation races installation', async () => {
  const opts = options();
  const controller = new AbortController();
  opts.signal = controller.signal;
  let resolveScript!: (value: { identifier: string }) => void;
  const registration = new Promise<{ identifier: string }>((resolve) => {
    resolveScript = resolve;
  });
  const baseSend = harness.send.getMockImplementation()!;
  harness.send.mockImplementation((method, params) =>
    method === 'Page.addScriptToEvaluateOnNewDocument' ? registration : baseSend(method, params),
  );
  const starting = startDocumentNetworkCapture(opts);
  await vi.waitFor(() =>
    expect(harness.send).toHaveBeenCalledWith(
      'Page.addScriptToEvaluateOnNewDocument',
      expect.any(Object),
    ),
  );
  controller.abort();
  resolveScript({ identifier: 'late-script' });
  await expect(starting).rejects.toThrow(/cancelled/);
  expect(harness.send).toHaveBeenCalledWith('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: 'late-script',
  });
  expect(harness.send).not.toHaveBeenCalledWith('Page.reload', expect.anything());
  expect(harness.release).toHaveBeenCalledTimes(1);
});

it('terminates when a second document replaces the replay document at the identical URL', async () => {
  const opts = options();
  const capture = await startDocumentNetworkCapture(opts);
  started();
  context(2, 'reloaded-document');
  committed();
  handshake(2);
  context(3, 'another-document-at-same-url');
  packet(3, '[{"venue":"Other document"}]', 1);
  await vi.waitFor(() =>
    expect(opts.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/page changed again/) }),
    ),
  );
  expect(opts.onEvent).not.toHaveBeenCalled();
  await capture.close();
  // The identity probe was allowed to finish, but its result was rejected once
  // CDP reported the replacement. Cleanup must not touch that next document.
  await Promise.resolve();
  expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  expect(harness.release).toHaveBeenCalledTimes(1);
});

it.each([
  ['external navigation starts first', () => started('external-loader', 'differentDocument')],
  [
    'external navigation supersedes reload before commit',
    () => {
      started();
      started('external-loader', 'differentDocument');
    },
  ],
] as const)('rejects a nonce-attested same-URL document when %s', async (_case, navigate) => {
  const opts = options();
  const capture = await startDocumentNetworkCapture(opts);
  navigate();
  context(2, 'external-document');
  packet(2, '[{"venue":"External venue"}]', 1);
  emit('Page.frameNavigated', {
    frame: {
      id: 'main-frame',
      url: 'https://electronic.vegas/calendar/',
      loaderId: 'external-loader',
    },
  });
  handshake(2);
  await vi.waitFor(() => expect(opts.onFailure).toHaveBeenCalledOnce());
  expect(opts.onEvent).not.toHaveBeenCalled();
  await capture.close();
});

it('rechecks the approved SPA route after script installation and never reloads a changed page', async () => {
  const opts = {
    ...options(),
    expectedPage: { url: 'https://electronic.vegas/calendar/', documentId: 'approved-document' },
  };
  Object.assign(chrome, {
    tabs: { get: vi.fn(async () => ({ id: 37, url: 'https://electronic.vegas/other/' })) },
    scripting: { executeScript: vi.fn(async () => [{ documentId: 'approved-document' }]) },
  });
  await expect(startDocumentNetworkCapture(opts)).rejects.toThrow('approved page changed');
  expect(harness.send).not.toHaveBeenCalledWith('Page.reload', expect.anything());
  expect(harness.send).toHaveBeenCalledWith('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: 'new-document-script',
  });
  expect(harness.release).toHaveBeenCalledOnce();
});
