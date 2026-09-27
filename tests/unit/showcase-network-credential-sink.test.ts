import { savePattern } from '@/lib/supabase/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recorder = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('@/lib/supabase/client', () => {
  const client = {
    schema: () => client,
    from: () => client,
    insert: (payload: unknown) => {
      recorder.insert(payload);
      return client;
    },
    select: () => client,
    single: async () => ({ data: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, error: null }),
  };
  return {
    supabaseForActor: () => client,
    getSupabase: () => client,
    getMachineryAuthoredSupabase: () => client,
    hasSupabaseAccessToken: () => true,
  };
});

const common = {
  authored_by: 'person' as const,
  organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  domain: 'calendar.invalid',
  route_pattern: '/calendar',
  list_root_selector: null,
  fields: [],
  kind: 'network_capture' as const,
};

beforeEach(() => recorder.insert.mockClear());

describe('D48 actual network_capture save sink', () => {
  it('keeps ordinary date/page identity but writes no recognized URL credentials or raw URL side field', async () => {
    const canary = 'SYNTHETIC_ONLY_TOKEN_VALUE';
    await savePattern({
      ...common,
      name: `Network: calendar.invalid…access_token=${canary}&page=2`,
      config: {
        url_filter: `https://calendar.invalid/api/events?date=2026-09-27&access_token=${canary}&page=2`,
        url_match: 'exact',
        method: 'GET',
        key_path: 'events',
        raw_event_url: `https://calendar.invalid/api/events?access_token=${canary}`,
      },
    });
    expect(recorder.insert).toHaveBeenCalledTimes(1);
    const payload = recorder.insert.mock.calls[0]?.[0] as {
      name: string;
      config: { url_filter: string; raw_event_url?: string };
    };
    expect(JSON.stringify(payload)).not.toContain(canary);
    expect(payload.name).toBe('Network: calendar.invalid/api/events');
    expect(payload.config.url_filter).toContain('date=2026-09-27');
    expect(payload.config.url_filter).toContain('page=2');
    expect(payload.config.url_filter).toContain('access_token=[credential]');
    expect(payload.config.raw_event_url).toBeUndefined();
  });

  it('applies an explicit unknown-key credential choice at the persistence boundary', async () => {
    const canary = 'SYNTHETIC_ONLY_UNKNOWN_VALUE';
    await savePattern({
      ...common,
      name: 'Regional events',
      config: {
        url_filter: `https://calendar.invalid/api/events?date=2026-09-27&proof=${canary}&page=2`,
        credential_query_keys: ['proof'],
        url_match: 'exact',
        method: 'GET',
        key_path: 'events',
      },
    });
    const payload = recorder.insert.mock.calls[0]?.[0] as {
      name: string;
      config: { url_filter: string; credential_query_keys: string[] };
    };
    expect(JSON.stringify(payload)).not.toContain(canary);
    expect(payload.name).toBe('Regional events');
    expect(payload.config.url_filter).toContain('proof=[credential]');
    expect(payload.config.credential_query_keys).toEqual(['proof']);
  });

  it('removes URL userinfo from the direct save name and config even without a config object', async () => {
    const canary = 'SYNTHETIC_PASSWORD';
    await savePattern({
      ...common,
      name: `Network: https://user:${canary}@calendar.invalid/api/events?access_token=SYNTHETIC_TOKEN`,
      config: {
        url_filter: `https://user:${canary}@calendar.invalid/api/events?access_token=SYNTHETIC_TOKEN`,
      },
    });
    await savePattern({
      ...common,
      name: `Network: https://user:${canary}@calendar.invalid/api/events?access_token=SYNTHETIC_TOKEN`,
      config: undefined,
    });
    expect(recorder.insert).toHaveBeenCalledTimes(2);
    for (const [payload] of recorder.insert.mock.calls) {
      expect(JSON.stringify(payload)).not.toContain(canary);
      expect(JSON.stringify(payload)).not.toContain('SYNTHETIC_TOKEN');
      expect((payload as { name: string }).name).toContain('calendar.invalid/api/events');
    }
  });

  it('rejects malformed body identity before persisting a Network recipe', async () => {
    await expect(
      savePattern({
        ...common,
        name: 'Network: calendar.invalid/api/events',
        config: {
          url_filter: 'https://calendar.invalid/api/events',
          body_match: 'exact',
          request_body_key: 'Bearer SYNTHETIC_BODY_SECRET',
        },
      }),
    ).rejects.toThrow(/body identity is invalid/i);
    expect(recorder.insert).not.toHaveBeenCalled();
  });

  it('drops a malformed body identity when URL-and-method-only matching is explicit', async () => {
    await savePattern({
      ...common,
      name: 'Network: calendar.invalid/api/events',
      config: {
        url_filter: 'https://calendar.invalid/api/events?date=2026-09-27',
        body_match: 'ignore',
        request_body_key: 'Bearer SYNTHETIC_BODY_SECRET',
      },
    });
    const payload = recorder.insert.mock.calls[0]?.[0] as { config: { request_body_key?: string } };
    expect(payload.config.request_body_key).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('SYNTHETIC_BODY_SECRET');
  });
});
