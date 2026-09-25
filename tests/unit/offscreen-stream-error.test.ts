import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => Promise<unknown>>(),
  broadcasts: [] as Array<{ channel: string; payload: unknown }>,
  streamFetch: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/api/stream', () => ({
  streamFetch: state.streamFetch,
  streamErrorMessage: () => 'The chat service could not complete this request. Try again.',
}));
vi.mock('@/lib/audio/mic-recorder-offscreen', () => ({
  handleMicRun: vi.fn(),
  registerMicKeepalive: vi.fn(),
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: state.logError },
  startDebugRelay: vi.fn(),
}));
vi.mock('@/lib/desktop/ws-offscreen', () => ({ startWsOffscreenRuntime: vi.fn() }));
vi.mock('@/lib/messaging/native', () => ({
  on: (channel: string, handler: (payload: unknown) => Promise<unknown>) =>
    state.handlers.set(channel, handler),
  broadcast: (channel: string, payload: unknown) => state.broadcasts.push({ channel, payload }),
}));
vi.mock('@/lib/scrape/fetch-and-parse', () => ({ fetchUrlAndParse: vi.fn() }));
vi.mock('@/lib/video/video-recorder-offscreen', () => ({ handleVideoRun: vi.fn() }));

describe('offscreen stream error relay', () => {
  beforeEach(async () => {
    state.handlers.clear();
    state.broadcasts = [];
    state.streamFetch.mockReset();
    state.logError.mockReset();
    vi.resetModules();
    await import('@/entrypoints/offscreen/main');
  });

  it('keeps an unexpected stream exception in Debug and broadcasts only safe Chat copy', async () => {
    state.streamFetch.mockRejectedValue(new Error('authorization=must-not-reach-chat'));
    const run = state.handlers.get('stream:run');
    expect(run).toBeTypeOf('function');

    await run?.({ runId: 'run-harbor-dental', url: 'https://example.test/chat', headers: {} });

    expect(state.broadcasts).toEqual([
      {
        channel: 'stream:chunk',
        payload: {
          runId: 'run-harbor-dental',
          type: 'error',
          payload: { message: 'The chat service could not complete this request. Try again.' },
        },
      },
      {
        channel: 'stream:chunk',
        payload: { runId: 'run-harbor-dental', type: 'done', payload: {} },
      },
    ]);
    expect(JSON.stringify(state.broadcasts)).not.toContain('authorization=');
    expect(state.logError).toHaveBeenCalledWith(
      'stream',
      'streamFetch threw run-harbor-dental',
      expect.objectContaining({ message: 'authorization=must-not-reach-chat' }),
    );
  });
});
