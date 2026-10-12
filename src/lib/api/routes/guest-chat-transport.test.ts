import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Guards guest Chat queue controls and delegated continuation against an
// organization preflight before the request reaches the server-owned guest funnel.
const state = vi.hoisted(() => ({ token: null as string | null, org: null as string | null }));
vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
  getStoredAccessToken: async () => state.token,
  getCurrentUser: async () => (state.token ? { id: 'member' } : null),
  getVerifiedCurrentUser: async () => (state.token ? { id: 'member' } : null),
  describeStoredSession: async () => ({}),
  refreshAccessToken: async () => null,
}));
vi.mock('@/lib/auth/guest-signature', () => ({
  getOrCreateGuestSignature: async () => 'guest-fingerprint',
}));
vi.mock('@/lib/org/active-org', () => {
  class OrganizationNotSelectedError extends Error {
    remedy = 'Create or join an organization.';
  }
  return {
    OrganizationNotSelectedError,
    getActiveOrganizationId: async () => state.org,
    requireActiveOrganizationId: async () => {
      if (!state.org) throw new OrganizationNotSelectedError('No organization');
      return state.org;
    },
    isOrganizationNotSelectedError: (e: unknown) => e instanceof OrganizationNotSelectedError,
    isOrganizationNoMembershipsError: () => false,
  };
});
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import { STATUS_NO_ORGANIZATION } from '../client';
import {
  type InboxEnqueueResponse,
  type InboxItem,
  cancelInboxMessage,
  cancelRequest,
  editInboxMessage,
  enqueueInboxMessage,
  listPendingInboxMessages,
} from './ai';
import {
  type PendingCall,
  type ToolResultsResponse,
  getPendingCalls,
  postToolResults,
} from './tool-results';

const operations = [
  {
    name: 'queue follow-up',
    reply: {
      injection_id: 'injection/one',
      conversation_id: 'conversation/one',
      status: 'pending',
      run_active: true,
    } satisfies InboxEnqueueResponse,
    method: 'POST',
    path: '/ai/conversations/conversation%2Fone/inbox',
    body: {
      kind: 'user_message',
      is_visible_to_user: true,
      is_visible_to_model: true,
      text: 'Continue the page summary',
    },
    run: () => enqueueInboxMessage('conversation/one', { text: 'Continue the page summary' }),
  },
  {
    name: 'cancel run',
    reply: { status: 'cancelled' },
    method: 'POST',
    path: '/ai/cancel/request%2Fone',
    run: () => cancelRequest('request/one'),
  },
  {
    name: 'list queue',
    reply: [
      {
        injection_id: 'injection/one',
        kind: 'user_message',
        text: 'Continue the page summary',
        status: 'pending',
      },
    ] satisfies InboxItem[],
    method: 'GET',
    path: '/ai/conversations/conversation%2Fone/inbox?status=pending',
    run: () => listPendingInboxMessages('conversation/one'),
  },
  {
    name: 'edit queue',
    reply: { injection_id: 'injection/one', status: 'pending' },
    method: 'PATCH',
    path: '/ai/conversations/conversation%2Fone/inbox/injection%2Fone',
    body: { text: 'Summarize only the pricing' },
    run: () => editInboxMessage('conversation/one', 'injection/one', 'Summarize only the pricing'),
  },
  {
    name: 'cancel queue',
    reply: { injection_id: 'injection/one', status: 'cancelled' },
    method: 'DELETE',
    path: '/ai/conversations/conversation%2Fone/inbox/injection%2Fone',
    run: () => cancelInboxMessage('conversation/one', 'injection/one'),
  },
  {
    name: 'submit delegated results',
    reply: {
      continuation_needed: true,
      conversation_id: 'conversation/one',
      resolved: ['call-one'],
      already_resolved: [],
      not_found: [],
      user_request_id: 'request/one',
    } satisfies ToolResultsResponse,
    method: 'POST',
    path: '/ai/conversations/conversation%2Fone/tool_results',
    body: {
      results: [{ call_id: 'call-one', tool_name: 'read_page', output: { title: 'Pricing' } }],
    },
    run: () =>
      postToolResults('conversation/one', [
        { call_id: 'call-one', tool_name: 'read_page', output: { title: 'Pricing' } },
      ]),
  },
  {
    name: 'cold-resume discovery',
    reply: [
      {
        id: 'pending-one',
        call_id: 'call-one',
        conversation_id: 'conversation/one',
        user_request_id: 'request/one',
        message_id: null,
        tool_name: 'read_page',
        arguments: {},
        iteration: 1,
        created_at: null,
        expires_at: null,
      },
    ] satisfies PendingCall[],
    method: 'GET',
    path: '/ai/conversations/conversation%2Fone/pending_calls',
    run: () => getPendingCalls('conversation/one'),
  },
];
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
beforeEach(() => {
  state.token = null;
  state.org = null;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(operations)('$name reaches the real transport', (operation) => {
  beforeEach(() => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(operation.reply), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
  });
  it('sends a guest fingerprint with no fabricated organization', async () => {
    const result = await operation.run();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://example.invalid${operation.path}`);
    expect(init?.method).toBe(operation.method);
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Fingerprint-ID')).toBe('guest-fingerprint');
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Organization-Id')).toBeNull();
    if ('body' in operation) expect(JSON.parse(String(init?.body))).toEqual(operation.body);
    expect(result).toEqual({ ok: true, data: operation.reply });
  });
  it('carries the explicit organization with the signed-in bearer', async () => {
    state.token = 'member-bearer';
    state.org = '22222222-2222-4222-8222-222222222222';
    expect((await operation.run()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer member-bearer');
    expect(headers.get('X-Organization-Id')).toBe(state.org);
    expect(headers.get('X-Fingerprint-ID')).toBeNull();
  });
  it('refuses a signed-in bearer without an organization before transport', async () => {
    state.token = 'member-bearer';
    expect(await operation.run()).toMatchObject({ ok: false, status: STATUS_NO_ORGANIZATION });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
