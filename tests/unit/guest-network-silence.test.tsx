import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchPatternsForDomain, getActiveOrganizationId } = vi.hoisted(() => ({
  fetchPatternsForDomain: vi.fn(),
  getActiveOrganizationId: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: 42, url: 'https://example.com/page' }),
}));
vi.mock('@/lib/supabase/queries', () => ({
  fetchPatternsForDomain,
  bumpPatternRun: vi.fn(),
}));
vi.mock('@/lib/data-pattern/run-pattern', () => ({
  isInteractiveOnlyKind: () => false,
  runPattern: vi.fn(),
}));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId }));

import { useAutoExtract } from '@/hooks/use-auto-extract';
import { ensureAuthenticatedCatalogLoaded } from '@/lib/agents/catalog';
import { useAuthStore } from '@/state/auth';

const signedInUser = { id: 'user-1' } as never;

describe('guest startup network silence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchPatternsForDomain.mockReset().mockResolvedValue([]);
    getActiveOrganizationId.mockReset().mockResolvedValue('org-1');
    useAuthStore.setState({ user: null, status: 'signed-out', error: null, isAdmin: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ user: null, status: 'unknown', error: null, isAdmin: false });
  });

  it('does not open the signed-in catalogue door for a guest', async () => {
    const ensureLoaded = vi.fn().mockResolvedValue(undefined);
    await ensureAuthenticatedCatalogLoaded({ ensureLoaded });
    expect(ensureLoaded).not.toHaveBeenCalled();

    useAuthStore.setState({ user: signedInUser, status: 'signed-in' });
    await ensureAuthenticatedCatalogLoaded({ ensureLoaded }, { force: true });
    expect(ensureLoaded).toHaveBeenCalledWith({ force: true });
  });

  it('does not open the catalogue door while a signed-in user must choose an organization', async () => {
    getActiveOrganizationId.mockResolvedValueOnce(null);
    useAuthStore.setState({ user: { id: 'user-without-org' } as never, status: 'signed-in' });
    const ensureLoaded = vi.fn().mockResolvedValue(undefined);

    await ensureAuthenticatedCatalogLoaded({ ensureLoaded });

    expect(ensureLoaded).not.toHaveBeenCalled();
  });

  it('does not query private saved patterns until authentication succeeds', async () => {
    renderHook(() => useAutoExtract());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchPatternsForDomain).not.toHaveBeenCalled();

    act(() => {
      useAuthStore.setState({ user: signedInUser, status: 'signed-in' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchPatternsForDomain).toHaveBeenCalledOnce();
    expect(fetchPatternsForDomain).toHaveBeenCalledWith('example.com');
  });
});
