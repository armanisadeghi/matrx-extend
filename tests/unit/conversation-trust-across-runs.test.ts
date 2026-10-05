import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

// "Allow this tool on <host> for the rest of this chat" must survive the next
// run of the same chat: every continuation after a tool result is a new run.
const h = vi.hoisted(() => ({
  handlers: new Map<string, Array<(p: any) => unknown>>(),
  broadcasts: vi.fn(),
  run: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, fn: (p: any) => unknown) => {
    const list = h.handlers.get(kind) ?? [];
    list.push(fn);
    h.handlers.set(kind, list);
    return () =>
      h.handlers.set(
        kind,
        (h.handlers.get(kind) ?? []).filter((f) => f !== fn),
      );
  },
  broadcast: (...args: unknown[]) => h.broadcasts(...args),
  send: vi.fn(),
}));
vi.mock('@/lib/tools/registry', () => {
  const navigate = {
    name: 'navigate',
    tier: 'action',
    argsSchema: z.object({ url: z.string() }),
    run: (...a: unknown[]) => h.run(...a),
  };
  return {
    lookup: (name: string) => (name === 'navigate' ? navigate : undefined),
    allToolNames: () => ['navigate'],
  };
});
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: async () => ({ active: false, groupId: -1 }),
}));
vi.mock('@/lib/tools/descriptions', () => ({
  primeToolDescriptions: vi.fn(),
  getToolDescription: () => 'Navigate',
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({
  PENDING_OUTPUT: {},
  buildReceipt: vi.fn(async () => ({})),
}));
vi.mock('@/lib/api/routes/tool-results', () => ({
  postToolResults: (...args: unknown[]) => h.post(...args),
}));
vi.mock('@/lib/recording/state', () => ({ recordToolEvent: vi.fn() }));
import { CHANNELS } from '@/lib/messaging/schemas';

const emit = async (kind: string, value: unknown) => {
  for (const fn of [...(h.handlers.get(kind) ?? [])]) await fn(value);
};
const confirmRequests = () =>
  h.broadcasts.mock.calls.filter((c) => c[0] === CHANNELS.TOOL_CONFIRM_REQUEST);

async function delegate(runId: string, callId: string, url: string) {
  await emit(CHANNELS.STREAM_OPENED, {
    runId,
    conversationId: 'conv-1',
    requestId: `req-${runId}`,
    permissionMode: 'ask',
  });
  await emit(CHANNELS.STREAM_CHUNK, {
    runId,
    type: 'event',
    payload: {
      eventName: 'tool_event',
      data: {
        event: 'tool_delegated',
        call_id: callId,
        tool_name: 'navigate',
        data: { arguments: { url } },
      },
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  h.handlers.clear();
  h.broadcasts.mockClear();
  h.run.mockReset().mockResolvedValue({ ok: true });
  h.post.mockReset().mockResolvedValue({ ok: true });
  let store: Record<string, unknown> = {};
  Object.assign(chrome.storage, {
    session: {
      get: async () => structuredClone(store),
      set: async (value: object) => {
        store = { ...store, ...structuredClone(value) };
      },
      remove: async () => {},
    },
  });
});

it('a remembered approval auto-allows the same tool + host on the next run of the chat', async () => {
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'ask' });

  await delegate('run-a', 'call-1', 'https://app.notion.com/p/one');
  await vi.waitFor(() => expect(confirmRequests()).toHaveLength(1));
  await emit(CHANNELS.TOOL_CONFIRM_RESPONSE, {
    callId: 'call-1',
    decision: 'allow',
    rememberFor: 'conversation',
  });
  await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));

  await delegate('run-b', 'call-2', 'https://app.notion.com/p/two');
  await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
  expect(confirmRequests()).toHaveLength(1);
});

it('without the checkbox, the next run still asks', async () => {
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'ask' });

  await delegate('run-a', 'call-1', 'https://app.notion.com/p/one');
  await vi.waitFor(() => expect(confirmRequests()).toHaveLength(1));
  await emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: 'call-1', decision: 'allow' });
  await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));

  await delegate('run-b', 'call-2', 'https://app.notion.com/p/two');
  await vi.waitFor(() => expect(confirmRequests()).toHaveLength(2));
  expect(h.run).toHaveBeenCalledTimes(1);
});
