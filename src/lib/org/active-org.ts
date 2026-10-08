/**
 * The organization this install acts in — the ONE place that answers "which
 * organization is this request for?".
 *
 * ## Why this exists
 *
 * The server admits an authenticated request ONLY when it carries a verified
 * organization, so the organization is a per-request fact the client must
 * carry — exactly like the bearer token. It travels in `X-Organization-Id`.
 *
 * ## THE LOAD LADDER (Arman, 2026-10-07; STATE rules 12-14)
 *
 * The active organization is set ONCE, when this window loads, and is never
 * none for a signed-in person with at least one membership. In order, each
 * kept only if it is still a current membership:
 *
 *   1. This device's own last choice (`STORAGE_KEYS.ACTIVE_ORGANIZATION`).
 *   2. The account's last active organization (follows the person across
 *      devices).
 *   3. The account's start-up organization setting.
 *   4. The person's first organization — the oldest active membership.
 *
 * This module is the ONLY reader of the two account columns
 * (`readAccountOrganizationChoice`). A ladder result is never written back as
 * the device choice: only a deliberate switch writes the device choice AND
 * calls `users.set_last_active_organization`. Neither column is ever read to
 * decide where a request acts beyond this load-time choice (rule 14).
 *
 * Zero memberships is the one honest "none": nothing can be picked, so
 * requests refuse with {@link OrganizationNoMembershipsError}. There is no
 * hold, no picker, and no question — the extension is a window that shows the
 * organization, so it opens on one.
 */

import { ENV, STORAGE_KEYS } from '@/config/env';
import { getCurrentUser } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { getOne, onChange, setOne } from '@/lib/storage/chrome-local';
import { getSupabase } from '@/lib/supabase/client';
import { iamDb, usersDb } from '@/lib/supabase/schemas';
import { pushNotice } from '@/state/notices';
import type { ArchiveFilterValue } from '@ai-matrx/design-system';

export interface MemberOrganization {
  id: string;
  name: string;
  archivedAt?: string | null;
  /** When the membership began — orders "first organization". */
  joinedAt?: string | null;
}

/**
 * The organization settled for this execution context. `viaLadder` marks an
 * answer from rungs 2-4 — held in memory only, never a device choice.
 */
let validatedSelection: { userId: string; organizationId: string; viaLadder?: true } | null = null;
let resolutionInFlight: { userId: string; promise: Promise<MemberOrganization | null> } | null =
  null;
let observingSelection = false;
let selectionGeneration = 0;

function observeSelectionChanges(): void {
  if (observingSelection) return;
  onChange<StoredActiveOrganization | null>(STORAGE_KEYS.ACTIVE_ORGANIZATION, () => {
    selectionGeneration += 1;
    validatedSelection = null;
  });
  observingSelection = true;
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
  /**
   * Plain-language remedy. Reached only when the ladder could not settle on
   * an organization although the person has memberships (a membership read
   * that raced a change) — switching in Settings settles it.
   */
  readonly remedy =
    'Open the AI Matrx panel and choose your organization in Settings, then try again.';

  constructor(message = 'No organization is selected for this browser.') {
    super(message);
    this.name = 'OrganizationNotSelectedError';
  }
}

/** True when `err` is the no-organization-selected failure. */
export function isOrganizationNotSelectedError(err: unknown): err is OrganizationNotSelectedError {
  return err instanceof OrganizationNotSelectedError;
}

/**
 * Thrown when the signed-in user belongs to NO organization at all — the one
 * honest "none". Distinct from {@link OrganizationNotSelectedError} (the ladder
 * could not settle although memberships exist): this one names the actual
 * remedy — create or join an organization — with the link the app already has.
 */
export class OrganizationNoMembershipsError extends Error {
  readonly code = 'organization_no_memberships';
  readonly remedy =
    `You do not belong to any organization yet. Create or join one at ${ENV.FRONTEND_URL}/organizations, then try again.`;

