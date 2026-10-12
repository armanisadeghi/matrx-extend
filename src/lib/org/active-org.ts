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
import { getCurrentUser, getOAuthClient } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { getOne, onChange, setOne } from '@/lib/storage/chrome-local';
import { getOrganizationBootstrapClient, getSupabase } from '@/lib/supabase/client';
import { pushNotice } from '@/state/notices';
import {
  type ActiveOrganization,
  type HeldOrganizationStore,
  createActiveOrganization,
  readMemberships,
  writeLastActiveOrganization,
} from '@ai-matrx/auth/organizations';
import { withOAuthSession } from '@ai-matrx/auth';
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

/**
 * Every organization the signed-in user is an active member of, via the
 * canonical `mbr_for_user` RPC (the platform's own membership read — the
 * extension never re-derives membership from a junction table). RPCs are not
 * schema-scoped; they stay on the plain client.
 */
export async function listMemberOrganizations(
  archiveFilter: ArchiveFilterValue = 'active',
): Promise<MemberOrganization[]> {
  const user = await getCurrentUser();
  let memberships;
  try {
    memberships = await readMemberships(getOrganizationBootstrapClient(), user?.id ?? '', {
      archived: archiveFilter,
    });
  } catch (err) {
    log.error('auth', 'listMemberOrganizations: membership read failed', err);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read your organizations: ${message.replace(/^Your organizations could not be read: /, '')}`,
    );
  }
  // Oldest membership first: "first organization" is the head of this list.
  return memberships
    .map((m) => ({
      id: m.id,
      name: m.name,
      archivedAt: m.archivedAt ?? null,
      joinedAt: m.joinedAt || null,
    }))
    .sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? ''));
}

/**
 * The package's active-organization store, with the extension's two rules:
 *  - `holdResolved: false` — the ladder's own answer is NEVER written as the device choice (rule 14);
 *    only a deliberate switch writes `STORAGE_KEYS.ACTIVE_ORGANIZATION`;
 *  - the held choice lives in chrome.storage.local as `{ id, name }` (every context shares it).
 * The data client carries no GoTrue session (its bearer comes from the OAuth client), so the
 * package's session doors read the OAuth session through `withOAuthSession`.
 */
let activeStore: ActiveOrganization | null = null;
function getActiveStore(): ActiveOrganization | null {
  if (activeStore) return activeStore;
  const oauth = getOAuthClient();
  if (!oauth) return null;
  const held: HeldOrganizationStore = {
    async read() {
      return (await readStoredSelection())?.id ?? null;
    },
    async write(_userId, organizationId) {
      const name = activeStore?.snapshot().memberships.find((m) => m.id === organizationId)?.name ?? '';
      await setOne<StoredActiveOrganization>(STORAGE_KEYS.ACTIVE_ORGANIZATION, {
        id: organizationId,
        name,
      });
    },
    async clear() {
      await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
    },
  };
  activeStore = createActiveOrganization({
    client: withOAuthSession(getOrganizationBootstrapClient(), oauth),
    held,
    holdResolved: false,
    autoLoad: false,
  });
  return activeStore;
}

/** The package's wording for a failed read, in the extension's own. */
function readFailure(message: string): Error {
  return new Error(
    message
      .replace(/^Your organizations could not be read: /, 'Could not read your organizations: ')
      .replace(/^The account's organization read failed: /, 'Could not read your saved organization: '),
  );
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
  const store = getActiveStore();
  if (!store) return null;
  // The package's ladder: held (this device) → last active → start-up → first (oldest).
  const snap = await store.load();
  if (snap.status === 'error') {
    log.error('auth', 'organization ladder: read failed', snap.error);
    throw readFailure(snap.error ?? 'unknown error');
  }
  const stored = await readStoredSelection();
  const currentUser = await getCurrentUser();
  if (selectionGeneration !== generation || currentUser?.id !== userId) return null;
  if (stored && !snap.memberships.some((m) => m.id === stored.id)) {
    // Selection survived losing the membership — drop it rather than send an
    // organization the server will refuse.
    log.warn('auth', 'active organization is no longer a membership — clearing selection', {
      organization_id: stored.id,
    });
    await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
    // Our own clear bumped the generation through the storage observer.
    generation = selectionGeneration;
  }
  if (selectionGeneration !== generation || !snap.organization) return null;
  const chosen: MemberOrganization = {
    id: snap.organization.id,
    name: snap.organization.name,
    archivedAt: snap.organization.archivedAt ?? null,
    joinedAt: snap.organization.joinedAt || null,
  };
  // A ladder answer (not this device's own choice) is held in memory only.
  validatedSelection =
    snap.rung === 'held'
      ? { userId, organizationId: chosen.id }
      : { userId, organizationId: chosen.id, viaLadder: true };
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
 * Read only a previously validated selection; never starts database resolution.
 * The Supabase transport uses this for the three identity-scoped bootstrap reads
 * needed by the load ladder itself, so its first request cannot await itself.
 */
export async function getResolvedActiveOrganizationId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user?.id || validatedSelection?.userId !== user.id) return null;
  const stored = await readStoredSelection();
  if (stored?.id === validatedSelection.organizationId) return stored.id;
  return !stored && validatedSelection.viaLadder ? validatedSelection.organizationId : null;
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
  try {
    await writeLastActiveOrganization(getSupabase(), organizationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('auth', 'could not save the last active organization to the account', {
      organization_id: organizationId,
      message,
    });
    // Visible, not silent: the switch stands here, the person is told.
    pushNotice({
      tone: 'warning',
      title: 'Organization not saved to your account',
      message:
        "You switched organization here, but it could not be saved to your account, so your other devices won't follow it. Switch again to retry.",
      detail: message,
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
