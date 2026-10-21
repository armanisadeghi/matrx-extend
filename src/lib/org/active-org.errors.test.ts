import { describe, expect, it, vi } from 'vitest';

/**
 * CHARACTERIZATION (2026-10-21): the two typed refusals every catch site in
 * the extension relies on — class identity, the `is*` guards, `code`,
 * `remedy`, `name` and the words shown to the person. Pinned before the
 * errors were tied to @ai-matrx/auth's NoActiveOrganizationError.
 */

vi.mock('@/config/env', () => ({
  ENV: { FRONTEND_URL: 'https://web.example.test' },
  STORAGE_KEYS: { ACTIVE_ORGANIZATION: 'activeOrganization' },
}));
vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: vi.fn(), getOAuthClient: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({ log: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/storage/chrome-local', () => ({
  getOne: vi.fn(),
  onChange: vi.fn(),
  setOne: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  getOrganizationBootstrapClient: vi.fn(),
  getSupabase: vi.fn(),
}));
vi.mock('@/state/notices', () => ({ pushNotice: vi.fn() }));

describe('the extension organization refusals', () => {
  it('OrganizationNoMembershipsError keeps its words, code, remedy and identity', async () => {
    const mod = await import('./active-org');
    const err = new mod.OrganizationNoMembershipsError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(mod.OrganizationNoMembershipsError);
    expect(mod.isOrganizationNoMembershipsError(err)).toBe(true);
    expect(mod.isOrganizationNotSelectedError(err)).toBe(false);
    expect(err.message).toBe('You do not belong to any organization yet.');
    expect(err.name).toBe('OrganizationNoMembershipsError');
    expect(err.code).toBe('organization_no_memberships');
    expect(err.remedy).toBe(
      'You do not belong to any organization yet. Create or join one at https://web.example.test/organizations, then try again.',
    );
    expect(new mod.OrganizationNoMembershipsError('custom').message).toBe('custom');
  });

  it('OrganizationNotSelectedError keeps its words, code, remedy and identity', async () => {
    const mod = await import('./active-org');
    const err = new mod.OrganizationNotSelectedError();
    expect(err).toBeInstanceOf(Error);
    expect(mod.isOrganizationNotSelectedError(err)).toBe(true);
    expect(mod.isOrganizationNoMembershipsError(err)).toBe(false);
    expect(err.message).toBe('No organization is selected for this browser.');
    expect(err.name).toBe('OrganizationNotSelectedError');
    expect(err.code).toBe('organization_not_selected');
    expect(err.remedy).toBe(
      'Open the AI Matrx panel and choose your organization in Settings, then try again.',
    );
    expect(new mod.OrganizationNotSelectedError('custom').message).toBe('custom');
  });

  it('the guards refuse plain errors', async () => {
    const mod = await import('./active-org');
    expect(mod.isOrganizationNoMembershipsError(new Error('x'))).toBe(false);
    expect(mod.isOrganizationNotSelectedError(new Error('x'))).toBe(false);
  });
});
