/**
 * "The web app sent you here — this is the page it meant."
 *
 * ## Why this exists
 *
 * The web app's tray and this extension resolve their active organization
 * INDEPENDENTLY (the web app from its own session, the extension from
 * `src/lib/org/active-org.ts`). One person's waiting rows routinely sit in
 * several of their organizations at once, so "2 pages are waiting for your
 * browser" on the web could point at rows the extension was never looking at.
 * The web app now says which organization it means, over the frontend bridge
 * (`captureHandoff.pickUp`), and this module carries that pointer the short
 * distance from the service worker — which handles the RPC — to the side
 * panel, which may not even be open yet.
 *
 * ## Why it expires
 *
 * A pointer is a statement about THIS MOMENT ("open the panel on that page").
 * A pointer that survives in chrome.storage forever would keep dragging one
 * handoff to the top of the list days later, which is a screen telling a lie
 * about what just happened (law 4). Anything older than
 * `CAPTURE_PICKUP_MAX_AGE_MS` is treated as absent — and cleared when read.
 */

import { STORAGE_KEYS } from '@/config/env';
import { getOne, setOne } from '@/lib/storage/chrome-local';

/**
 * The runtime message the service worker fires so an ALREADY-OPEN side panel
 * reacts without waiting for a poll.
 *
 * Unlike `frontend:open-panel-hint` — which has no listener anywhere in this
 * repo and is therefore fire-and-forget into the void — this one IS listened
 * for: `src/features/capture-ladder/use-capture-pickup.ts`.
 */
export const CAPTURE_PICKUP_MESSAGE = 'capture:pick-up' as const;

/** How long a pointer means anything. Ten minutes. */
export const CAPTURE_PICKUP_MAX_AGE_MS = 10 * 60 * 1000;

/** What the web app pointed at. Both fields optional: "just open the list" is a valid ask. */
export interface CapturePickup {
  handoffId?: string;
  url?: string;
  /** When the web app asked, in epoch ms. */
  at: number;
}

interface StoredPickup {
  handoffId?: unknown;
  url?: unknown;
  at?: unknown;
}

/** True when this pointer still describes something that just happened. */
export function isPickupFresh(pickup: CapturePickup, now: number = Date.now()): boolean {
  return now - pickup.at <= CAPTURE_PICKUP_MAX_AGE_MS && now - pickup.at >= -60_000;
}

/** Record the pointer. Called by the frontend bridge, never by UI code. */
export async function writeCapturePickup(
  pointer: { handoffId?: string | undefined; url?: string | undefined },
  now: number = Date.now(),
): Promise<CapturePickup> {
  // `exactOptionalPropertyTypes` is on: a persisted object omits the key
  // rather than storing `undefined`.
  const value: CapturePickup = {
    ...(pointer.handoffId !== undefined && { handoffId: pointer.handoffId }),
    ...(pointer.url !== undefined && { url: pointer.url }),
    at: now,
  };
  await setOne<CapturePickup>(STORAGE_KEYS.CAPTURE_PICKUP, value);
  return value;
}

/**
 * The pointer, if there is a fresh one. A stale pointer is cleared on the way
 * out so the next read is honest and storage does not accumulate a lie.
 */
export async function readFreshCapturePickup(
  now: number = Date.now(),
): Promise<CapturePickup | null> {
  const raw = await getOne<StoredPickup>(STORAGE_KEYS.CAPTURE_PICKUP);
  if (!raw || typeof raw.at !== 'number') return null;
  const pickup: CapturePickup = {
    ...(typeof raw.handoffId === 'string' && raw.handoffId ? { handoffId: raw.handoffId } : {}),
    ...(typeof raw.url === 'string' && raw.url ? { url: raw.url } : {}),
    at: raw.at,
  };
  if (!isPickupFresh(pickup, now)) {
    await clearCapturePickup();
    return null;
  }
  return pickup;
}

/** Forget the pointer (it has been acted on, or it has expired). */
export async function clearCapturePickup(): Promise<void> {
  await setOne(STORAGE_KEYS.CAPTURE_PICKUP, null);
}

/**
 * Put the pointed-at row first, leaving everything else in its existing order.
 * Pure so the ordering rule is testable without a panel.
 *
 * Returns `matched: false` when the pointer names a row that is not in the
 * list — the caller SAYS so in one line rather than silently ignoring it
 * (law 4). A page can be missing because it was already captured, because it
 * lives in a different workspace than the one now active, or because someone
 * dismissed it.
 */
export function orderForPickup<T extends { id: string; url: string }>(
  items: T[],
  pickup: CapturePickup | null,
): { items: T[]; pickedId: string | null; matched: boolean } {
  if (!pickup) return { items, pickedId: null, matched: false };
  const match =
    (pickup.handoffId ? items.find((i) => i.id === pickup.handoffId) : undefined) ??
    (pickup.url ? items.find((i) => i.url === pickup.url) : undefined);
  if (!match) return { items, pickedId: null, matched: false };
  return {
    items: [match, ...items.filter((i) => i.id !== match.id)],
    pickedId: match.id,
    matched: true,
  };
}

/**
 * The one line shown when the web app pointed at a page this panel cannot
 * find. Never a silent no-op, never a stack trace — a sentence that names the
 * likely reason and the next move.
 */
export function pickupMissWhy(pickup: CapturePickup, organizationName: string | null): string {
  const what = pickup.url ?? 'that page';
  const where = organizationName ? ` in ${organizationName}` : '';
  return `The web app pointed at ${what}, but it is not waiting${where} any more — it was probably already captured or skipped.`;
}
