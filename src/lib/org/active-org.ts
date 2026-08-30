/**
 * The organization this install acts in — the ONE place that answers "which
 * organization is this request for?".
 *
 * ## Why this exists
 *
 * Identity has always been undeniable on this platform because the server
 * resolves it at the very top (matrx_connect `AuthMiddleware`) and nothing
 * routes without it. Organization was not: it was resolved only if a caller
 * happened to send it, and every route invented its own late check. The
 * server now admits an authenticated request ONLY when it carries a verified
 * organization, so the organization is a per-request fact the client must
 * carry — exactly like the bearer token.
 *
 * A token claim would be wrong: a login token outlives an organization
 * switch, so a claim pins a session to one organization and lies the moment
 * the user changes it. The organization travels per request, in
 * `X-Organization-Id`, resolved from an explicit user choice.
 *
 * ## Resolution order (mirrors the frontend's canonical resolver —
 * matrx-frontend `lib/organizations/resolveActiveOrgContext.ts`; consume the
 * platform's answer, never invent a second one)
 *
 *   1. This install's stored selection — IF the user is still a member.
 *   2. The user's durable default-organization preference
 *      (`users.user_preferences → organization.defaultOrganizationId`) — IF
 *      they are still a member.
 *   3. Exactly ONE membership → that organization (there is nothing to
 *      choose, so choosing it invents nothing).
 *   4. Otherwise `null`, ON PURPOSE — the signal the UI uses to make the user
 *      pick. Never "first", "personal", "most recent", or "system": a guessed
 *      organization writes a user's work into the wrong tenant, which is the
 *      defect class this whole contract exists to end
 *      (common-docs/projects/no-db-assigned-org).
 */

import { getCurrentUser } from '@/lib/auth/flow';
import { getSupabase } from '@/lib/supabase/client';
import { iamDb, usersDb } from '@/lib/supabase/schemas';
import { STORAGE_KEYS } from '@/config/env';
import { getOne, setOne } from '@/lib/storage/chrome-local';
import { log } from '@/lib/debug/log';

export interface MemberOrganization {
  id: string;
  name: string;
  isPersonal: boolean;
}

interface StoredActiveOrganization {
  id: string;
  name: string;
}

/**
 * Thrown when an organization-scoped operation runs with no organization
 * selected. Carries a remedy the UI shows verbatim — a screen never says
 * "something went wrong" when the fix is one click (law 4: nothing fails
 * silently).
 */
export class OrganizationNotSelectedError extends Error {
  readonly code = 'organization_not_selected';
  /** Plain-language remedy for the user. */
  readonly remedy = 'Choose your organization in Settings, then try again.';

  constructor(message = 'No organization is selected for this browser.') {
    super(message);
    this.name = 'OrganizationNotSelectedError';
  }
}

/** True when `err` is the no-organization-selected failure. */
export function isOrganizationNotSelectedError(err: unknown): err is OrganizationNotSelectedError {
  return err instanceof OrganizationNotSelectedError;
}

interface MembershipRow {
  container_id?: unknown;
  containerId?: unknown;
}

/**
 * Every organization the signed-in user is an active member of, via the
 * canonical `mbr_for_user` RPC (the platform's own membership read — the
 * extension never re-derives membership from a junction table). RPCs are not
 * schema-scoped; they stay on the plain client.
 */
