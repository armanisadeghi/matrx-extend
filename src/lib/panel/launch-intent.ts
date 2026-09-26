import type { SidepanelTab } from '@/state/sidepanel-tab';

/**
 * A toolbar popup closes as soon as it opens the side panel, so a one-use
 * session record is the handoff between the two extension documents. This is
 * navigation only: the Scrape view still waits for the person to press its
 * Capture button.
 */
export const POPUP_LAUNCH_INTENT_KEY = 'matrx.sidepanel.popup_launch_intent';

const CAPTURE_PAGE_INTENT_TTL_MS = 15_000;

type CapturePageIntent = {
  id: string;
  kind: 'capture-page';
  windowId: number;
  expiresAt: number;
};

export interface CapturePagePanelRequest {
  intent: CapturePageIntent;
  write: Promise<void>;
}

function isCapturePageIntent(value: unknown): value is CapturePageIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CapturePageIntent>;
  return (
    typeof candidate.id === 'string' &&
    candidate.kind === 'capture-page' &&
    typeof candidate.windowId === 'number' &&
    typeof candidate.expiresAt === 'number'
  );
}

/** Start the durable handoff before requesting the native side panel. */
export function requestCapturePagePanel(windowId: number): CapturePagePanelRequest {
  const intent: CapturePageIntent = {
    id: crypto.randomUUID(),
    kind: 'capture-page',
    windowId,
    expiresAt: Date.now() + CAPTURE_PAGE_INTENT_TTL_MS,
  };
  return {
    intent,
    write: chrome.storage.session.set({ [POPUP_LAUNCH_INTENT_KEY]: intent }),
  };
}

/** Remove only the request created by this popup click, never a newer click. */
export async function clearCapturePagePanel(request: CapturePagePanelRequest): Promise<boolean> {
  try {
    await request.write;
    const row = await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY]);
    const current = row[POPUP_LAUNCH_INTENT_KEY];
    if (!isCapturePageIntent(current) || current.id !== request.intent.id) return false;
    await chrome.storage.session.remove(POPUP_LAUNCH_INTENT_KEY);
    return true;
  } catch {
    return false;
  }
}

let claimQueue = Promise.resolve();

/**
 * Takes the current window's popup intent exactly once. Claims are serialized
 * in the side-panel realm, and a failed removal is a refusal: routing while
 * leaving the intent behind would let a later Open chat be redirected.
 */
export function takePopupLaunchTarget(windowId: number): Promise<SidepanelTab | null> {
  const claim = claimQueue.then(async () => {
    let row: Record<string, unknown>;
    try {
      row = await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY]);
    } catch {
      return null;
    }

    const intent = row[POPUP_LAUNCH_INTENT_KEY];
    if (intent === undefined) return null;
    if (isCapturePageIntent(intent) && intent.windowId !== windowId) return null;

    try {
      await chrome.storage.session.remove(POPUP_LAUNCH_INTENT_KEY);
    } catch {
      return null;
    }

    if (!isCapturePageIntent(intent) || intent.expiresAt < Date.now()) return null;
    return 'scrape';
  });
  claimQueue = claim.then(
    () => undefined,
    () => undefined,
  );
  return claim;
}
