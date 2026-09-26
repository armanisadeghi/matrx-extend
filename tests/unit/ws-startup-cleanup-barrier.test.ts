/** A desktop-probe recovery must not start the WS inside reload cleanup. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = {
  send: vi.fn(async () => ({ ok: true })),
  broadcast: vi.fn(),
  on: vi.fn(() => () => undefined),
};

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/desktop/discovery', () => ({
  getEngineBaseUrl: vi.fn(async () => 'http://127.0.0.1:22248'),
  invalidateEnginePortCache: vi.fn(),
}));
vi.mock('@/lib/desktop/http', () => ({ ensurePairToken: vi.fn(async () => 'pair-token') }));
vi.mock('@/lib/messaging/native', () => native);

describe('desktop probe socket recovery', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('waits for deferred stale cleanup before acquiring offscreen or sending WS_START', async () => {
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const createDocument = vi.fn(async () => undefined);
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension',
        getManifest: () => ({ version: '1', name: 'test' }),
        getContexts: vi.fn(async () => []),
        onMessage: { addListener: vi.fn() },
      },
      offscreen: { createDocument },
    });

    const { deferOffscreenAcquisitionUntil } = await import('@/lib/stream/offscreen-proxy');
    const { connectWs } = await import('@/lib/desktop/ws-client');
    deferOffscreenAcquisitionUntil(cleanup);
    const recovered = connectWs();
    await Promise.resolve();
    expect(createDocument).not.toHaveBeenCalled();
    expect(native.send).not.toHaveBeenCalledWith('ws:start', expect.anything());

    releaseCleanup();
    await recovered;
    expect(createDocument).toHaveBeenCalledOnce();
    expect(native.send).toHaveBeenCalledWith(
      'ws:start',
      expect.objectContaining({ wsUrl: expect.stringContaining(':22248/extension/ws') }),
    );
  });
});
