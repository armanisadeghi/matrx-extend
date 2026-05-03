import type { AutoScrapeRecord } from '@/state/auto-scrape';
import type { useScrapeStore } from '@/state/scrape';

export interface ContextBuildInputs {
  user: {
    id: string;
    email: string | null;
    full_name: string | null;
  } | null;
  desktopTransport: 'native' | 'http' | 'none';
  /** The current value of `useScrapeStore.current` — null if no manual capture exists. */
  scrape: ReturnType<typeof useScrapeStore.getState>['current'];
  /**
   * Background auto-capture (from `useAutoScrapeStore`). Used when there's no
   * manual scrape — captures the page in the background on load and right
   * before send so the agent always sees the current state without the user
   * having to click "Scrape".
   */
  autoScrape?: AutoScrapeRecord | null;
}
