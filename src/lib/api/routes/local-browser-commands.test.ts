import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: '00000000-0000-4000-8000-000000000001',
  org: '00000000-0000-4000-8000-000000000002',
  token: 'x.eyJzZXNzaW9uX2lkIjoic2Vzc2lvbi1hIn0.y',
}));
vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://private.example' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => state.token,
  getVerifiedCurrentUser: async () => ({ id: state.user }),
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => state.org,
  holdForActiveOrganizationId: async () => state.org,
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
  OrganizationNotSelectedError: class extends Error {},
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import {
  approveLocalCommand,
  claimLocalCommand,
  completeLocalCommand,
  verifyLocalCommandTransport,
} from './local-browser-commands';

const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const actor = { userId: id, organizationId: secondId, sessionId: 'session-a' };
const base = {
  expectedActor: actor,
  deadlineMs: Date.now() + 10_000,
  isCurrent: () => true,
  signal: new AbortController().signal,
};
const noStore = { headers: { 'cache-control': 'no-store' } };

afterEach(() => vi.unstubAllGlobals());

describe('local browser command wire validation', () => {
  it('uses privatePost for transport authority before command approval', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'accepted',
            operation: 'approve',
            run_id: id,
            app_instance_id: secondId,
            controller_revision: 3,
            jti: '00000000-0000-4000-8000-000000000003',
            expires_at_ms: Date.now() + 9_000,
            extension_generation: '00000000-0000-4000-8000-000000000004',
            connection_id: '00000000-0000-4000-8000-000000000005',
            actor_id: id,
            organization_id: secondId,
            profile_id: '00000000-0000-4000-8000-000000000006',
            admission_id: '00000000-0000-4000-8000-000000000007',
            command_id: '00000000-0000-4000-8000-000000000008',
            sequence: 1,
            command_digest: 'a'.repeat(64),
            approval_id: '00000000-0000-4000-8000-000000000009',
            deadline_ms: Date.now() + 9_000,
          }),
          noStore,
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyLocalCommandTransport({
        ...base,
        grant: 'grant',
        operation: 'approve',
        app_instance_id: secondId,
        command_json: '{"operation":"inspect_login"}',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe(
      'https://private.example/browser-manager/local/transport/verify',
    );
  });

  it('rejects malformed ids and does not dispatch approval', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      approveLocalCommand({ ...base, grant: 'g', approval_id: 'bad', decision: 'allow' }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves exact command bytes but rejects malformed and oversized claim bodies', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'g',
        command_json: '{"operation":"inspect_login"}',
        document: { url: 'https://example.com', document_id: 'bad' },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'g',
        command_json: `{"operation":"navigate","url":"${'a'.repeat(17_000)}"}`,
        document: { url: 'https://example.com', document_id: id },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an injected secret for an operation that cannot receive one', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'claimed',
            command_id: id,
            deadline_ms: Date.now() + 8_000,
            completion_grant: 'completion',
            injection: {
              origin: 'https://example.com',
              fields: { password: 'secret' },
              expires_at_ms: Date.now() + 8_000,
            },
          }),
          noStore,
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'claim',
        command_json: '{"operation":"inspect_login"}',
        document: { url: 'https://example.com/login', document_id: id },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });

  it('rejects unknown result fields and a response bound to another command', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            result: {
              command_id: secondId,
              operation: 'navigate',
              outcome: 'completed',
              reason: 'none',
              data: { origin: 'https://example.com' },
            },
          }),
          noStore,
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      completeLocalCommand({
        ...base,
        grant: 'g',
        result: {
          command_id: id,
          operation: 'navigate',
          outcome: 'completed',
          reason: 'none',
          secret: 'never-send',
        } as never,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    await expect(
      completeLocalCommand({
        ...base,
        grant: 'g',
        result: {
          command_id: id,
          operation: 'navigate',
          outcome: 'completed',
          reason: 'none',
          data: { origin: 'https://example.com' },
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });

  it('does not send after its authority is stale', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      completeLocalCommand({
        ...base,
        grant: 'g',
        isCurrent: () => false,
        result: {
          command_id: id,
          operation: 'navigate',
          outcome: 'completed',
          reason: 'none',
          data: { origin: 'https://example.com' },
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'identity_changed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
