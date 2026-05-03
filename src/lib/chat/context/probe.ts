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
  /** Reasons confidence dropped. Empty when confidence === "high". */
  flags: string[];
  /** Inferred page kind. Best-effort heuristic, no model call. */
  kind:
    | 'documentation'
    | 'article'
    | 'product'
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
        const chromeInteractiveCount = allInteractive.length - mainInteractive.length;

        const mainSample = mainInteractive.slice(0, 15).map((el) => ({
          role: el.getAttribute('role') ?? implicitRole(el),
          name: accessibleName(el),
          tag: el.tagName.toLowerCase(),
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

        const captchaIframe = document.querySelector(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="arkose"]',
        );
        if (captchaIframe) flags.push('captcha_present');

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

        // Consent / paywall overlay heuristic: large fixed-position overlay.
        const overlays = Array.from(
          document.querySelectorAll<HTMLElement>('div, section, dialog, aside'),
        ).filter((el) => {
          const s = window.getComputedStyle(el);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          const z = parseInt(s.zIndex, 10);
          if (Number.isNaN(z) || z < 1000) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3;
        });
        if (overlays.length > 0) {
          const overlayText = (overlays[0]?.innerText ?? '').toLowerCase();
          if (/cookie|consent|accept|gdpr|privacy/.test(overlayText)) {
            flags.push('consent_overlay');
          } else if (/subscribe|sign up to read|create.*account|paywall/.test(overlayText)) {
            flags.push('paywall_or_signup_wall');
          } else if (/verify (your )?age|are you 18|over 21/.test(overlayText)) {
            flags.push('age_gate');
          }
        }

        if (document.readyState !== 'complete') flags.push('not_ready');

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
          /search|results|query/i.test(location.search) ||
          document.querySelector('[role="search"]') !== null
        ) {
          kind = 'search-results';
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
