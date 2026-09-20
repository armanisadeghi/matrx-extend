/**
 * THE HELD REQUEST (Arman, 2026-09-19).
 *
 * An authenticated request with no organization set on this device must not
 * fail and must not guess. It is HELD: the picker is raised, and the moment
 * the person sets an organization the SAME request goes out carrying the id
 * they chose. Only a question nobody answers becomes a failure — with a
 * remedy, and with nothing sent.
 *
 * The real `src/lib/org/active-org.ts` runs here over a real storage seam;
 * only the network, the session and Supabase are doubled. A test that mocked
 * the resolver would prove the client calls a function, not that a request
 * actually waits and then leaves with the right organization.
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

import { setActiveOrganization } from '@/lib/org/active-org';
import { STATUS_NO_ORGANIZATION, apiGet } from './client';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  harness.store.clear();
  harness.watchers.clear();
  harness.broadcast.mockClear();
  harness.memberships = [ORG_A, ORG_B];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an authenticated request with no organization waits for one', () => {
  it('holds, asks, and then sends the organization the person chose', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiGet('/agents/list');
    await settle();

    // Nothing left the browser, and the person was asked — in both the way an
    // open panel hears and the way a closed one hears later.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.store.get('matrx.org.picker-pending')).toBe(true);
    expect(harness.broadcast).toHaveBeenCalledWith('org:picker-requested', {});

    await setActiveOrganization(ORG_B);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    // ORG_B, because that is what they picked — not ORG_A, not "the first one".
    expect(sent['X-Organization-Id']).toBe(ORG_B);
    expect(sent.Authorization).toBe('Bearer token-1');
  });

  it('refuses with a remedy — and sends nothing — when nobody ever answers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiGet('/agents/list');
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.store.get('matrx.org.picker-pending')).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(STATUS_NO_ORGANIZATION);
    expect(result.error).toMatch(/choose your organization/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never asks when the person has exactly one organization', async () => {
    harness.memberships = [ORG_A];
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiGet('/agents/list');

    expect(result.ok).toBe(true);
    expect(harness.broadcast).not.toHaveBeenCalled();
    const sent = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sent['X-Organization-Id']).toBe(ORG_A);
  });
});
