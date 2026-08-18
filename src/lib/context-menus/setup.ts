/**
 * Right-click context menus.
 *
 * Two entries:
 *   1. "Ask Matrx about \"%s\"" — visible only when text is selected.
 *      Stashes the selection in chrome.storage.session under
 *      `matrx.chat.pending_draft`, opens the side panel, and broadcasts
 *      `CHAT_DRAFT_FROM_SELECTION` so an already-open sidepanel reacts
 *      immediately. The chat view drains the storage key on mount as a
 *      cold-open fallback (broadcast is racey when the sidepanel hasn't
 *      mounted listeners yet).
 *   2. "Save this site as a prospect" — the HUMAN half of IC-10. It does not
 *      capture anything itself: it opens the side panel with a drafted
 *      instruction, so the agent runs `capture_prospect` and reports the
 *      preview (verdict + who we already know at this domain) in chat before
 *      anything is written. A menu item that wrote straight to the CRM would
 *      be a capture with no preview, which is the one thing the contract says
 *      a capture must never be.
 *   3. "Open Matrx side panel" — page-context fallback for users who
 *      haven't pinned the action button.
 *
 * Why we ship a context menu at all: the `contextMenus` permission lives
 * in the manifest because we want this surface; if it weren't used the
 * Chrome Web Store would (and did) flag it as a "declared but unused"
 * permission.
 */

import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

const MENU_ID_ASK_SELECTION = 'matrx.menu.ask-selection';
const MENU_ID_OPEN_PANEL = 'matrx.menu.open-panel';
const MENU_ID_CAPTURE_PROSPECT = 'matrx.menu.capture-prospect';
const MENU_ID_CAPTURE_STUDY_SET = 'matrx.menu.capture-study-set';

/**
 * The drafted instruction behind "Save this site as a prospect". Deliberately
 * asks for the CHECK first — the agent's own tool defaults to `preview`, and
 * the sentence has to agree with it or a user reading the chat sees the agent
 * do something they did not ask for.
 */
const CAPTURE_PROSPECT_DRAFT =
  'Check whether this site is worth adding to my prospect list, and tell me if ' +
  'we already know them, before you save it.';

/** The drafted instruction behind "Save this study set to Matrx" (IC-11's
 * human half). Preview-first for the same reason as the prospect draft: the
 * tool defaults to `preview`, and the sentence must agree with it. */
const CAPTURE_STUDY_SET_DRAFT =
  'Preview the study set on this page — show me the deck name, how many cards ' +
  'you found, and a sample — then save it as a flashcard deck if it looks right.';

export const PENDING_DRAFT_STORAGE_KEY = 'matrx.chat.pending_draft';

export function setupContextMenus(): void {
  if (!chrome.contextMenus) {
    log.warn('sw', 'chrome.contextMenus unavailable — skipping menu install');
    return;
  }

  registerMenus();
  if (chrome.runtime.onInstalled) {
    // onInstalled fires on install/update/browser-start with a wakeable SW —
    // re-declare so the menus survive an extension reload during dev too.
    chrome.runtime.onInstalled.addListener(() => registerMenus());
  }

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === MENU_ID_ASK_SELECTION) {
      const text = (info.selectionText ?? '').trim();
      if (!text) return;
      await stashDraft(text);
      await openSidepanel(tab?.windowId);
      broadcast(CHANNELS.CHAT_DRAFT_FROM_SELECTION, { text });
      return;
    }
    if (info.menuItemId === MENU_ID_CAPTURE_PROSPECT) {
      await stashDraft(CAPTURE_PROSPECT_DRAFT);
      await openSidepanel(tab?.windowId);
      broadcast(CHANNELS.CHAT_DRAFT_FROM_SELECTION, { text: CAPTURE_PROSPECT_DRAFT });
      return;
    }
    if (info.menuItemId === MENU_ID_CAPTURE_STUDY_SET) {
      await stashDraft(CAPTURE_STUDY_SET_DRAFT);
      await openSidepanel(tab?.windowId);
      broadcast(CHANNELS.CHAT_DRAFT_FROM_SELECTION, { text: CAPTURE_STUDY_SET_DRAFT });
      return;
    }
    if (info.menuItemId === MENU_ID_OPEN_PANEL) {
      await openSidepanel(tab?.windowId);
    }
  });
}

function registerMenus(): void {
  // removeAll → recreate so SW restarts during dev don't trip the
  // "Cannot create item with duplicate id" error.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID_ASK_SELECTION,
      title: 'Ask Matrx about "%s"',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: MENU_ID_CAPTURE_PROSPECT,
      title: 'Save this site as a prospect',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: MENU_ID_CAPTURE_STUDY_SET,
      title: 'Save this study set to Matrx',
      contexts: ['page'],
      // Only where it applies — the flashcard incumbents. Any other page still
      // captures via chat ("save this page as a study set").
      documentUrlPatterns: [
        '*://*.quizlet.com/*',
        '*://*.knowt.com/*',
        '*://*.cram.com/*',
      ],
    });
    chrome.contextMenus.create({
      id: MENU_ID_OPEN_PANEL,
      title: 'Open Matrx side panel',
      contexts: ['page'],
    });
  });
}

async function stashDraft(text: string): Promise<void> {
  try {
    await chrome.storage.session?.set({ [PENDING_DRAFT_STORAGE_KEY]: text });
  } catch {
    /* storage.session can be absent on older Chrome; broadcast is the fallback */
  }
}

async function openSidepanel(windowId?: number): Promise<void> {
  if (!chrome.sidePanel?.open) return;
  try {
    if (windowId != null) {
      await chrome.sidePanel.open({ windowId });
      return;
    }
    const win = await chrome.windows.getCurrent();
    if (win.id != null) await chrome.sidePanel.open({ windowId: win.id });
  } catch (err) {
    log.warn('sw', 'sidePanel.open failed for context menu', err);
  }
}
