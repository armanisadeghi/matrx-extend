import { expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ stream: vi.fn() }));
const MALFORMED_STORED_ORGANIZATION = 'not-a-uuid';

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://server.invalid/api' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => 'signed-in-token',
  getCurrentUser: async () => ({ id: 'member' }),
  getStoredAccessToken: async () => 'signed-in-token',
  getVerifiedCurrentUser: async () => ({ id: 'member' }),
  describeStoredSession: async () => ({}),
  refreshAccessToken: async () => null,
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => MALFORMED_STORED_ORGANIZATION,
  requireActiveOrganizationId: async () => MALFORMED_STORED_ORGANIZATION,
  holdForActiveOrganizationId: async () => MALFORMED_STORED_ORGANIZATION,
  OrganizationNotSelectedError: class OrganizationNotSelectedError extends Error {},
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));
vi.mock('@/lib/api/stream', () => ({ streamFetch: h.stream }));

import { runManualServerTool } from './manual-server';

it('refuses a real buildHeaders malformed-id result before any authenticated POST', async () => {
  h.stream.mockReset();
  await expect(runManualServerTool('records', { action: 'guide', args: {} })).rejects.toThrow(
    'valid organization',
  );
  expect(h.stream).not.toHaveBeenCalled();
});
