import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let client: typeof import('@/lib/cdp/client');
let detached: (source: { tabId: number }, reason: string) => void;
const attach = vi.fn();
const detach = vi.fn();
const command = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  attach.mockResolvedValue(undefined);
  detach.mockResolvedValue(undefined);
  command.mockResolvedValue({});
  Object.assign(chrome, {
    debugger: {
      attach,
      detach,
      sendCommand: command,
      onEvent: { addListener: vi.fn() },
      onDetach: {
        addListener: (fn: typeof detached) => {
          detached = fn;
        },
      },
    },
  });
  client = await import('@/lib/cdp/client');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
});
it('shares one attachment and detaches exactly after the last owned lease', async () => {
  const [a, b] = await Promise.all([client.acquireSession(37), client.acquireSession(37)]);
  expect(attach).toHaveBeenCalledTimes(1);
  await a.release();
  expect(detach).not.toHaveBeenCalled();
  await b.release();
  await b.release();
  expect(detach).toHaveBeenCalledTimes(1);
});
it('preserves an attachment borrowed from an ordinary CDP caller', async () => {
  await client.attach(37);
  const lease = await client.acquireSession(37);
  await lease.release();
  expect(detach).not.toHaveBeenCalled();
});
it('preserves a capture attachment concurrently retained by an ordinary caller', async () => {
  const lease = await client.acquireSession(37);
  await client.send(37, 'Runtime.evaluate', { expression: '1' });
  await lease.release();
  expect(detach).not.toHaveBeenCalled();
});
it('old detached lease cannot send to or release a replacement attachment', async () => {
  const old = await client.acquireSession(37);
  detached({ tabId: 37 }, 'canceled_by_user');
  const current = await client.acquireSession(37);
  await expect(old.send('Page.reload')).rejects.toThrow();
  await old.release();
  expect(detach).not.toHaveBeenCalled();
  await current.send('Page.getFrameTree');
  await current.release();
  expect(detach).toHaveBeenCalledTimes(1);
});
it('keeps a rejected owned detach visible and retries it through the next lease', async () => {
  const lease = await client.acquireSession(37);
  detach.mockRejectedValueOnce(new Error('Chrome refused debugger detach'));
  await expect(lease.release()).rejects.toThrow('Chrome refused debugger detach');
  await expect(lease.release()).rejects.toThrow('Chrome refused debugger detach');
  expect(client.isAttached(37)).toBe(true);
  expect(detach).toHaveBeenCalledTimes(1);
  const retry = await client.acquireSession(37);
  expect(attach).toHaveBeenCalledTimes(1);
  await retry.send('Page.getFrameTree');
  await retry.release();
  expect(detach).toHaveBeenCalledTimes(2);
  expect(client.isAttached(37)).toBe(false);
});
it.each([true, false])(
  'waits for pending detach before acquiring a replacement lease (ack=%s)',
  async (acknowledged) => {
    const old = await client.acquireSession(37);
    let resolveDetach!: () => void;
    let rejectDetach!: (error: Error) => void;
    detach.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          resolveDetach = resolve;
          rejectDetach = reject;
        }),
    );
    const first = old.release();
    const repeated = old.release();
    const settled = Promise.allSettled([first, repeated]);
    const acquiring = client.acquireSession(37);
    expect(attach).toHaveBeenCalledTimes(1);
    if (acknowledged) resolveDetach();
    else rejectDetach(new Error('Chrome refused debugger detach'));
    const outcomes = await settled;
    expect(outcomes.map((outcome) => outcome.status)).toEqual(
      acknowledged ? ['fulfilled', 'fulfilled'] : ['rejected', 'rejected'],
    );
    const current = await acquiring;
    expect(attach).toHaveBeenCalledTimes(acknowledged ? 2 : 1);
    await current.send('Page.getFrameTree');
    await current.release();
    expect(detach).toHaveBeenCalledTimes(2);
    expect(client.isAttached(37)).toBe(false);
  },
);

it.each(['network', 'console'] as const)(
  'ordinary %s capture waits for an owned detach before retaining its replacement',
  async (kind) => {
    const old = await client.acquireSession(37);
    let finishDetach!: () => void;
    detach.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDetach = resolve;
        }),
    );
    const releasing = old.release();
    const capturing =
      kind === 'network' ? client.startNetworkCapture(37) : client.startConsoleCapture(37);
    expect(command).not.toHaveBeenCalled();
    finishDetach();
    await Promise.all([releasing, capturing]);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenCalledWith(
      { tabId: 37 },
      kind === 'network' ? 'Network.enable' : 'Runtime.enable',
    );
    const borrowed = await client.acquireSession(37);
    await borrowed.release();
    expect(detach).toHaveBeenCalledTimes(1);
  },
);
