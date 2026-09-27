import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let client: typeof import('@/lib/cdp/client');
let detached: (source: { tabId: number }, reason: string) => void;
const attach = vi.fn(); const detach = vi.fn(); const command = vi.fn();
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  attach.mockResolvedValue(undefined); detach.mockResolvedValue(undefined); command.mockResolvedValue({});
  Object.assign(chrome, { debugger: { attach, detach, sendCommand: command,
    onEvent: { addListener: vi.fn() }, onDetach: { addListener: (fn: typeof detached) => { detached = fn; } } } });
  client = await import('@/lib/cdp/client');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); });
it('shares one attachment and detaches exactly after the last owned lease', async () => {
  const [a, b] = await Promise.all([client.acquireSession(37), client.acquireSession(37)]);
  expect(attach).toHaveBeenCalledTimes(1);
  await a.release(); expect(detach).not.toHaveBeenCalled();
  await b.release(); await b.release(); expect(detach).toHaveBeenCalledTimes(1);
});
it('preserves an attachment borrowed from an ordinary CDP caller', async () => {
  await client.attach(37); const lease = await client.acquireSession(37);
  await lease.release(); expect(detach).not.toHaveBeenCalled();
});
it('preserves a capture attachment concurrently retained by an ordinary caller', async () => {
  const lease = await client.acquireSession(37);
  await client.send(37, 'Runtime.evaluate', { expression: '1' });
  await lease.release(); expect(detach).not.toHaveBeenCalled();
});
it('old detached lease cannot send to or release a replacement attachment', async () => {
  const old = await client.acquireSession(37); detached({ tabId: 37 }, 'canceled_by_user');
  const current = await client.acquireSession(37);
  await expect(old.send('Page.reload')).rejects.toThrow();
  await old.release(); expect(detach).not.toHaveBeenCalled();
  await current.send('Page.getFrameTree'); await current.release();
  expect(detach).toHaveBeenCalledTimes(1);
});
