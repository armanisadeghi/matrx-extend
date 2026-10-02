import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A rejoin that answers `409 live_stream_unavailable` (no journal to replay)
 * used to end the extension's chat with an EMPTY assistant bubble. Now the
 * stream layer classifies it, and `settleUnavailableRejoin` takes the shared
 * `@ai-matrx/agents` fallback: follow the run to its end under the
 * conversation's organization, then reload the SAVED turn.
 *
 * Faked: the network (`fetch`), the base URL/headers port, and the
 * conversation-organization read. Real: `streamFetch`, the package's
 * classifiers, `followUnavailableRejoin` and `settleRunPickup`.
 *
 * Seam not covered here: the two chat hooks' `done` handlers that call this
 * (module-level messaging listeners); they are covered by `pnpm compile` only.
 */

const BASE = 'https://server.app.matrxserver.com';
const LIVE = 'f8656746-232f-4d83-8d05-c9cc23e52db9';
const DECOY = '0b7a1c55-9e1d-4f7c-8a2e-3d4c5b6a7f80';
const CONVERSATION = '6c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5';
const CONVERSATION_ORG = '7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6';
const WF_RUN = '9e8d7c6b-5a49-4382-a716-152433425160';

vi.mock('@/lib/api/client', () => ({
  getApiBaseUrl: async () => BASE,
  buildHeaders: async (extra: Record<string, string> = {}) => ({
    Authorization: 'Bearer member-session',
    ...extra,
  }),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  chatDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { organization_id: CONVERSATION_ORG }, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ send: vi.fn(), broadcast: vi.fn() }));

import { type StreamEvent, streamFetch } from '@/lib/api/stream';
import { settleUnavailableRejoin } from './rejoin';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}
let calls: Call[] = [];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function script(...responses: (Response | Error)[]) {
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        headers: { ...(init.headers as Record<string, string>) },
      });
      const next = queue.shift();
      if (!next) throw new Error(`no scripted response for ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }),
  );
}

/** What `aidream/api/errors.py` sends for each refusal (envelope with the `request_id` decoy). */
const UNAVAILABLE = {
  error: 'live_stream_unavailable',
  code: 'live_stream_unavailable',
  message: 'Live response replay is unavailable for this operation.',
  user_message: 'Live response replay is unavailable for this operation.',
  details: null,
  request_id: DECOY,
};
const RUN_IN_PROGRESS = {
  error: 'run_in_progress',
  code: 'run_in_progress',
  message: 'This run is still running; rejoin it.',
  user_message: 'This run is still running; rejoin it.',
  details: null,
  request_id: DECOY,
  live_request_id: LIVE,
  rejoin_path: `/runtime/operations/${LIVE}/rejoin`,
};
const CHAT_RESUME_CONFLICT = {
  error: 'resume_conflict',
  code: 'resume_conflict',
  message: 'resume_conflict: a run is already active for this request — rejoin it.',
  user_message: 'resume_conflict: a run is already active for this request — rejoin it.',
  details: { retryable: true, live_request_id: LIVE },
  request_id: DECOY,
  live_request_id: LIVE,
  rejoin_path: `/runtime/operations/${LIVE}/rejoin`,
};

function operationView(status: string, isTerminal: boolean) {
  return {
    request_id: LIVE,
    operation_count: 1,
    operations: [
      {
        execution_id: 'ex-77',
        request_id: LIVE,
        type: 'agent_run',
        status,
        is_terminal: isTerminal,
        waiting_input: false,
        cost: 0,
        meters: {},
        link_kind: 'conversation',
        link_id: CONVERSATION,
        error: null,
        created_at: null,
        started_at: null,
        ended_at: null,
        last_event_seq: 5,
        events_path: '/runtime/executions/ex-77/events',
        stream_path: '/runtime/executions/ex-77/events/stream',
      },
    ],
  };
}

function sseEnd(status: string): Response {
  return new Response(
    `id: 6\nevent: execution_event\ndata: {"seq":6,"kind":"${status}","execution_id":"ex-77","root_execution_id":null,"detail":null,"created_at":null}\n\n` +
      `event: end\ndata: {"status":"${status}"}\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

async function errorOf(response: Response): Promise<Extract<StreamEvent, { type: 'error' }>> {
  script(response);
  const events: StreamEvent[] = [];
  await streamFetch({
    url: `${BASE}/runtime/operations/${LIVE}/rejoin`,
    body: {},
    headers: {},
    onEvent: (e) => events.push(e),
  });
  const error = events.find((e) => e.type === 'error');
  if (!error || error.type !== 'error') throw new Error('expected an error event');
  return error;
}

const REJOIN = {
  liveRequestId: LIVE,
  rejoinPath: `/runtime/operations/${LIVE}/rejoin`,
  runId: null,
};

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stream refusals are classified by the shared package', () => {
  it('a rejoin with no journal is live_stream_unavailable (carrying a workflow run_id when named)', async () => {
    const plain = await errorOf(json(UNAVAILABLE, 409));
    expect(plain.code).toBe('live_stream_unavailable');
    expect(plain.unavailableRunId).toBeNull();
    expect(plain.rejoin).toBeUndefined();

    const workflow = await errorOf(json({ ...UNAVAILABLE, run_id: WF_RUN }, 409));
    expect(workflow.unavailableRunId).toBe(WF_RUN);
  });

  it('run_in_progress carries the live request (never the decoy request_id) to rejoin', async () => {
    const error = await errorOf(json(RUN_IN_PROGRESS, 409));
    expect(error.code).toBe('run_in_progress');
    expect(error.rejoin).toEqual(REJOIN);
  });

  it("chat's resume_conflict is retried, never rejoined — even when it names a live run", async () => {
    const error = await errorOf(json(CHAT_RESUME_CONFLICT, 409));
    expect(error.code).toBe('resume_conflict');
    expect(error.rejoin).toBeUndefined();
  });
});

