/**
 * Guided capture — start it on ANY tab the person is looking at.
 *
 * Before this, the guide only appeared on a tab the web app opened ("Take me there") or after the
 * Swipe card's "Capture more". Now the side panel and the right-click menu start it on the current
 * tab through the same job door (`startFeedCapture`, rung `human_drive`).
 *
 * Starting it also makes sure a LIVE guide is on the tab: a tab that was open before the extension
 * reloaded keeps a dead copy of the guide script (it cannot talk to the extension any more), so
 * when the wake message finds no listener the guide is injected afresh. That dead copy was a big
 * part of "it is a roll of the dice whether it works".
 */

import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { OpenGuidedResult } from './host';
import { GUIDED_WAKE } from './protocol';

const GUIDE_SCRIPT = 'content-scripts/guided-capture.js';

/** Make sure the tab's guide is alive and asks for its job now. */
export async function wakeGuide(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { t: GUIDED_WAKE });
    return;
  } catch {
    // No live listener on the tab (it predates this copy of the extension): inject the guide.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: [GUIDE_SCRIPT] });
}

/** Start a guided capture of the profile or feed open in `tabId`. */
export async function captureFeedOnTab(args: {
  tabId: number;
  url: string;
}): Promise<OpenGuidedResult> {
  const { startFeedCapture } = await import('@/lib/swipe-file/browser-capture');
  const started = await startFeedCapture(args);
  if (!started.ok) return started;
  try {
    await wakeGuide(args.tabId);
  } catch {
    return {
      ok: false,
      sentence: 'The guide could not open on this page. Reload it and try again.',
    };
  }
  return started;
}

export interface GuidedStartRequest {
  tabId: number;
  url: string;
}

/** Service worker: answer the side panel's "capture this feed". */
export function registerGuidedCaptureStart(): void {
  on<GuidedStartRequest, OpenGuidedResult>(CHANNELS.GUIDED_CAPTURE_START, (req) =>
    typeof req?.tabId === 'number' && typeof req.url === 'string'
      ? captureFeedOnTab(req)
      : Promise.resolve({ ok: false, sentence: 'Open a profile or feed, then try again.' }),
  );
}
