import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const operation = vi.hoisted(() => ({ run: vi.fn() }));
import { registerDocumentNetworkCaptureHost } from '@/lib/data-pattern/document-network-transport';
let connect: (port: chrome.runtime.Port) => void;
function port(sender: object = { id: 'extension' }) {
  let message: (value: object) => void = () => {};
  let disconnect = () => {};
  const postMessage = vi.fn();
  connect({
    name: 'matrx:document-network-capture',
    sender,
    postMessage,
    onMessage: {
      addListener: (fn: typeof message) => {
        message = fn;
      },
    },
    onDisconnect: {
      addListener: (fn: typeof disconnect) => {
        disconnect = fn;
      },
    },
  } as unknown as chrome.runtime.Port);
  return { send: (v: object) => message(v), disconnect: () => disconnect(), postMessage };
}
const request = { kind: 'run', patternId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tabId: 37 };
beforeEach(() => {
  operation.run.mockResolvedValue({ ok: true, rows: [{ event: 'Current' }] });
  Object.assign(chrome, {
    runtime: {
      id: 'extension',
      onConnect: {
        addListener: (fn: typeof connect) => {
          connect = fn;
        },
      },
    },
  });
  registerDocumentNetworkCaptureHost(operation.run);
});
afterEach(() => vi.resetAllMocks());
it('rejects foreign/content senders and the obsolete raw-start endpoint', async () => {
  port({ id: 'foreign' }).send(request);
  port({ id: 'extension', tab: { id: 37 } }).send(request);
  port().send({ kind: 'start', tabId: 37, captureId: 'forged', preApproved: true });
  await Promise.resolve();
  expect(operation.run).not.toHaveBeenCalled();
});
it('forwards only saved identity, not caller approval/config/context', async () => {
  const p = port();
  p.send({
    ...request,
    preApproved: true,
    context: { permissionMode: 'act' },
    config: { url_filter: 'forged' },
  });
  await vi.waitFor(() => expect(operation.run).toHaveBeenCalledOnce());
  expect(operation.run.mock.calls[0]!.slice(0, 2)).toEqual([request.patternId, 37]);
  expect(operation.run.mock.calls[0]).toHaveLength(4);
  await vi.waitFor(() =>
    expect(p.postMessage).toHaveBeenCalledWith({
      kind: 'result',
      result: { ok: true, rows: [{ event: 'Current' }] },
    }),
  );
});
it('disconnect while approval/capture is pending aborts its owner and never replies late', async () => {
  let finish!: (value: unknown) => void;
  operation.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const p = port();
  p.send(request);
  await vi.waitFor(() => expect(operation.run).toHaveBeenCalled());
  p.disconnect();
  expect(operation.run.mock.calls[0]![2].aborted).toBe(true);
  finish({ ok: true });
  await Promise.resolve();
  expect(p.postMessage).not.toHaveBeenCalled();
});
it('cleanup failure is delivered as error, never result', async () => {
  operation.run.mockRejectedValue(new Error('capture hook cleanup failed'));
  const p = port();
  p.send(request);
  await vi.waitFor(() =>
    expect(p.postMessage).toHaveBeenCalledWith({
      kind: 'error',
      message: 'capture hook cleanup failed',
    }),
  );
  expect(p.postMessage.mock.calls.some((call) => call[0].kind === 'result')).toBe(false);
});
