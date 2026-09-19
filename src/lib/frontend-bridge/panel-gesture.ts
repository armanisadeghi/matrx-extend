/**
 * THE ONE PLACE THAT OPENS OUR SIDE PANEL ON SOMEBODY'S CLICK.
 *
 * ## The question this answers
 *
 * Owner, 2026-09-18: *"is there a way that it could automatically open the
 * extension while on the page inside of our app so that it's open when we send
 * the user?"* The answer shipped on 2026-09-19 is YES, and this module is the
 * whole of it.
 *
 * ## What was actually wrong before
 *
 * It was NOT that a click in our web app cannot reach this extension as a user
 * gesture. It can, and always could. It was that the `captureHandoff.pickUp`
 * handler did its work first — read the signed-in user, list the person's
 * organizations, write the stored selection — and called
 * `chrome.sidePanel.open()` last. **Chrome hands the message a gesture token
 * that is consumed by the first `await` in the listener's turn**, so by the
 * time `open()` was reached the token was long gone and Chrome said, correctly,
 * *"`sidePanel.open()` may only be called in response to a user gesture."*
 * That sentence was then written down as a platform limit. It was our own
 * ordering.
 *
 * ## The rule, measured rather than assumed
 *
 * Spike: `tests/browser/side-panel-gesture-spike.mjs`, Chrome for Testing
 * 153.0.0.0 (`--headless=new`, same milestone as Chrome stable 153.0.8010.48),
 * a throwaway extension, a real Playwright click. Sixteen variants; the ones
 * that decide the design:
 *
 * | what the handler did before `open()`      | Chrome |
 * |-------------------------------------------|--------|
 * | nothing — `open({windowId})` invoked first | OPENS  |
 * | nothing — `open({tabId})` invoked first    | OPENS  |
 * | invoked `open()` first, awaited it LAST    | OPENS  |
 * | `await Promise.resolve()` (ONE microtask)  | REFUSES|
 * | `await chrome.storage.local.get(...)`      | REFUSES|
 * | `await chrome.sidePanel.setOptions(...)`   | REFUSES|
 * | `await chrome.tabs.create(...)`            | REFUSES|
 * | no gesture at all (timer in the worker)    | REFUSES|
 *
 * So the rule is brutal and simple:
 *
 * 🚨 **`chrome.sidePanel.open()` must be INVOKED before the listener's first
 * `await`. Its promise may be awaited whenever you like.** One microtask of
 * slack does not exist. That is why this module returns a promise instead of
 * being an `async` function you await in place.
 *
 * Two more measured facts the callers depend on:
 * - The message may come straight from the page over `externally_connectable`
 *   (`onMessageExternal`) — it carries the gesture just as a content script's
 *   `onMessage` does. **No content script is needed**, so none was added.
 * - The web page itself has ~5 seconds of transient activation to spend before
 *   it sends (2s still opened, 6s did not), and a cold, terminated service
 *   worker still opens. The page side therefore must not burn seconds probing
 *   before it sends — see matrx-frontend `lib/extension-bridge/chrome-rpc.ts`.
 */

import { log } from '@/lib/debug/log';

/** What the RPC listener knows about where the click happened. */
export interface GestureSender {
  /** `sender.tab.id` — present for a page or content script, absent on Broadcast. */
  tabId?: number | undefined;
  /** `sender.tab.windowId` — the window whose side panel should open. */
  windowId?: number | undefined;
}

/**
 * A panel open already in flight. `promise` is null when there was nothing to
 * open against, and `reason` then already says why.
 */
export interface PanelOpenAttempt {
  promise: Promise<unknown> | null;
  reason: string;
}

/** The settled truth about the attempt, exactly as reported over the wire. */
export interface PanelOpenOutcome {
  panelOpened: boolean;
  panelReason: string;
}

/**
 * Ask Chrome to open the side panel, RIGHT NOW, on the gesture we are standing
 * in. Synchronous by contract — never make this `async`, never `await`
 * anything before the `chrome.sidePanel.open()` call, and never call it from a
 * path that has already awaited.
 *
 * Prefers the window over the tab so the panel stays open while the extension
 * opens its background capture tabs; a per-tab open would be tied to the page
 * the person is standing on.
 */
export function openPanelInGesture(sender: GestureSender): PanelOpenAttempt {
  if (sender.windowId === undefined && sender.tabId === undefined) {
    // The Supabase Broadcast path has no tab and therefore no gesture. Nothing
    // is attempted and the reason says so, rather than throwing a Chrome error
    // that reads like a bug.
    return {
      promise: null,
      reason: 'no-gesture-sender',
    };
  }
  try {
    const promise =
      sender.windowId !== undefined
        ? chrome.sidePanel.open({ windowId: sender.windowId })
        : chrome.sidePanel.open({ tabId: sender.tabId as number });
    return { promise, reason: 'pending' };
  } catch (err) {
    // A synchronous throw (no `sidePanel` permission, extension shutting down).
    const reason = (err as Error)?.message ?? 'open-failed';
    log.warn('frontend-bridge', 'sidePanel.open refused synchronously', reason);
    return { promise: null, reason };
  }
}

/**
 * Wait for the attempt and say what happened, in Chrome's own words when it
 * refused. Never throws: `panelOpened: false` with the reason IS the answer,
 * and the caller's receipt tells the person the one step left (law 4).
 */
export async function settlePanelOpen(attempt: PanelOpenAttempt): Promise<PanelOpenOutcome> {
  if (!attempt.promise) {
    return { panelOpened: false, panelReason: attempt.reason };
  }
  try {
    await attempt.promise;
    return { panelOpened: true, panelReason: 'opened' };
  } catch (err) {
    const panelReason = (err as Error)?.message ?? 'open-failed';
    log.warn('frontend-bridge', 'sidePanel.open was refused by Chrome', panelReason);
    return { panelOpened: false, panelReason };
  }
}

/**
 * The actions whose whole point is that the panel ends up in front of the
 * person. Listed here so the gesture-critical call at the top of
 * `handleFrontendRpc` stays one lookup and cannot drift from the handlers.
 */
export const GESTURE_PANEL_ACTIONS: ReadonlySet<string> = new Set([
  'openPanel',
  'captureHandoff.pickUp',
]);
