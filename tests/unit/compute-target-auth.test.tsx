import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, getActiveOrganizationId } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  getActiveOrganizationId: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiGet,
  apiPost: vi.fn(),
}));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId }));

import { useComputeTargets } from '@/lib/compute/use-compute-targets';
import { useAuthStore } from '@/state/auth';

describe('compute target authentication boundary', () => {
  beforeEach(() => {
    apiGet.mockReset();
    getActiveOrganizationId.mockReset().mockResolvedValue('org-1');
    useAuthStore.setState({ user: null, status: 'signed-out', error: null, isAdmin: false });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, status: 'unknown', error: null, isAdmin: false });
  });

  it('stays network-silent for guests, including manual refetch, then loads after sign-in', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: { targets: [], sandbox_count: 0, max_sandboxes: 0 },
    });
    const { result } = renderHook(() => useComputeTargets(true));

    await act(async () => {
      await result.current.refetch();
    });
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });

    act(() => {
      useAuthStore.setState({ user: { id: 'user-1' } as never, status: 'signed-in' });
    });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
  });

  it('stays network-silent when signed in before an organization is available', async () => {
    getActiveOrganizationId.mockResolvedValueOnce(null);
    useAuthStore.setState({
      user: { id: 'user-without-org' } as never,
      status: 'signed-in',
    });
    const { result } = renderHook(() => useComputeTargets(true));

    await act(async () => {
      await result.current.refetch();
    });

    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });
});
