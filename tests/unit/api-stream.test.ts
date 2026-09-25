import { afterEach, describe, expect, it, vi } from 'vitest';

const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/debug/log', () => ({ log: logMock }));

import { type StreamEvent, streamFetch } from '@/lib/api/stream';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fragmentedResponse(parts: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        'X-Request-ID': 'req-1',
        'X-Conversation-ID': 'conv-1',
        'content-type': 'application/x-ndjson',
      },
    },
  );
}

describe('streamFetch public NDJSON kernel integration', () => {
  it('preserves fragmented UTF-8, trailing input, malformed visibility, and exact raw observation', async () => {
    const wire =
      '{"e":"c","t":"café"}\n' +
      'not-json\n' +
      '{"other":true}\n' +
      '{"event":"reasoning_chunk","data":{"text":"think"}}';
    const bytes = new TextEncoder().encode(wire);
    const utf8Split = bytes.findIndex((byte) => byte > 127) + 1;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          fragmentedResponse([
            bytes.slice(0, utf8Split),
            bytes.slice(utf8Split, utf8Split + 7),
            bytes.slice(utf8Split + 7),
          ]),
        ),
    );
    const events: StreamEvent[] = [];

    await streamFetch({
      url: 'https://example.test/stream',
      headers: { Authorization: 'Bearer test' },
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      { type: 'text', content: 'café' },
      { type: 'reasoning', content: 'think' },
      { type: 'done' },
    ]);
    expect(logMock.info).toHaveBeenCalledWith(
      'stream',
      'raw event #1',
      { e: 'c', t: 'café' },
      'chunk',
    );
    expect(logMock.info).toHaveBeenCalledWith(
      'stream',
      'raw event #4',
      { event: 'reasoning_chunk', data: { text: 'think' } },
      'reasoning_chunk',
    );
    expect(logMock.warn).toHaveBeenCalledWith(
      'stream',
      'unparseable line #2',
      expect.objectContaining({ raw: 'not-json' }),
    );
    expect(logMock.warn).toHaveBeenCalledWith('stream', 'unknown JSON envelope', {
      other: true,
    });
  });

  it('keeps HTTP failures typed and emits one terminal event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 409 })));
    const events: StreamEvent[] = [];

    await streamFetch({
      url: 'https://example.test/stream',
      headers: {},
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      {
        type: 'error',
        message: 'The chat service could not complete this request. Try again.',
        status: 409,
      },
      { type: 'done' },
    ]);
  });

  it.each([
    {
      name: 'the captured validation rejection without echoing its rejected request context',
      status: 422,
      body: JSON.stringify({
        error: 'validation_error',
        message: 'Request validation failed with 1 issue: `body.organization_id`: Field required',
        details: [
          {
            field: 'body.organization_id',
            rejected_input: {
              user_input: 'What is the title of this page?',
              context: {
                access_token: 'must-never-reach-chat',
                page_title: 'Native Harness Target',
              },
            },
          },
        ],
      }),
      userMessage: 'The chat service could not start this request. Try again.',
    },
    {
      name: 'a temporary upstream outage',
      status: 503,
      body: 'upstream unavailable while contacting provider',
      userMessage: 'The chat service is temporarily unavailable. Try again.',
    },
  ])(
    'reports $name with a retryable user message while Debug keeps the response detail',
    async ({ status, body, userMessage }) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
      const events: StreamEvent[] = [];

      await streamFetch({
        url: 'https://example.test/stream',
        headers: {},
        onEvent: (event) => events.push(event),
      });

      expect(events).toEqual([{ type: 'error', message: userMessage, status }, { type: 'done' }]);
      expect(JSON.stringify(events)).not.toContain('access_token');
      expect(JSON.stringify(events)).not.toContain('organization_id');
      expect(logMock.error).toHaveBeenCalledWith(
        'stream',
        `✗ https://example.test/stream ${status}`,
        body,
      );
    },
  );
});
