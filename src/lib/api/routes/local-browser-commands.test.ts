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
const baseDeadlineMs = Date.now() + 10_000;
const base = {
  commandId: id,
  expectedActor: actor,
  deadlineMs: baseDeadlineMs,
  authorizationDeadlineMs: baseDeadlineMs,
  executionDeadlineMs: baseDeadlineMs,
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
        document: { url: 'https://example.com', document_id: '' },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'g',
        command_json: '{"operation":"inspect_login"}',
        document: { url: 'https://example.com', document_id: 'x'.repeat(129) },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'g',
        command_json: '{"operation":"inspect_login"}',
        document: { url: 'https://example.com', document_id: 1 as never },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'g',
        command_json: `{"operation":"navigate","url":"${'a'.repeat(17_000)}"}`,
        document: { url: 'https://example.com', document_id: 'A'.repeat(32) },
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

  it('refuses a secret injection for an origin other than the claimed document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 'claimed',
              command_id: id,
              deadline_ms: Date.now() + 8_000,
              completion_grant: 'completion',
              injection: {
                origin: 'https://attacker.example',
                fields: { password: 'secret' },
                expires_at_ms: Date.now() + 8_000,
              },
            }),
            noStore,
          ),
      ),
    );
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'claim',
        command_json:
          '{"operation":"vault_login","credential_item_id":"00000000-0000-4000-8000-000000000001","fields":[{"selector":"#password","field_key":"password","clear_first":true}],"submit":{"kind":"none"}}',
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

  it('accepts an execution deadline after authorization but rejects any response past execution', async () => {
    const authorizationDeadlineMs = Date.now() + 1_000;
    const executionDeadlineMs = Date.now() + 8_000;
    const response = (deadline_ms: number) =>
      new Response(
        JSON.stringify({
          status: 'claimed',
          command_id: id,
          deadline_ms,
          completion_grant: 'completion',
        }),
        noStore,
      );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(executionDeadlineMs - 1_000)),
    );
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'claim',
        deadlineMs: executionDeadlineMs,
        authorizationDeadlineMs,
        executionDeadlineMs,
        command_json: '{"operation":"navigate","url":"https://example.com/"}',
        document: { url: 'https://example.com/login', document_id: id },
      }),
    ).resolves.toMatchObject({ ok: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(executionDeadlineMs + 1)),
    );
    await expect(
      claimLocalCommand({
        ...base,
        grant: 'claim',
        deadlineMs: executionDeadlineMs,
        authorizationDeadlineMs: Date.now() + 1_000,
        executionDeadlineMs,
        command_json: '{"operation":"navigate","url":"https://example.com/"}',
        document: { url: 'https://example.com/login', document_id: id },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });
});

it('refuses malformed nested login contracts before a private request', async () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ status: 'refused', reason: 'unavailable' }), noStore),
  );
  vi.stubGlobal('fetch', fetchMock);
  for (const command of [
    { operation: 'authenticator', credential_item_id: id, code_selector: '#code', submit: 'click' },
    {
      operation: 'authenticator',
      credential_item_id: id,
      code_selector: '#code',
      submit: { kind: 'none', secret: 'unexpected' },
    },
    {
      operation: 'vault_login',
      credential_item_id: id,
      fields: [{ selector: '#pw', field_key: 'password', clear_first: true }],
      steps: [{ fields: ['#other'], submit: { kind: 'none' } }],
    },
    {
      operation: 'vault_login',
      credential_item_id: id,
      fields: [{ selector: '#pw', field_key: 'password', clear_first: true }],
      steps: [
        {
          fields: ['#pw'],
          submit: { kind: 'none' },
          wait_for: { selector: '#next', timeout_ms: 60000 },
        },
      ],
      expect: { timeout_ms: 1000 },
    },
  ]) {
    await expect(
      claimLocalCommand({
        ...base,
        commandId: id,
        grant: 'claim',
        command_json: JSON.stringify(command),
        document: { url: 'https://example.com/login', document_id: id },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

it('refuses a claimed secret belonging to another command', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'claimed',
            command_id: secondId,
            deadline_ms: Date.now() + 5000,
            completion_grant: 'completion',
            injection: {
              origin: 'https://example.com',
              fields: { password: 'private-test-value' },
              expires_at_ms: Date.now() + 5000,
            },
          }),
          noStore,
        ),
    ),
  );
  await expect(
    claimLocalCommand({
      ...base,
      commandId: id,
      grant: 'claim',
      command_json: JSON.stringify({
        operation: 'vault_login',
        credential_item_id: id,
        fields: [{ selector: '#pw', field_key: 'password', clear_first: true }],
        submit: { kind: 'none' },
      }),
      document: { url: 'https://example.com/login', document_id: id },
    }),
  ).resolves.toEqual({ ok: false, error: 'invalid_response' });
});

it('accepts an exact completion receipt independently of object key order', async () => {
  const result = {
    data: { origin: 'https://example.com' },
    reason: 'none' as const,
    outcome: 'completed' as const,
    operation: 'navigate' as const,
    command_id: id,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            result: {
              command_id: id,
              operation: 'navigate',
              outcome: 'completed',
              reason: 'none',
              data: { origin: 'https://example.com' },
            },
          }),
          noStore,
        ),
    ),
  );
  await expect(
    completeLocalCommand({ ...base, grant: 'completion', result }),
  ).resolves.toMatchObject({ ok: true });
});

it('requires an observed authenticator verification before accepting completion', async () => {
  const result = {
    command_id: id,
    operation: 'authenticator' as const,
    outcome: 'completed' as const,
    reason: 'none' as const,
    data: {
      filled: true,
      submitted: true,
      challenge_detected: false,
      verification: 'unverified' as const,
      verification_digest: 'a'.repeat(64),
      observation: {
        password_field_present_before: true,
        password_field_present_after: null,
        otp_field_present_before: true,
        otp_field_present_after: null,
        captcha_present_before: false,
        captcha_present_after: null,
        login_form_present_before: true,
        login_form_present_after: null,
        url_relation: 'unknown' as const,
        url_flow: 'unknown' as const,
        success_url_prefix: null,
        success_selector: null,
        failure_selector: null,
        challenge_selector: null,
        recipe_matches: [],
      },
    },
  };
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ status: 'completed', result }), noStore),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { verification: _verification, ...incomplete } = result.data;
  await expect(
    completeLocalCommand({ ...base, grant: 'g', result: { ...result, data: incomplete } as never }),
  ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(
    completeLocalCommand({ ...base, grant: 'g', result: result as never }),
  ).resolves.toMatchObject({
    ok: true,
  });
});
