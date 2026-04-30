/**
 * Pull the raw `document.documentElement.outerHTML` from a tab via
 * chrome.scripting.executeScript. The Tasks pipeline submits this to
 * /extension-content as required by the EXTENSION_API contract — server-side
 * parsing wants the full DOM, not the sidepanel-sanitized article HTML.
 */

import { log } from '@/lib/debug/log';

export async function getOuterHtml(tabId: number): Promise<string> {
  const start = performance.now();
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML,
    });
    const html = (result?.[0]?.result as string | undefined) ?? '';
    const ms = Math.round(performance.now() - start);
    log.success('scrape', `getOuterHtml tab=${tabId} ${html.length} chars (${ms}ms)`);
    return html;
  } catch (err) {
    log.error('scrape', `getOuterHtml tab=${tabId} failed`, err);
    throw err;
  }
}
