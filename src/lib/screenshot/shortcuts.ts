/**
 * One-keystroke capture: the keyboard shortcuts and the right-click entry
 * both capture the page the person is looking at, save it like every other
 * screenshot (gallery + Files), and open the editor in a new tab.
 *
 * Runs in the service worker; the capture itself is the same
 * `take_screenshot` handler the agent and the Screenshots tab use.
 */

import type { Tool } from '@/features/screenshots/editor/model';
import { openScreenshotEditor } from '@/features/screenshots/links';
import { log } from '@/lib/debug/log';
import { newId } from '@/lib/id';

/** Manifest command names — wxt.config.ts declares the same two. */
export const SCREENSHOT_COMMANDS = {
  area: 'screenshot-area',
  fullPage: 'screenshot-full-page',
} as const;

export async function captureAndEdit(
  tab: chrome.tabs.Tab | undefined,
  mode: 'visible' | 'full_page',
  tool?: Tool,
): Promise<void> {
  if (!tab?.id) return notify('Open a web page first, then try again.');
  try {
    const { take_screenshot } = await import('@/lib/tools/handlers/read');
    const result = (await take_screenshot.run(
      {
        profile: 'auto',
        format: 'png',
        max_dimension: 0,
        persist: true,
        capture_source: 'user',
        mode,
      } as never,
      {
        conversationId: null,
        runId: 'user-screenshot-shortcut',
        callId: newId('user-screenshot'),
        agentName: 'user',
        permissionMode: 'act',
        assignedTabId: tab.id,
      },
    )) as { ok?: boolean; reason?: string; file_id?: string | null; screenshot_id?: string | null };
    if (result.ok === false) return notify(result.reason ?? 'This page cannot be captured.');
    if (!result.file_id)
      return notify('Captured, but could not save. Check that you are signed in.');
    openScreenshotEditor({
      fileId: result.file_id,
      screenshotId: result.screenshot_id ?? null,
      ...(tool ? { tool } : {}),
    });
  } catch (err) {
    log.warn('sw', 'captureAndEdit failed', err);
    await notify((err as Error)?.message ?? 'Screenshot failed.');
  }
}

export function setupScreenshotShortcuts(): void {
  if (!chrome.commands?.onCommand) return;
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === SCREENSHOT_COMMANDS.area) void captureAndEdit(tab, 'visible', 'crop');
    else if (command === SCREENSHOT_COMMANDS.fullPage) void captureAndEdit(tab, 'full_page');
  });
}

async function notify(message: string): Promise<void> {
  try {
    await chrome.notifications?.create(`matrx-screenshot-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: 'Screenshot',
      message,
    });
  } catch {
    log.warn('sw', 'screenshot notification failed', { message });
  }
}
