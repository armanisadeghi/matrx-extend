/**
 * The extension's auto-attach context for the package chat: the page the person is on (and the
 * attached scrape/selection), collected by the same `buildChatContextValues` the extension's own
 * send path uses. It hands the package the RAW values, before any rule: the package's door
 * (`applyHostContextToRequest`) turns each into a row under the person's saved rule — the same
 * rows its chip shows — so a value switched off on the chip never rides, and a value the person
 * turned off still has a row to turn it back on (2026-10-21: the rule was applied here from a
 * second, stale copy of the rules, and a value switched off vanished from the chip). Registered
 * as a package context source (`registry.contextSources`), which the package asks on every turn
 * start and resume under a bounded wait. Highlights and Google files are NOT built here: they ride
 * their attachment sources (`composer-extensions`).
 */

import { subscribeActiveTab } from '@/hooks/use-active-tab';
import { resolveActiveTab } from '@/lib/chat/active-tab';
import { buildChatContextValues } from '@/lib/chat/context';
import { log } from '@/lib/debug/log';
import { useAuthStore } from '@/state/auth';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { useDesktopStore } from '@/state/desktop';
import { useScrapeStore } from '@/state/scrape';
import type { ChatContextSource } from '@ai-matrx/chat/host';

export const extensionPageContextSource: ChatContextSource = {
  id: 'matrx-extend:page-context',
  // The composer's context chip re-reads this source when the person lands on another tab or
  // the page finishes loading, so its count follows the page (not only the last send).
  subscribe(onChange) {
    const onActivated = () => onChange();
    const onUpdated = (_id: number, info: Pick<chrome.tabs.TabChangeInfo, 'status'>) => {
      if (info.status === 'complete') onChange();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // The page's scrape lands (or is cleared) after those tab events; the count must follow it.
    const unsubscribeScrape = useAutoScrapeStore.subscribe((state, prev) => {
      if (state.current !== prev.current) onChange();
    });
    // The tab events fire before the page identity settles; the scrape only counts once it does.
    const unsubscribeIdentity = subscribeActiveTab(onChange);
    return () => {
      unsubscribeIdentity();
      unsubscribeScrape();
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  },
  async contribute({ conversationId }) {
    try {
      const user = useAuthStore.getState().user;
      const values = await buildChatContextValues({
        user: user ? { id: user.id, email: user.email, full_name: user.full_name ?? null } : null,
        desktopTransport: useDesktopStore.getState().transport,
        scrape: useScrapeStore.getState().current,
        autoScrape: useAutoScrapeStore.getState().current,
        activeTab: await resolveActiveTab(),
        conversationId,
      });
      const context = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined),
      );
      return Object.keys(context).length > 0 ? { context } : null;
    } catch (err) {
      log.warn('stream', 'package chat page context failed; sending without it', err);
      return null;
    }
  },
};
