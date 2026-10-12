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
import { useActiveOrganizationView as useAuthActiveOrganizationView } from '@ai-matrx/auth/react';
import { type ArchiveFilterValue, DEFAULT_ARCHIVE_FILTER } from '@ai-matrx/design-system';

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

const subscribeToSelection = (reload: () => void): (() => void) =>
  onChange(STORAGE_KEYS.ACTIVE_ORGANIZATION, () => reload());

export function useActiveOrganization(
  archiveFilter: ArchiveFilterValue = DEFAULT_ARCHIVE_FILTER,
): UseActiveOrganizationResult {
  const user = useAuthStore((s) => s.user);
  // The state machine (load, error vs none, must-choose, choose, reload) is the package's; this
  // injects the extension's own reads so the UI and the request kernel resolve through ONE function.
  const view = useAuthActiveOrganizationView<MemberOrganization>({
    signedIn: !!user,
    resolve: resolveActiveOrganization,
    list: () => listMemberOrganizations(archiveFilter),
    choose: setActiveOrganization,
    deps: [user, archiveFilter],
    // Another context (the service worker clearing a stale selection, a second sidepanel) can
    // change the active organization under us.
    subscribe: subscribeToSelection,
  });
  return { ...view, organizations: [...view.organizations] };
}
