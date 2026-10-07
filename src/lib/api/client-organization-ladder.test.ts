/**
 * THE LADDER ON THE REQUEST PATH (Arman, 2026-10-07).
 *
 * An authenticated request never waits and never asks. With no device choice
 * the load ladder answers before the request leaves: the account's last
 * active organization, then its start-up organization, then the first
 * organization. The real `src/lib/org/active-org.ts` runs here over a doubled
 * storage/network/Supabase seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_A = '22222222-2222-4222-8222-222222222222';
const ORG_B = '33333333-3333-4333-8333-333333333333';

const harness = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const watchers = new Set<(key: string, value: unknown) => void>();
  return {
    store,
    watchers,
    memberships: [] as string[],
    account: { lastActive: null as string | null, startup: null as string | null },
  };
});

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => 'token-1',
  getStoredAccessToken: async () => 'token-1',
  getCurrentUser: async () => ({ id: USER_ID }),
  getVerifiedCurrentUser: async () => ({ id: USER_ID }),
  describeStoredSession: async () => ({}),
  refreshAccessToken: async () => null,
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    schema: () => ({ rpc: async () => ({ error: null }) }),
    rpc: async () => ({
      data: harness.memberships.map((id, i) => ({
        container_id: id,
        status: 'active',
        created_at: `2026-01-0${i + 1}T00:00:00Z`,
      })),
      error: null,
    }),
  }),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  usersDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              last_active_organization_id: harness.account.lastActive,
              startup_organization_id: harness.account.startup,
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
  iamDb: () => ({
    from: () => ({
      select: () => ({
        in: () => ({
          is: async (column: string, value: unknown) => {
            if (column !== 'archived_at' || value !== null)
              throw new Error('Archive filter missing');
            return {
              data: harness.memberships.map((id) => ({
                id,
                name: `Org ${id.slice(0, 4)}`,
              })),
              error: null,
            };
          },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: async (key: string) => harness.store.get(key) ?? null,
  setOne: async (key: string, value: unknown) => {
    harness.store.set(key, value);
    for (const watcher of [...harness.watchers]) watcher(key, value);
  },
  onChange: (key: string, cb: (next: unknown) => void) => {
    const watcher = (changed: string, value: unknown) => {
      if (changed === key) cb(value ?? null);
    };
    harness.watchers.add(watcher);
    return () => harness.watchers.delete(watcher);
  },
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { clearActiveOrganization, setActiveOrganization } from '@/lib/org/active-org';
import { apiGet } from './client';

beforeEach(async () => {
  harness.store.clear();
  harness.watchers.clear();
  harness.account = { lastActive: null, startup: null };
  harness.memberships = [ORG_A, ORG_B];
  await clearActiveOrganization();
  harness.store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;

describe("an authenticated request carries the ladder's organization without waiting", () => {
  it("sends the account's last active organization when this device has no choice", async () => {
    harness.account.lastActive = ORG_B;
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiGet('/agents/list');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentHeaders(fetchMock)['X-Organization-Id']).toBe(ORG_B);
    expect(sentHeaders(fetchMock).Authorization).toBe('Bearer token-1');
    // The ladder never turns into a stored device choice.
    expect(harness.store.get('matrx.org.active')).toBeUndefined();
  });

  it('sends the start-up organization when there is no last active one', async () => {
    harness.account.startup = ORG_B;
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiGet('/agents/list');
    expect(sentHeaders(fetchMock)['X-Organization-Id']).toBe(ORG_B);
  });

  it('sends the FIRST organization when the account saved nothing, with several memberships', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiGet('/agents/list');
    expect(sentHeaders(fetchMock)['X-Organization-Id']).toBe(ORG_A);
  });

  it("sends this device's own choice over the account's", async () => {
    harness.account.lastActive = ORG_A;
    await setActiveOrganization(ORG_B);
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiGet('/agents/list');
    expect(sentHeaders(fetchMock)['X-Organization-Id']).toBe(ORG_B);
  });
});
