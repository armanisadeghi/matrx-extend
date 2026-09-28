import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ send: vi.fn(), release: vi.fn(), acquire: vi.fn() }));
vi.mock('@/lib/cdp/client', () => ({ acquireSession: harness.acquire }));
import { startDocumentNetworkCapture } from '@/lib/data-pattern/document-network-capture';
import { cleanupNetworkTapMain, networkTapCleanupPresent } from '@/lib/data-pattern/network-tap';
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
    frame: { id: 'main-frame', url: 'https://electronic.vegas/calendar/' },
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
        frameTree: { frame: { id: 'main-frame', url: 'https://electronic.vegas/calendar/' } },
      };
    if (method === 'Runtime.enable') context(1, 'prior-document');
    if (method === 'Runtime.addBinding') binding = params.name;
    if (method === 'Page.addScriptToEvaluateOnNewDocument')
      return { identifier: 'new-document-script' };
    return {};
  });
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
  expect(harness.send).toHaveBeenCalledWith('Page.reload');
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
  await vi.waitFor(() => expect(harness.send).toHaveBeenCalledWith('Page.reload'));
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

it('arms before reload and retains the earliest new-document response while rejecting a delayed old response', async () => {
  const opts = options();
  const baseSend = harness.send.getMockImplementation()!;
  harness.send.mockImplementation(async (method, params) => {
    if (method === 'Page.reload') {
      expect(
        harness.send.mock.calls.some((call) => call[0] === 'Page.addScriptToEvaluateOnNewDocument'),
      ).toBe(true);
      context(2, 'reloaded-document');
      packet(1, '[{"venue":"Prior venue"}]', 999);
      packet(2, '[{"venue":"Brooklyn Bowl"}]', 1);
      expect(opts.onEvent).not.toHaveBeenCalled();
      committed();
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
        args: [binding],
      }),
    ),
  );
  expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
    expect.objectContaining({
      target: { tabId: 37, documentIds: ['replayed-document'] },
      world: 'MAIN',
      func: cleanupNetworkTapMain,
      args: [binding],
    }),
  );
  expect(harness.send.mock.calls.some(([method]) => method === 'Runtime.evaluate')).toBe(false);
  expect(harness.release).toHaveBeenCalledTimes(1);
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
  expect(harness.send).not.toHaveBeenCalledWith('Page.reload');
  expect(harness.release).toHaveBeenCalledTimes(1);
});

it('terminates when a second document replaces the replay document at the identical URL', async () => {
  const opts = options();
  const capture = await startDocumentNetworkCapture(opts);
  context(2, 'reloaded-document');
  committed();
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
  expect(harness.send).not.toHaveBeenCalledWith('Page.reload');
  expect(harness.send).toHaveBeenCalledWith('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: 'new-document-script',
  });
  expect(harness.release).toHaveBeenCalledOnce();
});
