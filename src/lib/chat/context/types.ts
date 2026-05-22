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
  /**
   * Active tab as captured by the caller (see use-chat-stream's
   * `resolveActiveTab`). When provided, the context builder uses this
   * instead of running `chrome.tabs.query` itself — this is what keeps
   * `context.tab_state.*`, `context.page_brief.tab_id`, and
   * `client.state["browser-dom"].current_tab_id` referencing the SAME
   * Tab even when the user switches mid-send. See
   * docs/REQUEST_PAYLOAD_CONTRACT.md §1.
   *
   * When omitted, the builder falls back to its own query — kept for
   * tests and one-off invocations that don't have a tab handy.
   */
  activeTab?: chrome.tabs.Tab | null;
  /**
   * Active conversation id at send time. Used to attach the per-chat
   * plan / tasks / user_todos slices into context so the model sees
   * its own list (and any user edits) on every turn. Null on the very
   * first user message — the conversation_id is server-assigned and
   * arrives via STREAM_OPENED.
   */
  conversationId?: string | null;
  /**
   * Highlights the user attached to the chat (via the Highlight tab). Each
   * carries the captured text plus its reference (selector / ref / text
   * anchor) so the agent can act on the exact element/passage with the
   * existing interaction + extraction tools. Attached as the `highlights`
   * context key only when non-empty. See src/lib/highlights/.
   */
  highlights?: AttachedHighlight[] | null;
}

export interface AttachedHighlight {
  id: string;
  mode: 'text' | 'element';
  text: string | null;
  url: string;
  /** Re-locatable reference: selector / ref / text-quote / role / tag. */
  ref: {
    selector?: string;
    ref?: string;
    text_quote?: { exact: string; prefix?: string; suffix?: string };
    role?: string;
    tag?: string;
  };
}
