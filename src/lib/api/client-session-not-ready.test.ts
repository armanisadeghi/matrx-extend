import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * THE GUEST-DOWNGRADE GUARD (2026-09-19). A signed-in install whose bearer is
 * not readable yet must never send a request as a guest fingerprint: that is
 * how `/mandates/extend.browser_chat/resolution` earned a 401 on a fresh
 * install and the picker said the default agent was unavailable.
 */

const state = vi.hoisted(() => ({
  token: null as string | null,
  profile: null as { id: string } | null,
  tokenReads: 0,
}));

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://example.invalid' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => {
    state.tokenReads += 1;
    return state.token;
  },
  getCurrentUser: async () => state.profile,
  getStoredAccessToken: async () => state.token,
  refreshAccessToken: async () => null,
  getVerifiedCurrentUser: async () => state.profile,
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => '00000000-0000-4000-8000-000000000002',
  OrganizationNotSelectedError: class OrganizationNotSelectedError extends Error {
    remedy = 'Choose an organization.';
  },
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import { STATUS_SESSION_NOT_READY, apiGet, buildHeaders } from './client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  state.token = null;
  state.profile = null;
  state.tokenReads = 0;
});

describe('a signed-in session never speaks as a guest', () => {
  it('sends the guest fingerprint only when nobody is signed in', async () => {
    const headers = await buildHeaders();
    expect(headers['X-Fingerprint-ID']).toBe('guest');
    expect(headers.Authorization).toBeUndefined();
  });

  it('waits for the bearer to become readable and then sends it', async () => {
    vi.useFakeTimers();
    state.profile = { id: 'u1' };
    const pending = buildHeaders();
    // The bearer lands a beat after the surface asked (sign-in commit / refresh).
    await vi.advanceTimersByTimeAsync(300);
    state.token = 'token-late';
    await vi.advanceTimersByTimeAsync(300);
    const headers = await pending;
    expect(headers.Authorization).toBe('Bearer token-late');
    expect(headers['X-Fingerprint-ID']).toBeUndefined();
  });

  it('REFUSES with a remedy instead of downgrading when the bearer never comes', async () => {
    vi.useFakeTimers();
    state.profile = { id: 'u1' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pending = apiGet('/mandates/extend.browser_chat/resolution');
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(STATUS_SESSION_NOT_READY);
    expect(result.error).toMatch(/not ready yet/);
    expect(result.error).toMatch(/try again/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.tokenReads).toBeGreaterThan(1);
  });
});
