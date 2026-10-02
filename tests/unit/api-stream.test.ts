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
  it('preserves fragmented UTF-8 and trailing input while diagnostics retain only structure', async () => {
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
    expect(logMock.info).toHaveBeenCalledWith('stream', 'event #1', { event: 'chunk' }, 'chunk');
    expect(logMock.info).toHaveBeenCalledWith(
      'stream',
      'event #4',
      { event: 'reasoning_chunk' },
      'reasoning_chunk',
    );
    expect(logMock.warn).toHaveBeenCalledWith(
      'stream',
      'unparseable line #2',
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(logMock.warn).toHaveBeenCalledWith('stream', 'unknown JSON envelope');
    expect(JSON.stringify([logMock.info.mock.calls, logMock.warn.mock.calls])).not.toContain(
      'café',
    );
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

  it('classifies a resume conflict without forwarding its response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"resume_conflict","detail":"secret"}', { status: 409 }),
        ),
    );
    const events: StreamEvent[] = [];

    await streamFetch({
      url: 'https://example.test/resume',
      headers: {},
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      {
        type: 'error',
        message: 'The chat service could not complete this request. Try again.',
        status: 409,
        code: 'resume_conflict',
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
    'reports $name with a retryable user message while Debug keeps status, not response text',
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
        expect.objectContaining({ status }),
      );
      expect(JSON.stringify(logMock.error.mock.calls)).not.toContain('must-never-reach-chat');
    },
  );
});

describe('streamFetch server error events and live runs', () => {
  it("shows the server's user_message from a stream error event, not generic copy", async () => {
    const billing =
      "OpenAI refused this request: the platform's OpenAI account is out of credit.";
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fragmentedResponse([
          new TextEncoder().encode(
            `${JSON.stringify({
              event: 'error',
              data: {
                error_type: 'insufficient_quota',
                message: 'provider said 429 insufficient_quota',
                user_message: billing,
              },
            })}\n`,
          ),
        ]),
      ),
    );
    const events: StreamEvent[] = [];

    await streamFetch({
      url: 'https://example.test/stream',
      headers: {},
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([{ type: 'error', message: billing }, { type: 'done' }]);
  });

  it('classifies a live-run 409 by the body rejoin_path, never the envelope request_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'run_in_progress',
            code: 'run_in_progress',
            request_id: 'api-call-id-not-the-run',
            live_request_id: 'live-run-7f3a',
            rejoin_path: '/runtime/operations/live-run-7f3a/rejoin',
            user_message: 'This run is still running.',
          }),
          { status: 409 },
        ),
      ),
    );
    const events: StreamEvent[] = [];

    await streamFetch({
      url: 'https://example.test/ai/conversations/c1/resume',
      headers: {},
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      {
        type: 'error',
        message: 'The chat service could not complete this request. Try again.',
        status: 409,
        code: 'run_in_progress',
        rejoinPath: '/runtime/operations/live-run-7f3a/rejoin',
      },
      { type: 'done' },
    ]);
  });

  it('treats a resume_conflict that names a live run as a rejoin, not a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'resume_conflict',
            code: 'resume_conflict',
            live_request_id: 'live-run-9c1d',
            rejoin_path: '/runtime/operations/live-run-9c1d/rejoin',
          }),
          { status: 409 },
        ),
      ),
    );
    const events: StreamEvent[] = [];

    await streamFetch({
      url: 'https://example.test/ai/conversations/c1/resume',
      headers: {},
      onEvent: (event) => events.push(event),
    });

    expect(events[0]).toMatchObject({
      code: 'run_in_progress',
      rejoinPath: '/runtime/operations/live-run-9c1d/rejoin',
    });
  });
});
