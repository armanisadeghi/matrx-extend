/**
 * Single-round-trip page probe used by every context builder.
 *
 * Returns metadata + a deterministic page-brief block (kind detection, flags,
 * confidence, headings outline, primary main-area interactive elements,
 * counts of what the brief did NOT include).
 *
 * One executeScript call, no Nano. The cost is a single DOM walk; that pays
 * for both v1 and v2 shapes.
 */

import { log } from '@/lib/debug/log';

export interface BriefBlock {
  /** "high" | "partial" | "low" — see flags for cause when not "high". */
  confidence: 'high' | 'partial' | 'low';
  /**
   * Reasons confidence dropped. Empty array when confidence === "high".
   *
   * Enumerated flag values (keep in sync with docs/REQUEST_PAYLOAD_CONTRACT.md):
   *   - `captcha_present`       — a VISIBLE recaptcha/hcaptcha/turnstile/arkose
   *                                iframe (non-zero rect, display:block) is
   *                                on-screen. Lazy-loaded invisible shims do
   *                                NOT trigger this — see probe.ts.
   *   - `bot_challenge_or_block` — page title matches "just a moment", "checking
   *                                your browser", "access denied", etc.
   *   - `spa_unhydrated`        — visible text < 200 chars AND scripts are
   *                                loading; page hasn't rendered yet.
   *   - `login_wall`            — password input present AND main text < 400 chars.
   *
   * Any of the above pushes confidence to "low". Partial-confidence flags
   * (currently unused / future): consent_overlay, paywall_or_signup_wall,
   * age_gate, not_ready.
   */
  flags: string[];
  /** Inferred page kind. Best-effort heuristic, no model call. */
  kind:
    | 'documentation'
    | 'article'
    | 'product'
    | 'product-listing'
    | 'search-results'
    | 'form'
    | 'login-wall'
    | 'spa-empty'
    | 'captcha'
    | 'error-page'
    | 'unknown';
  /** Top-level headings only (h1, h2) — gives the model the page's outline. */
  headings: Array<{ level: number; text: string }>;
  /** Top CTA when one is obvious (e.g. "Sign Up", "Buy Now"). null otherwise. */
  primary_action: string | null;
  /**
   * Up to 15 interactive elements from the main content area (NOT chrome).
   * No refs — call read_page when the agent needs to interact. The brief is
   * for orientation; refs come from a fresh read_page on demand.
   */
  main_interactive: Array<{ role: string; name: string; tag: string }>;
  /**
   * Interactive elements that DO live in chrome (header, nav, footer,
   * aside). Capped at 20. Surfaced as the `chrome_elements` ctx key so
   * agents can quickly reach sign-in / nav-search / cart icons without
   * walking the full read_page result. Each entry includes `landmark`
   * (header|nav|footer|aside) so the agent knows where it is on the page.
   */
  chrome_interactive: Array<{
    role: string;
    name: string;
    tag: string;
    landmark: 'header' | 'nav' | 'footer' | 'aside' | 'unknown';
  }>;
  /**
   * Dismissible overlays — cookie/consent banners, paywalls, signup walls,
   * newsletter popups. Each entry includes a stable selector for the close
   * button when one is found. Empty array when nothing dismissible is up.
   *
   * Direct attack on BrowserArena's #2 universal failure mode: agents
   * struggle to dismiss popups, often hallucinating that they did.
   */
  dismissibles: Array<{
    kind: 'consent' | 'newsletter' | 'app-install' | 'paywall' | 'age-gate' | 'modal';
    text_excerpt: string;
    close_selector: string | null;
    close_label: string | null;
  }>;
  /**
   * Repeating-card list detected in main area (search results, product
   * listings, item grids). Populated only when ≥5 similar siblings with
   * link anchors are found. URL-derived item IDs survive virtualized scroll.
   */
  result_list: {
    count: number;
    items: Array<{
      title: string;
      url: string;
      price: string | null;
      rating: string | null;
      image_alt: string | null;
    }>;
  } | null;
  /** Counts of what was trimmed — the "more available" honesty signal. */
  more_available: {
    main_interactive_total: number;
    chrome_elements: number;
    forms: number;
    images: number;
    videos: number;
  };
}

export interface PageProbe {
  url: string;
  title: string;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  charset: string | null;
  viewport_meta: string | null;
  robots: string | null;
  referrer: string | null;
  selection: string | null;
  scrollY: number;
  scrollHeight: number;
  innerWidth: number;
  innerHeight: number;
  ready_state: string;
  content_type: string | null;
  og: Record<string, string>;
  twitter: Record<string, string>;
  /** New in v2: deterministic brief facts. v1 ignores it. */
  brief: BriefBlock;
}