export async function listMemberOrganizations(): Promise<MemberOrganization[]> {
  const { data, error } = await getSupabase().rpc('mbr_for_user', {
    p_container_type: 'organization',
  });
  if (error) {
    log.error('auth', 'listMemberOrganizations: membership read failed', error);
    throw new Error(`Could not read your organizations: ${error.message}`);
  }
  const rows: MembershipRow[] = Array.isArray(data) ? (data as MembershipRow[]) : [];
  const ids = [
    ...new Set(
      rows
        .map((r) => (typeof r.container_id === 'string' ? r.container_id : r.containerId))
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (ids.length === 0) return [];

  const { data: orgRows, error: orgError } = await iamDb()
    .from('organizations')
    .select('id,name,is_personal')
    .in('id', ids);
  if (orgError) {
    log.error('auth', 'listMemberOrganizations: organization read failed', orgError);
    throw new Error(`Could not read your organizations: ${orgError.message}`);
  }
  return (orgRows ?? []).map((row) => ({
    id: String((row as { id: unknown }).id),
    name: String((row as { name?: unknown }).name ?? 'Untitled organization'),
    isPersonal: (row as { is_personal?: unknown }).is_personal === true,
  }));
}

/**
 * The user's durable, cross-device default organization. Read straight from
 * `users.user_preferences` (the same row the web app writes) so this install
 * agrees with every other surface. Never throws — a preference we cannot read
 * simply does not participate in resolution.
 */
async function readDefaultOrganizationId(userId: string): Promise<string | null> {
  try {
    const { data, error } = await usersDb()
      .from('user_preferences')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const prefs = (data as { preferences?: unknown }).preferences as
      | { organization?: { defaultOrganizationId?: string | null } }
      | null
      | undefined;
    return prefs?.organization?.defaultOrganizationId ?? null;
  } catch {
    return null;
  }
}

async function readStoredSelection(): Promise<StoredActiveOrganization | null> {
  const stored = await getOne<StoredActiveOrganization>(STORAGE_KEYS.ACTIVE_ORGANIZATION);
  return stored && typeof stored.id === 'string' && stored.id ? stored : null;
}

/**
 * Resolve the organization for this install, verifying it against live
 * membership. Returns null when the user must pick — never a guess.
 *
 * Membership verification is not paranoia: a stored selection outlives being
 * removed from an organization, and sending a stale one produces a server
 * rejection the user cannot interpret.
 */
export async function resolveActiveOrganization(): Promise<MemberOrganization | null> {
  const user = await getCurrentUser();
  if (!user?.id) return null;

  const organizations = await listMemberOrganizations();
  if (organizations.length === 0) return null;
  const byId = new Map(organizations.map((o) => [o.id, o]));

  const stored = await readStoredSelection();
  if (stored) {
    const match = byId.get(stored.id);
    if (match) return match;
    // Selection survived losing the membership — drop it rather than send an
    // organization the server will refuse.
    log.warn('auth', 'active organization is no longer a membership — clearing selection', {
      organization_id: stored.id,
    });
    await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
  }

  const preferred = await readDefaultOrganizationId(user.id);
  if (preferred) {
    const match = byId.get(preferred);
    if (match) {
      await persistSelection(match);
      return match;
    }
  }

  if (organizations.length === 1) {
    const only = organizations[0] as MemberOrganization;
    await persistSelection(only);
    return only;
  }

  return null;
}

async function persistSelection(org: MemberOrganization): Promise<void> {
  await setOne<StoredActiveOrganization>(STORAGE_KEYS.ACTIVE_ORGANIZATION, {
    id: org.id,
    name: org.name,
  });
}

/**
 * The active organization id, or null when the user must choose. Cheap: the
 * stored selection short-circuits, so the membership round-trip happens only
 * when there is nothing chosen yet or the choice needs re-verification.
 */
export async function getActiveOrganizationId(): Promise<string | null> {
  const stored = await readStoredSelection();
  if (stored) return stored.id;
  const resolved = await resolveActiveOrganization();
  return resolved?.id ?? null;
}

/** The active organization id, or a loud, remediable failure. */
export async function requireActiveOrganizationId(): Promise<string> {
  const id = await getActiveOrganizationId();
  if (!id) throw new OrganizationNotSelectedError();
  return id;
}

/**
 * Record an explicit user choice. Verified against live membership first —
 * this extension never stores an organization the user cannot actually act
 * in.
 */
export async function setActiveOrganization(organizationId: string): Promise<MemberOrganization> {
  const organizations = await listMemberOrganizations();
  const match = organizations.find((o) => o.id === organizationId);
  if (!match) {
    throw new Error('You are not a member of that organization.');
  }
  await persistSelection(match);
  log.info('auth', 'active organization set', { organization_id: match.id, name: match.name });
  return match;
}

/** Forget this install's selection (sign-out). */
export async function clearActiveOrganization(): Promise<void> {
  await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
}
