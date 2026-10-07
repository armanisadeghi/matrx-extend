/**
 * React access to the organization this install acts in.
 *
 * The resolution rules (and the refusal to guess) live in
 * `src/lib/org/active-org.ts`; this hook only surfaces them, so the UI and the
 * request kernel can never disagree about which organization is active.
 */

import { STORAGE_KEYS } from '@/config/env';
import {
  type MemberOrganization,
  listMemberOrganizations,
  resolveActiveOrganization,
  setActiveOrganization,
} from '@/lib/org/active-org';
import { onChange } from '@/lib/storage/chrome-local';
import { useAuthStore } from '@/state/auth';
import { type ArchiveFilterValue, DEFAULT_ARCHIVE_FILTER } from '@ai-matrx/design-system';
import { useCallback, useEffect, useState } from 'react';

export interface UseActiveOrganizationResult {
  /** The organization every request carries (the load ladder's answer); null only for zero memberships or signed out. */
  active: MemberOrganization | null;
  /** Memberships requested by the visible archive filter; archived rows are view-only. */
  organizations: MemberOrganization[];
  loading: boolean;
  /** Non-null when the organizations could not be read at all. */
  error: string | null;
  /** True only when the user is signed in and belongs to no usable organization. */
  mustChoose: boolean;
  choose: (organizationId: string) => Promise<void>;
  reload: () => void;
}

export function useActiveOrganization(
  archiveFilter: ArchiveFilterValue = DEFAULT_ARCHIVE_FILTER,
): UseActiveOrganizationResult {
  const user = useAuthStore((s) => s.user);
  const [active, setActive] = useState<MemberOrganization | null>(null);
  const [organizations, setOrganizations] = useState<MemberOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setActive(null);
      setOrganizations([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const [resolved, all] = await Promise.all([
          resolveActiveOrganization(),
          listMemberOrganizations(archiveFilter),
        ]);
        if (cancelled) return;
        setActive(resolved);
        setOrganizations(all);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // A read failure is NOT "no organization" — saying so would send the
        // user hunting for a setting when the real problem is the network.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, nonce, archiveFilter]);

  // Another context (the service worker clearing a stale selection, a second
  // sidepanel) can change the active organization under us.
  useEffect(() => onChange(STORAGE_KEYS.ACTIVE_ORGANIZATION, () => reload()), [reload]);

  const choose = useCallback(async (organizationId: string) => {
    const chosen = await setActiveOrganization(organizationId);
    setActive(chosen);
  }, []);

  return {
    active,
    organizations,
    loading,
    error,
    mustChoose: !!user && !loading && !error && !active,
    choose,
    reload,
  };
}
