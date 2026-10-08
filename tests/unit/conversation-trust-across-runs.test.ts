import { STORAGE_KEYS } from '@/config/env';
import type { ApiResult } from '@/lib/api/client';
import type { ClientToolResultBody, ToolResultsResponse } from '@/lib/api/routes/tool-results';
import type { UserProfile } from '@/lib/auth/types';
import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';

const manager = { id: 'bde0bf98-6599-47b2-aab4-82e76dc9eab4', email: null } satisfies UserProfile;
const receptionist = {
  id: '8b2e65e1-f7a9-4fca-b9c6-7823b6e74a3e',
  email: null,
} satisfies UserProfile;

// "Allow this tool on <host> for the rest of this chat" must survive the next
// run of the same chat: every continuation after a tool result is a new run.
const h = vi.hoisted(() => ({
  handlers: new Map<string, Array<(p: any) => unknown>>(),
  broadcasts: vi.fn(),
  run: vi.fn(),
  post: vi.fn(),
  trustWrite: vi.fn(),
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

beforeEach(async () => {
  vi.resetModules();
  h.handlers.clear();
  h.broadcasts.mockClear();
  h.run.mockReset().mockResolvedValue({ ok: true });
  h.post.mockReset().mockImplementation(
    async (conversationId: string, results: ClientToolResultBody[]) =>
      ({
        ok: true,
        data: {
          resolved: results.map((result) => result.call_id),
          already_resolved: [],
          not_found: [],
          continuation_needed: false,
          user_request_id: null,
          conversation_id: conversationId,
        },
      }) satisfies ApiResult<ToolResultsResponse>,
  );
  h.trustWrite.mockReset().mockResolvedValue(undefined);
  const makeArea = () => {
    let store: Record<string, unknown> = {};
    return {
      get: async () => structuredClone(store),
      set: async (value: object) => {
        if ('matrx.dispatch.conversationTrust' in value) await h.trustWrite();
        store = { ...store, ...structuredClone(value) };
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
      clear: async () => {
        store = {};
      },
    };
  };
  Object.assign(chrome.storage, { local: makeArea(), session: makeArea() });
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: manager });
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

it('waits for remembered choices to persist before either tool can continue', async () => {
  // A property manager approves work on two SaaS hosts at once; both choices
  // must be durable before results can trigger fresh continuation runs.
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  h.trustWrite.mockImplementation(() => pendingWrite);
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'ask' });
  await delegate('maintenance-notion', 'approve-notion', 'https://app.notion.com/maintenance');
  await delegate(
    'maintenance-calendar',
    'approve-calendar',
    'https://calendar.google.com/maintenance',
  );
  await vi.waitFor(() => expect(confirmRequests()).toHaveLength(2));
  const approvals = Promise.all([
    emit(CHANNELS.TOOL_CONFIRM_RESPONSE, {
      callId: 'approve-notion',
      decision: 'allow',
      rememberFor: 'conversation',
    }),
    emit(CHANNELS.TOOL_CONFIRM_RESPONSE, {
      callId: 'approve-calendar',
      decision: 'allow',
      rememberFor: 'conversation',
    }),
  ]);
  try {
    await vi.waitFor(() => expect(h.trustWrite).toHaveBeenCalled());
    expect(h.run).not.toHaveBeenCalled();
    expect(h.post).not.toHaveBeenCalled();
  } finally {
    releaseWrite();
    await approvals;
  }
  await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
  await delegate('maintenance-notion-next', 'next-notion', 'https://app.notion.com/next-request');
  await delegate(
    'maintenance-calendar-next',
    'next-calendar',
    'https://calendar.google.com/next-request',
  );
  await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(4));
  expect(confirmRequests()).toHaveLength(2);
});

it('retains concurrent remembered hosts in the real storage map', async () => {
  const { addConversationTrust, loadConversationTrust } = await import(
    '@/lib/tools/dispatch-persist'
  );
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  h.trustWrite.mockImplementation(() => pendingWrite);
  const writes = Promise.all([
    addConversationTrust('maintenance-chat', 'navigate@app.notion.com'),
    addConversationTrust('maintenance-chat', 'navigate@calendar.google.com'),
    addConversationTrust('inspection-chat', 'navigate@app.notion.com'),
  ]);
  try {
    await vi.waitFor(() => expect(h.trustWrite).toHaveBeenCalled());
  } finally {
    releaseWrite();
    await writes;
  }
  expect(await loadConversationTrust('maintenance-chat')).toEqual([
    'navigate@app.notion.com',
    'navigate@calendar.google.com',
  ]);
  expect(await loadConversationTrust('inspection-chat')).toEqual(['navigate@app.notion.com']);
});

// The native repro reopens the SAME saved chat after a full extension reload.
// Chrome retains local storage but clears session storage and all JS realms.
it('retains remembered approvals after a full extension reload of the same chat', async () => {
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'ask' });
  await delegate('intake-first', 'intake-approval', 'https://app.notion.com/intake');
  await vi.waitFor(() => expect(confirmRequests()).toHaveLength(1));
  await emit(CHANNELS.TOOL_CONFIRM_RESPONSE, {
    callId: 'intake-approval',
    decision: 'allow',
    rememberFor: 'conversation',
  });
  await vi.waitFor(() => expect(h.post).toHaveBeenCalledTimes(1));
  await chrome.storage.session.clear();
  h.handlers.clear();
  vi.resetModules();
  const reopened = await import('@/lib/tools/dispatch');
  reopened.startToolDispatcher({ defaultPermissionMode: () => 'ask' });
  await delegate('intake-reopened', 'intake-next', 'https://app.notion.com/intake-next');
  await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
  expect(confirmRequests()).toHaveLength(1);
  await delegate('intake-other-site', 'calendar-next', 'https://calendar.google.com/intake');
  await vi.waitFor(() => expect(confirmRequests()).toHaveLength(2));
  expect(h.run).toHaveBeenCalledTimes(2);
});

