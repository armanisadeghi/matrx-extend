/**
 * Page preparation: pre-extraction cleanup that runs ONCE in the page context
 * before any extraction mode runs.
 *
 * Goal: get the page to its "fully visible" state without AI:
 *   1. Dismiss cookie / GDPR banners
 *   2. Dismiss soft sign-in / paywall overlays (where dismiss is possible)
 *   3. Click "Load more" / "Show more" buttons in a loop until exhausted
 *   4. Scroll to trigger lazy-loaded content
 *
 * Heuristics-only — no AI required. Reports what it did so the user can see
 * in the UI.
 */

export interface PagePrepConfig {
  dismissBanners: boolean;
  expandLoadMore: boolean;
  loadMoreClicks: number; // cap on how many times we click load-more
  scrollToBottom: boolean;
  scrollSteps: number;
  scrollDelayMs: number;
}

export interface PagePrepReport {
  banners_dismissed: { selector: string; text: string }[];
  load_more_clicks: { selector: string; text: string }[];
  scroll_steps: number;
  duration_ms: number;
}

export const defaultPagePrepConfig: PagePrepConfig = {
  dismissBanners: true,
  expandLoadMore: true,
  loadMoreClicks: 8,
  scrollToBottom: true,
  scrollSteps: 12,
  scrollDelayMs: 250,
};

/**
 * Self-contained in-page implementation. Crosses the chrome.scripting boundary
 * via .toString() so it MUST not reference outer-scope identifiers.
 */
export const preparePageInPage = async (config: PagePrepConfig): Promise<PagePrepReport> => {
  const t0 = performance.now();
  const report: PagePrepReport = {
    banners_dismissed: [],
    load_more_clicks: [],
    scroll_steps: 0,
    duration_ms: 0,
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ── Banner dismiss ──────────────────────────────────────────────────────
  // We look for buttons whose visible text matches common consent-action
  // patterns AND whose containing element looks like a banner/modal/overlay.
  // We do NOT click "Reject" or "More options" — only the affirmative dismiss
  // button so the user's GDPR preference defaults to "accept the necessary"
  // (the banner closes, page becomes usable).
  const ACCEPT_PATTERNS = [
    /^accept all$/i,
    /^accept all cookies$/i,
    /^accept$/i,
    /^i accept$/i,
    /^agree$/i,
    /^i agree$/i,
    /^got it$/i,
    /^ok$/i,
    /^okay$/i,
    /^continue$/i,
    /^allow all$/i,
    /^allow$/i,
    /^understood$/i,
    /^dismiss$/i,
    /^close$/i,
    /^×$/i,
  ];
  const REJECT_HINT = /reject|decline|deny|opt[ -]?out/i;

  const isVisible = (el: Element): boolean => {
    const e = el as HTMLElement;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = window.getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return true;
  };

  const looksLikeBanner = (el: Element): boolean => {
    let cur: Element | null = el;
    let hops = 0;
    while (cur && hops < 6) {
      const id = (cur.id ?? '').toLowerCase();
      const cls = (cur.className && typeof cur.className === 'string'
        ? cur.className
        : ''
      ).toLowerCase();
      const role = (cur.getAttribute('role') ?? '').toLowerCase();
      if (
        /consent|cookie|gdpr|privacy|banner|modal|overlay|notice|popup|onetrust|cmp|truste/.test(
          `${id} ${cls}`,
        )
      ) {
        return true;
      }
      if (role === 'dialog' || role === 'alertdialog') return true;
      cur = cur.parentElement;
      hops++;
    }
    return false;
  };

  if (config.dismissBanners) {
    // Try a couple of passes — dismissing one banner can reveal another.
    for (let pass = 0; pass < 3; pass++) {
      let actedThisPass = false;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a'),
      );
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const text = (btn.innerText || btn.textContent || '').trim();
        if (!text || text.length > 30) continue;
        if (REJECT_HINT.test(text)) continue;
        if (!ACCEPT_PATTERNS.some((p) => p.test(text))) continue;
        if (!looksLikeBanner(btn)) continue;
        try {
          btn.click();
          report.banners_dismissed.push({
            selector: btn.tagName.toLowerCase(),
            text,
          });
          actedThisPass = true;
          await sleep(150);
        } catch {
          // ignore
        }
        if (report.banners_dismissed.length >= 5) break;
      }
      if (!actedThisPass) break;
    }
  }

  // ── Load-more expansion ─────────────────────────────────────────────────
  const LOAD_MORE_PATTERNS = [
    /^load more$/i,
    /^show more$/i,
    /^see more$/i,
    /^view more$/i,
    /^more results$/i,
    /^see all$/i,
    /^view all$/i,
    /^show all$/i,
    /^expand$/i,
  ];

  if (config.expandLoadMore) {
    let clicks = 0;
    for (let i = 0; i < config.loadMoreClicks; i++) {
      let clicked = false;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button, [role="button"], a'),
      );
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const text = (btn.innerText || btn.textContent || '').trim();
        if (!text || text.length > 30) continue;
        if (!LOAD_MORE_PATTERNS.some((p) => p.test(text))) continue;
        if ((btn as HTMLButtonElement).disabled) continue;
        const aria = btn.getAttribute('aria-disabled');
        if (aria === 'true') continue;
        try {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
          btn.click();
          clicks++;
          report.load_more_clicks.push({
            selector: btn.tagName.toLowerCase(),
            text,
          });
          clicked = true;
          await sleep(800);
        } catch {
          // ignore
        }
        break; // only one button per pass
      }
      if (!clicked) break;
    }
    void clicks;
  }

  // ── Scroll to bottom (triggers IntersectionObserver-based lazy load) ────
  if (config.scrollToBottom) {
    const startY = window.scrollY;
    const docH = () => document.documentElement.scrollHeight;
    const winH = window.innerHeight;
    const step = Math.max(winH * 0.8, 300);
    let y = startY;
    for (let i = 0; i < config.scrollSteps; i++) {
      y += step;
      if (y >= docH() - winH) {
        window.scrollTo({ top: docH(), behavior: 'instant' as ScrollBehavior });
        report.scroll_steps++;
        await sleep(config.scrollDelayMs);
        break;
      }
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      report.scroll_steps++;
      await sleep(config.scrollDelayMs);
    }
    // Restore scroll position so the user isn't disoriented.
    window.scrollTo({ top: startY, behavior: 'instant' as ScrollBehavior });
  }

  report.duration_ms = Math.round(performance.now() - t0);
  return report;
};

/**
 * Drive page-prep against a tab. Used by the Prepare sub-tab and as an
 * optional pre-step before any extraction mode.
 */
export async function preparePage(
  tabId: number,
  config: Partial<PagePrepConfig> = {},
): Promise<PagePrepReport> {
  const merged: PagePrepConfig = { ...defaultPagePrepConfig, ...config };
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: preparePageInPage,
    args: [merged],
  });
  return (
    (result?.[0]?.result as PagePrepReport | undefined) ?? {
      banners_dismissed: [],
      load_more_clicks: [],
      scroll_steps: 0,
      duration_ms: 0,
    }
  );
}
