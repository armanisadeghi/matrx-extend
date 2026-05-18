/**
 * Single-shot active-tab resolver used by the chat hooks before assembling
 * a request. The chat path queries the active tab EXACTLY ONCE per send
 * and threads the resulting `chrome.tabs.Tab` through `buildChatContext`,
 * `buildBrowserDomState`, and the `STREAM_START.assignedTabId` latch.
 *
 * Why this exists: every per-send tab-id field on the wire
 * (`context.page_brief.tab_id`, `context.tab_state.*`,
 * `client.state["browser-dom"].current_tab_id`, the dispatcher's
 * `assignedTabId`) MUST reference the same Tab. Doing
 * `chrome.tabs.query({active:true})` twice introduces a tiny race where
 * the user can switch tabs between the two queries and the request goes
 * up with mixed identities — `page_brief` from one tab, discovery state
 * from another. See docs/REQUEST_PAYLOAD_CONTRACT.md §1.
 *
 * Returns null when the query fails (e.g. no window focused). Callers
 * must tolerate that — the builders all fall through to their own
 * defensive queries in that case so the request still goes out.
 */

import { log } from '@/lib/debug/log';

export async function resolveActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch (err) {
    log.warn('stream', 'active tab query failed', err);
    return null;
  }
}