export async function probeActivePage(tabId: number): Promise<PageProbe | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): PageProbe => {
        // ── meta walk ────────────────────────────────────────────────────────
        const og: Record<string, string> = {};
        const twitter: Record<string, string> = {};
        document.querySelectorAll<HTMLMetaElement>('meta').forEach((m) => {
          const property = m.getAttribute('property') ?? '';
          const name = m.getAttribute('name') ?? '';
          const content = m.getAttribute('content') ?? '';
          if (!content) return;
          if (property.startsWith('og:')) og[property] = content;
          if (name.startsWith('twitter:')) twitter[name] = content;
        });
        const description =
          document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
        const canonical =
          document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
        const robots =
          document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null;
        const charset =
          document.querySelector<HTMLMetaElement>('meta[charset]')?.getAttribute('charset') ??
          document.characterSet ??
          null;
        const viewport_meta =
          document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? null;
        let selection: string | null = null;
        try {
          selection = window.getSelection()?.toString() ?? null;
          if (selection !== null && selection.trim() === '') selection = null;
        } catch {
          /* ignore */
        }

        // ── brief: chrome / main split ──────────────────────────────────────
        const CHROME_SELECTOR =
          'header, nav, footer, aside, [role="banner"], [role="navigation"], [role="contentinfo"], [role="complementary"]';
        const INTERACTIVE_SELECTOR = [
          'a[href]',
          'button:not([disabled])',
          'input:not([type="hidden"]):not([disabled])',
          'select:not([disabled])',
          'textarea:not([disabled])',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="combobox"]',
          '[role="textbox"]',
          '[role="searchbox"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="menuitem"]',
        ].join(', ');

        function isVisible(el: Element): boolean {
          if (!(el instanceof HTMLElement)) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (parseFloat(style.opacity || '1') === 0) return false;
          return true;
        }
        function inChrome(el: Element): boolean {
          return el.closest(CHROME_SELECTOR) !== null;
        }
        function implicitRole(el: Element): string {
          const tag = el.tagName.toLowerCase();
          if (tag === 'a') return 'link';
          if (tag === 'button') return 'button';
          if (tag === 'select') return 'combobox';
          if (tag === 'textarea') return 'textbox';
          if (tag === 'input') {
            const t = (el as HTMLInputElement).type;
            if (t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return t;
            return 'textbox';
          }
          return tag;
        }
        function accessibleName(el: Element): string {
          const aria = el.getAttribute('aria-label');
          if (aria) return aria.trim();
          const labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy) {
            const lbl = document.getElementById(labelledBy);
            if (lbl?.textContent) return lbl.textContent.trim().slice(0, 80);
          }
          const id = el.getAttribute('id');
          if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (label?.textContent) return label.textContent.trim().slice(0, 80);
          }
          const title = el.getAttribute('title');
          if (title) return title.trim().slice(0, 80);
          const placeholder = el.getAttribute('placeholder');
          if (placeholder && el.tagName === 'INPUT') return placeholder.trim().slice(0, 80);
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim().slice(0, 80);
          const text = (el as HTMLElement).innerText?.trim();
          if (text) return text.slice(0, 80);
          return '';
        }

        const allInteractive = Array.from(
          document.querySelectorAll(INTERACTIVE_SELECTOR),
        ).filter(isVisible);
        const mainInteractive = allInteractive.filter((el) => !inChrome(el));
        const chromeInteractive = allInteractive.filter((el) => inChrome(el));
        const chromeInteractiveCount = chromeInteractive.length;

        const mainSample = mainInteractive.slice(0, 15).map((el) => ({
          role: el.getAttribute('role') ?? implicitRole(el),
          name: accessibleName(el),
          tag: el.tagName.toLowerCase(),
        }));

        // Chrome-element sample. Capped at 20 so we don't ship 100 nav
        // links on dense sites — `more_available.chrome_elements` always
        // carries the full count so the agent knows whether to fetch
        // more via read_page. Each entry's landmark tells the agent
        // WHERE in the chrome it lives.
        function landmarkOf(el: Element): 'header' | 'nav' | 'footer' | 'aside' | 'unknown' {
          let cur: Element | null = el;
          while (cur && cur !== document.body) {
            const tag = cur.tagName.toLowerCase();
            if (tag === 'header' || cur.getAttribute('role') === 'banner') return 'header';
            if (tag === 'nav' || cur.getAttribute('role') === 'navigation') return 'nav';
            if (tag === 'footer' || cur.getAttribute('role') === 'contentinfo') return 'footer';
            if (tag === 'aside' || cur.getAttribute('role') === 'complementary') return 'aside';
            cur = cur.parentElement;
          }
          return 'unknown';
        }
        const chromeSample = chromeInteractive.slice(0, 20).map((el) => ({
          role: el.getAttribute('role') ?? implicitRole(el),
          name: accessibleName(el),
          tag: el.tagName.toLowerCase(),
          landmark: landmarkOf(el),
        }));

        // ── brief: headings ─────────────────────────────────────────────────
        const headings = Array.from(
          document.querySelectorAll<HTMLElement>('h1, h2'),
        )
          .filter(isVisible)
          .slice(0, 12)
          .map((h) => ({
            level: parseInt(h.tagName.slice(1), 10),
            text: (h.innerText ?? h.textContent ?? '').trim().slice(0, 120),
          }))
          .filter((h) => h.text.length > 0);

        // ── brief: primary action heuristic ────────────────────────────────
        // Top main-area button or call-to-action link with high prominence.
        const PRIMARY_HINTS =
          /\b(sign up|sign in|log in|get started|start free|buy now|add to cart|subscribe|book now|try now|continue|submit|create account|download)\b/i;
        let primaryAction: string | null = null;
        for (const el of mainInteractive) {
          const name = accessibleName(el);
          if (PRIMARY_HINTS.test(name)) {
            primaryAction = name;
            break;
          }
        }

        // ── brief: counts ───────────────────────────────────────────────────
        const formsCount = document.querySelectorAll('form').length;
        const imagesCount = document.querySelectorAll('img[src]').length;
        const videosCount = document.querySelectorAll('video[src], video source').length;

        // ── brief: kind / flags / confidence ────────────────────────────────
        const flags: string[] = [];
        const visibleTextLen = (document.body?.innerText ?? '').length;
        const titleLc = document.title.toLowerCase();

        // Only flag captcha_present when an actual challenge is on-screen.
        // Many sites embed invisible recaptcha iframes (form-protection
        // shim, lazy-loaded for a future submit) that never block the
        // user. Matching the selector alone was a 2/2 false-positive in
        // testing (Yahoo, datadestruction.com). Require a visible iframe
        // with non-zero size before promoting the page to kind:'captcha'.
        const captchaIframes = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(
            'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="arkose"]',
          ),
        );
        const visibleCaptchaIframe = captchaIframes.find((iframe) => {
          const rect = iframe.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 40) return false;
          const style = window.getComputedStyle(iframe);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (parseFloat(style.opacity || '1') === 0) return false;
          return true;
        });
        if (visibleCaptchaIframe) flags.push('captcha_present');

        if (
          /just a moment|checking your browser|attention required|access denied|forbidden/.test(
            titleLc,
          )
        ) {
          flags.push('bot_challenge_or_block');
        }

        const passwordInput = document.querySelector('input[type="password"]');
        const mainEl = document.querySelector('main, [role="main"]') as HTMLElement | null;
        const mainTextLen = (mainEl?.innerText ?? '').length;

        if (visibleTextLen < 200 && document.querySelectorAll('script[src]').length > 0) {
          flags.push('spa_unhydrated');
        }
        if (passwordInput && mainTextLen < 400) {
          flags.push('login_wall');
        }

        // ── dismissibles inventory ──────────────────────────────────────────
        // Find dismissible overlays (modal-sized, high z-index, fixed/sticky)
        // and their close buttons. Threshold is more permissive than the
        // "blocking overlay" check above so we catch newsletter popups too.
        const overlayCandidates = Array.from(
          document.querySelectorAll<HTMLElement>('div, section, dialog, aside, [role="dialog"]'),
        ).filter((el) => {
          const s = window.getComputedStyle(el);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          const z = parseInt(s.zIndex, 10);
          if (Number.isNaN(z) || z < 100) return false;
          const rect = el.getBoundingClientRect();
          // Modal-sized, not just a toast.
          return rect.width > window.innerWidth * 0.3 && rect.height > window.innerHeight * 0.2;
        });

        function classifyOverlay(text: string): BriefBlock['dismissibles'][number]['kind'] {
          const t = text.toLowerCase();
          if (/cookie|consent|accept all|gdpr|privacy/.test(t)) return 'consent';
          if (/subscribe|sign up to read|create.*account|continue reading|unlock/.test(t))
            return 'paywall';
          if (/verify (your )?age|are you (over )?(18|21)|adult content/.test(t)) return 'age-gate';
          if (/newsletter|email updates|join our list|stay in the loop|exclusive offers/.test(t))
            return 'newsletter';
          if (/install (our )?app|open in app|download the app|get the app/.test(t))
            return 'app-install';
          return 'modal';
        }

        function stableSelectorFor(el: Element): string {
          if (el instanceof HTMLElement && el.id) return `#${CSS.escape(el.id)}`;
          const aria = el.getAttribute('aria-label');
          if (aria) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
          const dt = el.getAttribute('data-testid');
          if (dt) return `${el.tagName.toLowerCase()}[data-testid="${CSS.escape(dt)}"]`;
          // Fallback: nth-of-type chain (max 4 levels)
          const parts: string[] = [];
          let node: Element | null = el;
          while (node && node !== document.body && parts.length < 4) {
            const cur: Element = node;
            const tag = cur.tagName.toLowerCase();
            const parent = cur.parentElement;
            if (!parent) {
              parts.unshift(tag);
              break;
            }
            const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            const idx = sibs.indexOf(cur) + 1;
            parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
            node = parent;
          }
          return parts.join(' > ');
        }

        function findCloseButton(
          el: HTMLElement,
        ): { selector: string; label: string } | null {
          const candidates = el.querySelectorAll<HTMLElement>(
            'button, a, [role="button"], [aria-label]',
          );
          for (const c of Array.from(candidates)) {
            const aria = (c.getAttribute('aria-label') ?? '').toLowerCase();
            const text = (c.textContent ?? '').trim();
            const title = (c.getAttribute('title') ?? '').toLowerCase();
            if (/^(close|dismiss|reject|deny|no thanks|maybe later|not now|decline)$/i.test(text))
              return { selector: stableSelectorFor(c), label: text };
            if (/close|dismiss|reject all/.test(aria))
              return { selector: stableSelectorFor(c), label: aria };
            if (/close|dismiss/.test(title))
              return { selector: stableSelectorFor(c), label: title };
            if (text === '×' || text === '✕' || text === '✖' || text === 'X')
              return { selector: stableSelectorFor(c), label: 'close icon' };
          }
          return null;
        }

        const dismissibles: BriefBlock['dismissibles'] = [];
        for (const overlay of overlayCandidates.slice(0, 5)) {
          const text = (overlay.innerText ?? '').trim();
          if (!text) continue;
          const close = findCloseButton(overlay);
          dismissibles.push({
            kind: classifyOverlay(text),
            text_excerpt: text.slice(0, 200),
            close_selector: close?.selector ?? null,
            close_label: close?.label ?? null,
          });
        }
        // Map dismissibles → flags for legacy consumers.
        if (dismissibles.some((d) => d.kind === 'consent')) flags.push('consent_overlay');
        if (dismissibles.some((d) => d.kind === 'paywall')) flags.push('paywall_or_signup_wall');
        if (dismissibles.some((d) => d.kind === 'age-gate')) flags.push('age_gate');

        if (document.readyState !== 'complete') flags.push('not_ready');

        // ── result list detection ───────────────────────────────────────────
        // Find the largest cluster of similar siblings in main with link
        // anchors. Pure pattern detection — works on search results, product
        // grids, news lists, etc.
        function detectResultList(): BriefBlock['result_list'] {
          const root = mainEl ?? document.body;
          if (!root) return null;
          const containers = root.querySelectorAll<HTMLElement>(
            'ul, ol, [role="list"], div, section',
          );
          let best: { items: HTMLElement[]; score: number } | null = null;
          for (const container of Array.from(containers)) {
            const children = Array.from(container.children) as HTMLElement[];
            if (children.length < 5) continue;
            // Tag uniformity check: ≥80% same tag
            const tagCounts = new Map<string, number>();
            for (const c of children) {
              tagCounts.set(c.tagName, (tagCounts.get(c.tagName) ?? 0) + 1);
            }
            const dominant = Math.max(...tagCounts.values());
            if (dominant < children.length * 0.8) continue;
            // Each item should have a link anchor
            const withLinks = children.filter((c) => c.querySelector('a[href]'));
            if (withLinks.length < 5) continue;
            // Inner text length should be in a reasonable range (not pure links)
            const avgTextLen =
              withLinks.reduce((sum, el) => sum + (el.innerText ?? '').length, 0) /
              withLinks.length;
            if (avgTextLen < 20 || avgTextLen > 2000) continue;
            // Score: more items + reasonable text density
            const score = withLinks.length;
            if (!best || score > best.score) best = { items: withLinks, score };
          }
          if (!best) return null;
          const items = best.items.slice(0, 30).map((item) => {
            const link = item.querySelector('a[href]') as HTMLAnchorElement | null;
            const heading = item.querySelector('h1, h2, h3, h4, h5, [role="heading"]');
            const title = (heading?.textContent ?? link?.textContent ?? '').trim().slice(0, 200);
            const itemText = item.innerText ?? '';
            const priceMatch = itemText.match(
              /[$€£¥₹]\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:USD|EUR|GBP|CAD|AUD)\b/i,
            );
            const ratingMatch = itemText.match(
              /(\d(?:\.\d)?)\s*(?:\/|out of)\s*(?:5|10)|★+|⭐+/,
            );
            const img = item.querySelector('img');
            return {
              title,
              url: link?.href ?? '',
              price: priceMatch?.[0]?.trim() ?? null,
              rating: ratingMatch?.[0]?.trim() ?? null,
              image_alt: img?.getAttribute('alt') || null,
            };
          });
          return { count: best.items.length, items };
        }
        const resultList = detectResultList();

        // ── brief: kind ─────────────────────────────────────────────────────
        let kind: BriefBlock['kind'] = 'unknown';
        if (flags.includes('captcha_present') || flags.includes('bot_challenge_or_block')) {
          kind = 'captcha';
        } else if (flags.includes('spa_unhydrated')) {
          kind = 'spa-empty';
        } else if (flags.includes('login_wall')) {
          kind = 'login-wall';
        } else if (
          /^(403|404|500|502|503|504)/.test(document.title) ||
          /access denied|forbidden|not found|page not found/i.test(document.title)
        ) {
          kind = 'error-page';
        } else if (
          formsCount === 1 &&
          mainEl?.querySelector('form') &&
          (mainEl.querySelector('form')?.querySelectorAll('input, textarea, select').length ?? 0) >= 3
        ) {
          kind = 'form';
        } else if (
          document.querySelector('[itemtype*="schema.org/Product"], [itemtype*="schema.org/Offer"]')
        ) {
          kind = 'product';
        } else if (
          // Search-results: explicit search query in URL or role=search box.
          /\?(?:q|query|search|s)=|\/search\b|\/s\?/i.test(location.href) ||
          document.querySelector('[role="search"]') !== null
        ) {
          kind = 'search-results';
        } else if (
          // Product-listing: result list detected with prices on most items.
          resultList &&
          resultList.items.filter((i) => i.price !== null).length >= resultList.items.length * 0.5
        ) {
          kind = 'product-listing';
        } else if (
          mainTextLen > 1500 &&
          (document.querySelector('article') !== null ||
            document.querySelector('[itemtype*="schema.org/Article"]') !== null)
        ) {
          kind = 'article';
        } else if (
          // Documentation: many short headings + nav + code blocks
          document.querySelectorAll('pre, code').length > 3 &&
          document.querySelector('nav') !== null
        ) {
          kind = 'documentation';
        }

        // ── brief: confidence ───────────────────────────────────────────────
        const blockingFlags = ['captcha_present', 'bot_challenge_or_block', 'spa_unhydrated'];
        const partialFlags = [
          'login_wall',
          'consent_overlay',
          'paywall_or_signup_wall',
          'age_gate',
          'not_ready',
        ];
        let confidence: BriefBlock['confidence'] = 'high';
        if (flags.some((f) => blockingFlags.includes(f))) confidence = 'low';
        else if (flags.some((f) => partialFlags.includes(f))) confidence = 'partial';

        return {
          url: location.href,
          title: document.title,
          description,
          canonical,
          lang: document.documentElement.lang || null,
          charset,
          viewport_meta,
          robots,
          referrer: document.referrer || null,
          selection,
          scrollY: window.scrollY,
          scrollHeight: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight ?? 0,
          ),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          ready_state: document.readyState,
          content_type: document.contentType ?? null,
          og,
          twitter,
          brief: {
            confidence,
            flags,
            kind,
            headings,
            primary_action: primaryAction,
            main_interactive: mainSample,
            chrome_interactive: chromeSample,
            dismissibles,
            result_list: resultList,
            more_available: {
              main_interactive_total: mainInteractive.length,
              chrome_elements: chromeInteractiveCount,
              forms: formsCount,
              images: imagesCount,
              videos: videosCount,
            },
          },
        };
      },
    });
    return (first?.result as PageProbe | undefined) ?? null;
  } catch (err) {
    log.warn('scrape', 'probeActivePage failed', err);
    return null;
  }
}