  constructor(message = 'You do not belong to any organization yet.') {
    super(message);
    this.name = 'OrganizationNoMembershipsError';
  }
}

/** True when `err` is the no-memberships-at-all failure. */
export function isOrganizationNoMembershipsError(
  err: unknown,
): err is OrganizationNoMembershipsError {
  return err instanceof OrganizationNoMembershipsError;
}

interface MembershipRow {
  container_id?: unknown;
  containerId?: unknown;
  status?: unknown;
  created_at?: unknown;
}

/**
 * Every organization the signed-in user is an active member of, via the
 * canonical `mbr_for_user` RPC (the platform's own membership read — the
 * extension never re-derives membership from a junction table). RPCs are not
 * schema-scoped; they stay on the plain client.
 */
export async function listMemberOrganizations(
  archiveFilter: ArchiveFilterValue = 'active',
): Promise<MemberOrganization[]> {
  const { data, error } = await getSupabase().rpc('mbr_for_user', {
    p_container_type: 'organization',
  });
  if (error) {
    log.error('auth', 'listMemberOrganizations: membership read failed', error);
    throw new Error(`Could not read your organizations: ${error.message}`);
  }
  const rows: MembershipRow[] = Array.isArray(data) ? (data as MembershipRow[]) : [];
  // Oldest membership first: "first organization" is the head of this list.
  const joinedAtById = new Map<string, string | null>();
  for (const r of rows) {
    if (r.status !== undefined && r.status !== 'active') continue;
    const id = typeof r.container_id === 'string' ? r.container_id : r.containerId;
    if (typeof id !== 'string' || id.length === 0) continue;
    const joined = typeof r.created_at === 'string' ? r.created_at : null;
    const prior = joinedAtById.get(id);
    if (prior === undefined || (joined && (!prior || joined < prior))) joinedAtById.set(id, joined);
  }
  const ids = [...joinedAtById.keys()];
  if (ids.length === 0) return [];

  let query = iamDb().from('organizations').select('id,name,archived_at').in('id', ids);
  if (archiveFilter === 'active') query = query.is('archived_at', null);
  if (archiveFilter === 'archived') query = query.not('archived_at', 'is', null);
  const { data: orgRows, error: orgError } = await query;
  if (orgError) {
    log.error('auth', 'listMemberOrganizations: organization read failed', orgError);
    throw new Error(`Could not read your organizations: ${orgError.message}`);
  }
  return (orgRows ?? [])
    .map((row) => {
      const id = String((row as { id: unknown }).id);
      return {
        id,
        name: String((row as { name?: unknown }).name ?? 'Untitled organization'),
        archivedAt: (row as { archived_at?: string | null }).archived_at ?? null,
        joinedAt: joinedAtById.get(id) ?? null,
      };
    })
    .sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? ''));
}

/**
 * THE ONLY READER of the account's two organization columns. Used by the load
 * ladder and nothing else (STATE rules 12 and 14). A failed read throws — a
 * guessed first organization would hide the person's real last choice.
 */
