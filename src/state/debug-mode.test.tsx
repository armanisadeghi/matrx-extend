import { useAuthStore } from '@/state/auth';
import { showAdminNow, useDebugModeStore, useShowAdmin } from '@/state/debug-mode';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const admin = { id: 'u1', email: 'jane@example.com' } as never;

describe('Debug mode is the one door to admin surfaces', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: admin, isAdmin: true, status: 'signed-in', error: null });
    useDebugModeStore.setState({ on: false });
  });

  it('an admin with Debug off is shown exactly what a normal user is', () => {
    const { result } = renderHook(() => useShowAdmin());
    expect(useAuthStore.getState().isAdmin).toBe(true);
    expect(result.current).toBe(false);
    expect(showAdminNow()).toBe(false);
  });

  it('turning Debug on shows admin surfaces; turning it off hides them again', () => {
    const { result } = renderHook(() => useShowAdmin());
    act(() => {
      useDebugModeStore.getState().toggle();
    });
    expect(result.current).toBe(true);
    expect(showAdminNow()).toBe(true);
    act(() => {
      useDebugModeStore.getState().toggle();
    });
    expect(result.current).toBe(false);
  });

  it('Debug on never makes a non-admin an admin', () => {
    useAuthStore.setState({ isAdmin: false });
    useDebugModeStore.setState({ on: true });
    const { result } = renderHook(() => useShowAdmin());
    expect(result.current).toBe(false);
    expect(showAdminNow()).toBe(false);
  });
});
