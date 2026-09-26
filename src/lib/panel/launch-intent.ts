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
  kind: 'capture-page';
  expiresAt: number;
};

function isCapturePageIntent(value: unknown): value is CapturePageIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CapturePageIntent>;
  return candidate.kind === 'capture-page' && typeof candidate.expiresAt === 'number';
}

/** Start the durable handoff before requesting the native side panel. */
export function requestCapturePagePanel(): Promise<void> {
  return chrome.storage.session.set({
    [POPUP_LAUNCH_INTENT_KEY]: {
      kind: 'capture-page',
      expiresAt: Date.now() + CAPTURE_PAGE_INTENT_TTL_MS,
    } satisfies CapturePageIntent,
  });
}

/**
 * Takes the popup intent exactly once. Expired and malformed records are also
 * removed so a later panel open cannot be redirected by an old click.
 */
export async function takePopupLaunchTarget(): Promise<SidepanelTab | null> {
  let row: Record<string, unknown>;
  try {
    row = await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY]);
  } catch {
    return null;
  }

  const intent = row[POPUP_LAUNCH_INTENT_KEY];
  if (intent === undefined) return null;

  try {
    await chrome.storage.session.remove(POPUP_LAUNCH_INTENT_KEY);
  } catch {
    // The record is only a navigation hint. A failed cleanup must not turn it
    // into a capture request or prevent the person from reaching Scrape.
  }

  if (!isCapturePageIntent(intent) || intent.expiresAt < Date.now()) return null;
  return 'scrape';
}
