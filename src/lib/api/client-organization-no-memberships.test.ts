/**
 * THE ZERO-MEMBERSHIPS HOLD (residual of Arman, 2026-09-19's organization
 * hold).
 *
 * A user who belongs to NO organization at all cannot ever answer the
 * picker — there is nothing to pick. Before this fix, `holdForActiveOrganizationId`
 * raised the picker and then waited the full `ORGANIZATION_PICK_TIMEOUT_MS`
 * (120s) regardless, because it could not tell "nobody answered yet" apart
 * from "nobody CAN ever answer". The held request must instead settle
 * immediately with a typed refusal naming the create/join remedy.
 *
 * Same harness as `client-organization-hold.test.ts` — the real
 * `src/lib/org/active-org.ts` runs over a doubled storage/network/Supabase
 * seam, so this proves the actual timing, not a mocked resolver.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const harness = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const watchers = new Set<(key: string, value: unknown) => void>();
  return {
    store,
    watchers,
    memberships: [] as string[],
    broadcast: vi.fn(),
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
    rpc: async () => ({
      data: harness.memberships.map((id) => ({ container_id: id })),
      error: null,
    }),
  }),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  iamDb: () => ({
    from: () => ({
      select: () => ({
        in: async () => ({
          data: harness.memberships.map((id) => ({
            id,
            name: `Org ${id.slice(0, 4)}`,
            is_personal: false,
          })),
          error: null,
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
vi.mock('@/lib/messaging/native', () => ({ broadcast: harness.broadcast, on: () => () => {} }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { STATUS_NO_ORGANIZATION, apiGet } from './client';

beforeEach(() => {
  harness.store.clear();
  harness.watchers.clear();
  harness.broadcast.mockClear();
  harness.memberships = []; // the whole point: zero memberships
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a held request from a user with no organization memberships', () => {
  it('settles immediately with a create-or-join remedy — never the 120s picker wait', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiGet('/agents/list');

    // The old code required the full ORGANIZATION_PICK_TIMEOUT_MS (120s) to
    // elapse before this promise would settle. Advancing only 1ms and
    // expecting a settled, typed refusal is exactly what used to be red:
    // this would still be pending at this point on the old code.
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(STATUS_NO_ORGANIZATION);
    expect(result.error).toMatch(/do not belong to any organization/i);
    expect(result.error).toMatch(/organizations/i); // names the create/join remedy link
    expect(fetchMock).not.toHaveBeenCalled();
    // The picker was still raised, for whoever is looking at the panel.
    expect(harness.store.get('matrx.org.picker-pending')).toBe(true);
  });
});