describe('settleUnavailableRejoin', () => {
  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
  ])(
    'follows a %s run to its end under the conversation org, then reloads the saved turn',
    async (runStatus, expected) => {
      script(json(operationView('running', false), 200), sseEnd(runStatus));
      const order: string[] = [];
      const settlement = await settleUnavailableRejoin({
        conversationId: CONVERSATION,
        rejoin: REJOIN,
        unavailableRunId: null,
        reloadSavedTurn: async () => {
          order.push(`reload after ${calls.length} calls`);
        },
      });
      expect(settlement).toEqual({ state: 'settled', status: expected, reloaded: true });
      expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
        `GET /runtime/operations/${LIVE}`,
        'GET /runtime/executions/ex-77/events/stream',
      ]);
      expect(calls[1]?.headers['Last-Event-ID']).toBe('5');
      expect(calls.every((c) => c.headers['X-Organization-Id'] === CONVERSATION_ORG)).toBe(true);
      // The saved turn is read only once the run is over.
      expect(order).toEqual(['reload after 2 calls']);
    },
  );

  it('a run that already finished reloads the saved turn without following', async () => {
    script(json(operationView('completed', true), 200));
    let reloads = 0;
    const settlement = await settleUnavailableRejoin({
      conversationId: CONVERSATION,
      rejoin: REJOIN,
      unavailableRunId: null,
      reloadSavedTurn: async () => {
        reloads += 1;
      },
    });
    expect(settlement).toEqual({ state: 'settled', status: 'completed', reloaded: true });
    expect(calls).toHaveLength(1);
    expect(reloads).toBe(1);
  });

  it('when the follow itself fails, the saved turn still reloads and the run reads as still running — never failed', async () => {
    script(new TypeError('Failed to fetch'));
    let reloads = 0;
    const settlement = await settleUnavailableRejoin({
      conversationId: CONVERSATION,
      rejoin: REJOIN,
      unavailableRunId: null,
      reloadSavedTurn: async () => {
        reloads += 1;
      },
    });
    expect(settlement).toEqual({ state: 'still_running', reloaded: true });
    expect(reloads).toBe(1);
  });
});
