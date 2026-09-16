import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api/client', () => ({
  apiGet,
  apiPost: vi.fn(),
}));

import { useComputeTargets } from '@/lib/compute/use-compute-targets';
import { useAuthStore } from '@/state/auth';

describe('compute target authentication boundary', () => {
  beforeEach(() => {
    apiGet.mockReset();
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
      useAuthStore.setState({ status: 'signed-in' });
    });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
  });
});
