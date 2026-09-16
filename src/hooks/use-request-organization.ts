import { STORAGE_KEYS } from '@/config/env';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { onChange } from '@/lib/storage/chrome-local';
import { useAuthStore } from '@/state/auth';
import { useEffect } from 'react';
import { create } from 'zustand';

type OrganizationReadiness = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

interface RequestOrganizationState {
  userId: string | null;
  organizationId: string | null;
  status: OrganizationReadiness;
}

const useRequestOrganizationStore = create<RequestOrganizationState>(() => ({
  userId: null,
  organizationId: null,
  status: 'idle',
}));

let inFlight: { userId: string; promise: Promise<string | null> } | null = null;

/** Resolve the request organization once for every mounted org-scoped surface. */
export async function ensureRequestOrganizationId(force = false): Promise<string | null> {
  const auth = useAuthStore.getState();
  const userId = auth.status === 'signed-in' ? auth.user?.id : null;
  if (!userId) {
    useRequestOrganizationStore.setState({ userId: null, organizationId: null, status: 'idle' });
    return null;
  }

  const current = useRequestOrganizationStore.getState();
  if (!force && current.userId === userId && current.status === 'ready') {
    return current.organizationId;
  }
  if (!force && current.userId === userId && current.status === 'missing') return null;
  if (!force && inFlight?.userId === userId) return inFlight.promise;

  useRequestOrganizationStore.setState({ userId, organizationId: null, status: 'loading' });
  const promise = getActiveOrganizationId()
    .then((organizationId) => {
      if (useAuthStore.getState().user?.id !== userId) return null;
      useRequestOrganizationStore.setState({
        userId,
        organizationId,
        status: organizationId ? 'ready' : 'missing',
      });
      return organizationId;
    })
    .catch(() => {
      if (useAuthStore.getState().user?.id === userId) {
        useRequestOrganizationStore.setState({ userId, organizationId: null, status: 'error' });
      }
      return null;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { userId, promise };
  return promise;
}

/**
 * Reactive request boundary. `null` means hydration is pending or the user
 * must choose an organization; callers stay network-silent in both states.
 */
export function useRequestOrganizationId(): string | null {
  const userId = useAuthStore((state) =>
    state.status === 'signed-in' ? (state.user?.id ?? null) : null,
  );
  const organizationId = useRequestOrganizationStore((state) => state.organizationId);

  useEffect(() => {
    void ensureRequestOrganizationId();
  }, [userId]);

  useEffect(
    () =>
      onChange(STORAGE_KEYS.ACTIVE_ORGANIZATION, () => {
        void ensureRequestOrganizationId(true);
      }),
    [],
  );

  return userId ? organizationId : null;
}