async function readAccountOrganizationChoice(
  userId: string,
): Promise<{ lastActive: string | null; startup: string | null }> {
  const { data, error } = await usersDb()
    .from('user_preferences')
    .select('last_active_organization_id,startup_organization_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    log.error('auth', 'organization ladder: account read failed', error);
    throw new Error(`Could not read your saved organization: ${error.message}`);
  }
  const row = (data ?? {}) as {
    last_active_organization_id?: unknown;
    startup_organization_id?: unknown;
  };
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    lastActive: pick(row.last_active_organization_id),
    startup: pick(row.startup_organization_id),
  };
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
async function validateActiveOrganization(userId: string): Promise<MemberOrganization | null> {
  validatedSelection = null;
  let generation = selectionGeneration;
  const organizations = await listMemberOrganizations('active');
  const byId = new Map(organizations.map((o) => [o.id, o]));

  const stored = await readStoredSelection();
  const currentUser = await getCurrentUser();
  if (selectionGeneration !== generation || currentUser?.id !== userId) return null;
  if (stored) {
    const match = byId.get(stored.id);
    if (match) {
      validatedSelection = { userId, organizationId: match.id };
      return match;
    }
    // Selection survived losing the membership — drop it rather than send an
    // organization the server will refuse.
    log.warn('auth', 'active organization is no longer a membership — clearing selection', {
      organization_id: stored.id,
    });
    await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
    // Our own clear bumped the generation through the storage observer.
    generation = selectionGeneration;
  }

  // Rungs 2-4: the account's last active organization, its start-up
  // organization, then the first organization. Each only if still a current
  // membership. The result is NOT written back as the device choice — only a
  // deliberate switch does that.
  if (organizations.length === 0) return null;
  const account = await readAccountOrganizationChoice(userId);
  if (selectionGeneration !== generation) return null;
  const chosen =
    (account.lastActive ? byId.get(account.lastActive) : undefined) ??
    (account.startup ? byId.get(account.startup) : undefined) ??
    organizations[0];
  if (!chosen) return null;
  validatedSelection = { userId, organizationId: chosen.id, viaLadder: true };
  return chosen;
}

function resolveForUser(userId: string): Promise<MemberOrganization | null> {
  if (resolutionInFlight?.userId === userId) return resolutionInFlight.promise;
  const promise = validateActiveOrganization(userId).finally(() => {
    if (resolutionInFlight?.promise === promise) resolutionInFlight = null;
  });
  resolutionInFlight = { userId, promise };
  return promise;
}

export async function resolveActiveOrganization(): Promise<MemberOrganization | null> {
  observeSelectionChanges();
  const user = await getCurrentUser();
  if (!user?.id) {
    validatedSelection = null;
    return null;
  }
  return resolveForUser(user.id);
}

async function persistSelection(org: MemberOrganization): Promise<void> {
  validatedSelection = null;
  await setOne<StoredActiveOrganization>(STORAGE_KEYS.ACTIVE_ORGANIZATION, {
    id: org.id,
    name: org.name,
  });
}

/**
 * The active organization id, or null when the user must choose. Validate a
 * stored choice once per signed-in identity in this execution context;
 * concurrent first requests share the validation. Warm requests avoid DB
 * reads. A remote archive during this context is still enforced by the server.
 */
export async function getActiveOrganizationId(): Promise<string | null> {
  observeSelectionChanges();
  const user = await getCurrentUser();
  if (!user?.id) {
    validatedSelection = null;
    return null;
  }
  const stored = await readStoredSelection();
  if (validatedSelection?.userId === user.id) {
    // A device choice made after the ladder ran wins (and invalidates the
    // cache through the storage observer); otherwise the ladder's answer
    // holds for the life of this window — set once at load.
    if (stored && validatedSelection.organizationId === stored.id) return stored.id;
    if (!stored && validatedSelection.viaLadder) return validatedSelection.organizationId;
  }
  const resolved = await resolveForUser(user.id);
  return resolved?.id ?? null;
}

/**
 * THE request boundary: the active organization id.
 *
 * Never a hold and never a question. A signed-in person with a membership
 * always has one (the load ladder); the only "none" is zero memberships, which
 * refuses with a typed error carrying its remedy.
 */
export async function requireActiveOrganizationId(): Promise<string> {
  const resolved = await getActiveOrganizationId();
  if (resolved) return resolved;
  const organizations = await listMemberOrganizations('active');
  if (organizations.length === 0) {
    log.error('auth', 'request refused — user has no organization memberships');
    throw new OrganizationNoMembershipsError();
  }
  log.error('auth', 'request refused — the organization ladder settled on none');
  throw new OrganizationNotSelectedError();
}

