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
 * ## A SAVED "DEFAULT ORGANIZATION" NEVER BUILDS A REQUEST (Arman, 2026-09-19)
 *
 * A user-level saved preference is at most a per-client DISPLAY preference.
 * Nothing that builds a request may read it, and nothing may fall back to the
 * personal organization. Only a choice the person made ON THIS DEVICE counts.
 * The reason, in his words: *"one missed org check that should have just
 * failed turns into 50 in a month and 5,000 in a year, and suddenly we don't
 * have orgs anymore, we have a user and a default org, which means we just
 * have user now."*
 *
 * ## Resolution order — three rungs, and the third is a QUESTION
 *
 *   1. This device's stored selection — IF it is still a live membership.
 *   2. Exactly ONE membership → that organization (there is nothing to
 *      choose, so choosing it invents nothing).
 *   3. Otherwise `null`, ON PURPOSE. `null` is not a failure and never
 *      becomes one: the request is HELD, `holdForActiveOrganizationId()`
 *      raises the picker, the person sets an organization, and the SAME
 *      request proceeds with it. Never "first", "personal", "most recent",
 *      "system", or a saved preference: a guessed organization writes a
 *      person's work into the wrong tenant, which is the defect class this
 *      whole contract exists to end
 *      (common-docs/projects/no-db-assigned-org).
 */

import { STORAGE_KEYS } from '@/config/env';
import { getCurrentUser } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getOne, onChange, setOne } from '@/lib/storage/chrome-local';
import { getSupabase } from '@/lib/supabase/client';
import { iamDb } from '@/lib/supabase/schemas';

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
  /**
   * Plain-language remedy. Reached only when the panel ASKED and nobody
   * answered in time — so it points at the question that is still waiting,
   * not at a setting the person has to go hunting for.
   */
  readonly remedy = 'Open the AI Matrx panel and choose your organization, then try again.';

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

/**
 * How long a held request waits for the person to set an organization before
 * it gives up with a remediable failure. A knob, not a constant at a call
 * site (`common-docs/policies/limits-are-knobs-agents-set-them.md`): a caller
 * with a tighter budget passes its own, and nothing hardcodes a number in the
 * middle of a request path.
 */
export const ORGANIZATION_PICK_TIMEOUT_MS = 120_000;

export interface HoldForOrganizationOptions {
  /** Override the wait. Defaults to `ORGANIZATION_PICK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** True when a picker request is outstanding on this device. */
export async function isOrganizationPickerPending(): Promise<boolean> {
  return (await getOne<boolean>(STORAGE_KEYS.ORGANIZATION_PICKER_PENDING)) === true;
}

/**
 * Ask the person to set an organization — from ANY context.
 *
 * Two halves, and both are load-bearing:
 *
 *   • The DURABLE FLAG in `chrome.storage.local`. MV3 kills the service
 *     worker and the side panel is usually closed; a message sent to nobody
 *     is a question nobody was asked. The flag is what makes the panel ask
 *     the next time it opens.
 *   • The BROADCAST, so a panel that IS open reacts now instead of on its
 *     next mount.
 *
 * "No receiver" is the normal case, not a failure — `broadcast()` already
 * swallows it. The flag write is never swallowed: losing it loses the
 * question.
 */
export async function requestOrganizationPicker(): Promise<void> {
  await setOne(STORAGE_KEYS.ORGANIZATION_PICKER_PENDING, true);
  broadcast(CHANNELS.ORGANIZATION_PICKER_REQUESTED, {});
}

/** The question has been answered (or withdrawn) — stop asking. */
export async function clearOrganizationPickerRequest(): Promise<void> {
  await setOne(STORAGE_KEYS.ORGANIZATION_PICKER_PENDING, null);
}

/** Tell me when something, anywhere, asks for the picker. */
export function onOrganizationPickerRequest(cb: () => void): () => void {
  return on<unknown, void>(CHANNELS.ORGANIZATION_PICKER_REQUESTED, () => cb());
}

/**
 * Wait for a valid selection to land in storage, or give up.
 *
 * Re-reads ONCE after subscribing: the selection can arrive between the
 * caller's resolve and this subscription, and a listener that missed the
 * write would wait out the whole timeout for an answer already given.
 */
function awaitSelection(timeoutMs: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const unsubscribe = onActiveOrganizationChange((organizationId) => {
      if (organizationId) finish(organizationId);
    });
    void getActiveOrganizationId().then((id) => {
      if (id) finish(id);
    });
  });
}

/**
 * THE request boundary: an organization id, or the picker and then an
 * organization id.
 *
 * Never "no default organization". When this device has no selection the
 * request does not fail — it is HELD: the picker is raised in whatever
 * context can show it, and the moment the person sets an organization this
 * resolves and the caller's request proceeds with the id they chose. Only a
 * person who never answers produces a failure, and that failure carries a
 * remedy.
 */
export async function holdForActiveOrganizationId(
  opts?: HoldForOrganizationOptions,
): Promise<string> {
  const resolved = await getActiveOrganizationId();
  if (resolved) return resolved;

  await requestOrganizationPicker();
  log.info('auth', 'request held — waiting for the person to set an organization');
  const chosen = await awaitSelection(opts?.timeoutMs ?? ORGANIZATION_PICK_TIMEOUT_MS);
  if (!chosen) {
    log.error('auth', 'held request gave up — no organization was set in time');
    throw new OrganizationNotSelectedError();
  }
  await clearOrganizationPickerRequest();
  return chosen;
}

/**
 * The active organization id — asking for one if this device has not been
 * told yet.
 *
 * This IS the hold. It used to throw the moment nothing was selected, which
 * put every org-scoped sink one step from "it just failed"; now the sinks
 * that already call it get the picker BEFORE the request and resume after
 * the person answers.
 */
export async function requireActiveOrganizationId(
  opts?: HoldForOrganizationOptions,
): Promise<string> {
  return holdForActiveOrganizationId(opts);
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
  await persistSelection(org);
  // Any explicit choice ANSWERS an outstanding picker request, wherever it
  // was made from — the panel's dialog, Settings, the frontend bridge. One
  // writer for the flag, exactly as for the selection itself.
  await clearOrganizationPickerRequest();
  log.info('auth', 'active organization set', { organization_id: org.id, name: org.name });
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
  await setOne(STORAGE_KEYS.ACTIVE_ORGANIZATION, null);
}
