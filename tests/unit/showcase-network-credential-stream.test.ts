import { describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({ log: deps }));
vi.mock('@ai-matrx/agents/matrx', () => ({
  fetchWithMatrxProtocolFallback: vi.fn(async () => ({ response: new Response('{}', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }) })),
}));
vi.mock('@ai-matrx/agents/stream/ndjson', () => ({
  readMatrxNdjsonStream: async function* (_body: unknown, hooks: {
    onValidEnvelope: (value: unknown) => void;
    onMalformedLine: (value: unknown) => void;
    onUnknownEnvelope: (value: unknown) => void;
  }) {
    hooks.onValidEnvelope({
      raw: '{"event":"tool_event","data":{"arguments":{"config":{"url_filter":"https://calendar.invalid/api?access_token=SYNTHETIC_STREAM_SECRET"}}}}',
      envelope: { event: 'tool_event', data: {} }, lineNumber: 1,
    });
    hooks.onMalformedLine({ line: 'access_token=SYNTHETIC_STREAM_SECRET', error: new Error('unexpected token'), lineNumber: 2 });
    hooks.onUnknownEnvelope('access_token=SYNTHETIC_STREAM_SECRET');
  },
}));

describe('D48 stream diagnostic boundary', () => {
  it('records event metadata without raw delegated arguments or malformed lines', async () => {
    const { streamFetch } = await import('@/lib/api/stream');
    await streamFetch({ url: 'https://server.invalid/run', headers: {}, onEvent: vi.fn() });
    expect(deps.info).toHaveBeenCalledWith('stream', 'event #1', { event: 'tool_event' }, 'tool_event');
    expect(JSON.stringify([deps.info.mock.calls, deps.warn.mock.calls])).not.toContain('SYNTHETIC_STREAM_SECRET');
  });
});