/**
 * Save the person's switch to their account so the next load, on any device,
 * opens in it. The write door is `users.set_last_active_organization`; it
 * refuses a non-membership. The device choice is already stored, so a failed
 * account write raises a notice and never undoes the switch here.
 */
async function saveLastActiveOrganization(organizationId: string): Promise<void> {
  const { error } = await getSupabase()
    .schema('users')
    .rpc('set_last_active_organization', { p_organization_id: organizationId });
  if (error) {
    log.error('auth', 'could not save the last active organization to the account', {
      organization_id: organizationId,
      message: error.message,
    });
    // Visible, not silent: the switch stands here, the person is told.
    pushNotice({
      tone: 'warning',
      title: 'Organization not saved to your account',
      message:
        "You switched organization here, but it could not be saved to your account, so your other devices won't follow it. Switch again to retry.",
      detail: error.message,
    });
  }
}

/**
 * Make an ALREADY-VERIFIED membership the active organization.
 *
 * The narrow door for callers that have just read `listMemberOrganizations()`
 * themselves and hold the matching row (the frontend-bridge pick-up, the
 * "switch to the workspace that has the waiting pages" button). It exists so
 * those call sites never write `STORAGE_KEYS.ACTIVE_ORGANIZATION` by hand:
 * this module stays the ONE resolver, and the storage key has exactly one
 * writer.
 *
 * It does NOT re-verify membership — the caller must pass a row that came out
 * of `listMemberOrganizations()`. When you only have an id, use
 * `setActiveOrganization()`, which verifies first.
 */
export async function selectActiveOrganization(org: MemberOrganization): Promise<void> {
  if (org.archivedAt) throw new Error('Restore this organization before working in it.');
  await persistSelection(org);
  await saveLastActiveOrganization(org.id);
  log.info('auth', 'active organization set', { organization_id: org.id, name: org.name });
}

/**
 * Record an explicit user choice. Verified against live membership first —
 * this extension never stores an organization the user cannot actually act
 * in.
 */
export async function setActiveOrganization(organizationId: string): Promise<MemberOrganization> {
  const organizations = await listMemberOrganizations('active');
  const match = organizations.find((o) => o.id === organizationId);
  if (!match) {
    throw new Error('You are not a member of that organization.');
  }
  await selectActiveOrganization(match);
  return match;
}

/**
 * Tell me when this install changes workspace.
 *
 * ## The defect this closes
 *
 * A person pressed "Switch to {workspace}" in the Capture panel. The stored
 * selection changed instantly and correctly — and the screen sat there for
 * eight seconds, until an unrelated poll happened to come round. A control
 * that has already worked and shows nothing is worse than one that is absent:
 * it teaches the person the button is broken, and the honest fix is not a
 * faster poll, it is the screen hearing about the change (law 4).
 *
 * ## Why it lives HERE and not in that view
 *
 * Every org-scoped surface has the same problem the moment somebody switches
 * workspace — the capture queue, the vault's admission, anything that filters
 * by organization. So the answer belongs to the ONE resolver that owns the
 * selection, not to the screen that noticed first (law 5). A surface that
 * reads `getActiveOrganizationId()` subscribes here and re-reads; it never
 * watches `chrome.storage` for this key itself.
 *
 * Fires in EVERY context (panel, service worker, options) because
 * `chrome.storage.onChanged` is global — which is the point: the switch may be
 * made by the frontend bridge in the service worker while the panel is open.
 *
 * @returns an unsubscribe function.
 */
export function onActiveOrganizationChange(
  cb: (organizationId: string | null) => void,
): () => void {
  return onChange<StoredActiveOrganization | null>(STORAGE_KEYS.ACTIVE_ORGANIZATION, (next) => {
    cb(next && typeof next.id === 'string' ? next.id : null);
  });
}

/** Forget this install's selection (sign-out). */
export async function clearActiveOrganization(): Promise<void> {
  validatedSelection = null;
  await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
}