it('keeps remembered choices with their approving actor and conversation', async () => {
  const trust = await import('@/lib/tools/dispatch-persist');
  await trust.addConversationTrust('intake-chat', 'navigate@app.notion.com');
  await chrome.storage.session.clear();
  vi.resetModules();
  const reopened = await import('@/lib/tools/dispatch-persist');
  expect(await reopened.loadConversationTrust('intake-chat')).toEqual(['navigate@app.notion.com']);
  expect(await reopened.loadConversationTrust('billing-chat')).toEqual([]);
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_PROFILE]: receptionist,
  });
  expect(await reopened.loadConversationTrust('intake-chat')).toEqual([]);
  await reopened.addConversationTrust('intake-chat', 'navigate@calendar.google.com');
  expect(await reopened.loadConversationTrust('intake-chat')).toEqual([
    'navigate@calendar.google.com',
  ]);
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: manager });
  expect(await reopened.loadConversationTrust('intake-chat')).toEqual(['navigate@app.notion.com']);
});

it('restores the same guest approval without sharing it with a signed-in actor', async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.USER_PROFILE);
  await chrome.storage.local.set({ [STORAGE_KEYS.GUEST_SIGNATURE]: 'a'.repeat(64) });
  const trust = await import('@/lib/tools/dispatch-persist');
  await trust.addConversationTrust('guest-intake-chat', 'navigate@app.notion.com');
  await chrome.storage.session.clear();
  vi.resetModules();
  const reopened = await import('@/lib/tools/dispatch-persist');
  expect(await reopened.loadConversationTrust('guest-intake-chat')).toEqual([
    'navigate@app.notion.com',
  ]);
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PROFILE]: manager });
  expect(await reopened.loadConversationTrust('guest-intake-chat')).toEqual([]);
});

it('a lookup issued with the approval observes its queued durable write', async () => {
  const trust = await import('@/lib/tools/dispatch-persist');
  let releaseWrite!: () => void;
  h.trustWrite.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const write = trust.addConversationTrust('intake-chat', 'navigate@app.notion.com');
  const lookup = trust.loadConversationTrust('intake-chat');
  await vi.waitFor(() => expect(h.trustWrite).toHaveBeenCalled());
  releaseWrite();
  await write;
  expect(await lookup).toEqual(['navigate@app.notion.com']);
});
