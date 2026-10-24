import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  consent: true,
  clientReads: 0,
  organizationReads: 0,
  activeOrganizationId: '11111111-1111-4111-8111-111111111111',
  result: '44444444-4444-4444-8444-444444444444' as unknown,
  errorMessage: null as string | null,
  calls: [] as Array<{ schema: string; name: string; args: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => {
    state.clientReads += 1;
    return {
      schema: (schema: string) => ({
        rpc: (name: string, args: Record<string, unknown>) => {
          state.calls.push({ schema, name, args });
          return Promise.resolve(
            state.errorMessage
              ? {
                  data: null,
                  error: {
                    code: 'P0001',
                    message: state.errorMessage,
                    details: null,
                    hint: null,
                  },
                }
              : { data: state.result, error: null },
          );
        },
      }),
    };
  },
}));
vi.mock('@/lib/telemetry/external-reporting', () => ({
  mayReportExternalTelemetry: async () => state.consent,
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => {
    state.organizationReads += 1;
    return state.activeOrganizationId;
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.consent = true;
  state.clientReads = 0;
  state.organizationReads = 0;
  state.activeOrganizationId = '11111111-1111-4111-8111-111111111111';
  state.result = '44444444-4444-4444-8444-444444444444';
  state.errorMessage = null;
  state.calls = [];
});

afterEach(() => vi.restoreAllMocks());

describe('recordClientError through the declared data door', () => {
  it('sends the existing public RPC contract once and returns its id', async () => {
    const { recordClientError } = await import('./client-error');
    const organizationId = '22222222-2222-4222-8222-222222222222';

    await expect(
      recordClientError({
        feature: 'social',
        message: 'save stopped',
        code: 'save_failed',
        route: '/social/ingest/post',
        requestId: 'request-17',
        context: { step: 'ingest', client: 'caller-value' },
        organizationId,
      }),
    ).resolves.toBe('44444444-4444-4444-8444-444444444444');

    expect(state.clientReads).toBe(1);
    expect(state.calls).toEqual([
      {
        schema: 'public',
        name: 'log_client_error',
        args: {
          p_source_app: 'matrx-extend',
          p_source_feature: 'social',
          p_source: 'chrome-extension',
          p_message: 'save stopped',
          p_code: 'save_failed',
          p_route: '/social/ingest/post',
          p_request_id: 'request-17',
          p_context: { client: 'caller-value', step: 'ingest' },
          p_organization_id: organizationId,
        },
      },
    ]);
    expect(state.organizationReads).toBe(0);
  });

  it('uses lazy active-organization resolution only when the report omits an organization', async () => {
    const { recordClientError } = await import('./client-error');

    await recordClientError({
      feature: 'social',
      message: 'save stopped',
      code: 'save_failed',
      route: '/social/ingest/post',
      context: {},
    });

    expect(state.organizationReads).toBe(1);
    expect(state.calls[0]?.args.p_organization_id).toBe(state.activeOrganizationId);
  });

  it('declined diagnostics do not construct the client or call the RPC', async () => {
    state.consent = false;
    const { recordClientError } = await import('./client-error');

    await expect(
      recordClientError({
        feature: 'social',
        message: 'save stopped',
        code: 'save_failed',
        route: '/social/ingest/post',
        context: {},
      }),
    ).resolves.toBeNull();

    expect(state.clientReads).toBe(0);
    expect(state.calls).toEqual([]);
    expect(state.organizationReads).toBe(0);
  });

  it('preserves the database refusal message and still throws when the RPC returns no id', async () => {
    const { recordClientError } = await import('./client-error');
    const report = {
      feature: 'social',
      message: 'save stopped',
      code: 'save_failed',
      route: '/social/ingest/post',
      context: {},
      organizationId: '22222222-2222-4222-8222-222222222222',
    };

    state.errorMessage = 'organization policy refused the report';
    await expect(recordClientError(report)).rejects.toThrow(
      'organization policy refused the report',
    );

    state.errorMessage = null;
    state.result = null;
    await expect(recordClientError(report)).rejects.toThrow(
      'log_client_error returned no error id',
    );
    expect(state.clientReads).toBe(2);
    expect(state.calls).toHaveLength(2);
  });
});
