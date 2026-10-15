import { z } from 'zod';
import {
  type MarkdownSignals,
  candidateMarkdownUrls,
  contentNegotiationUrl,
  looksLikeMarkdown,
} from '../markdown-source';
import type { ExtractedRow, ExtractionMode } from '../types';

export const markdownConfigSchema = z.object({
  /** Pre-detected signals (from Doctor). Omit to re-detect at run time. */
  signals: z
    .object({
      alt_href: z.string().nullable(),
      affordance_href: z.string().nullable(),
      has_affordance: z.boolean(),
    })
    .optional(),
  /** A specific URL to fetch, bypassing detection (user override). */
  url: z.string().optional(),
});
export type MarkdownConfig = z.infer<typeof markdownConfigSchema>;

// KNOB MIRROR: a protective client-side ceiling on how much fetched text we
// pull into the panel — a safety cap, not an organization opinion. If product
// ever wants it tunable, promote to an app_config('matrx-extend') knob.
const MAX_BYTES = 5_000_000;

async function fetchMarkdown(
  url: string,
  useAcceptHeader: boolean,
): Promise<{ ok: boolean; body: string; contentType: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      ...(useAcceptHeader ? { headers: { Accept: 'text/markdown, text/x-markdown' } } : {}),
    });
    if (!res.ok) return { ok: false, body: '', contentType: null };
    const contentType = res.headers.get('content-type');
    const body = (await res.text()).slice(0, MAX_BYTES);
    return { ok: true, body, contentType };
  } catch {
    return { ok: false, body: '', contentType: null };
  }
}

/**
 * Markdown capture mode. Detects (or is handed) the page's clean-Markdown
 * source, fetches it extension-side (host permissions bypass CORS), and
 * returns it as a single row `{ source_url, chars, markdown }`. Never a
 * selector in sight — when a page offers Markdown, this is the best capture.
 */
export const markdownMode: ExtractionMode<MarkdownConfig> = {
  id: 'markdown',
  label: 'Markdown',
  description: 'Fetch the clean, LLM-ready Markdown version of this page when the site offers one.',
  configSchema: markdownConfigSchema,
  defaultConfig: () => ({}),

  // Availability is decided on the page from cheap signals; the sibling-.md /
  // llms.txt confirmation happens at run time (it needs a fetch).
  detectInPage: () => {
    const link = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="alternate"]'),
    ).some((l) => /text\/(?:x-)?markdown/i.test(l.getAttribute('type') ?? ''));
    return {
      available: true,
      summary: link
        ? 'This page declares a Markdown version — fetch it.'
        : 'Try fetching a Markdown version (sibling .md / llms.txt).',
    };
  },

  // In-page runner is unused (fetch is extension-side); keep a no-op so the
  // registry/catalog treat this as a real mode, not interactive-only.
  runInPage: () => [],

  runInExtension: async (tabId, config, documentId): Promise<ExtractedRow[]> => {
    const cfg = config ?? {};

    // Resolve the page URL + signals from the live tab unless overridden.
    let signals: MarkdownSignals = cfg.signals ?? {
      alt_href: null,
      affordance_href: null,
      has_affordance: false,
    };
    let pageUrl = cfg.url ?? '';
    if (!cfg.signals || !pageUrl) {
      const [probe] = await chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        func: () => ({
          href: location.href,
          signals: ((): MarkdownSignals => {
            // Inlined copy of detectMarkdownSignalsInPage — the func body must
            // be self-contained across the scripting boundary.
            const abs = (href: string | null | undefined): string | null => {
              if (!href) return null;
              try {
                return new URL(href, document.baseURI).href;
              } catch {
                return null;
              }
            };
            let altHref: string | null = null;
            for (const link of Array.from(
              document.querySelectorAll<HTMLLinkElement>('link[rel~="alternate"]'),
            )) {
              const type = (link.getAttribute('type') ?? '').toLowerCase();
              if (type === 'text/markdown' || type === 'text/x-markdown') {
                altHref = abs(link.getAttribute('href'));
                if (altHref) break;
              }
            }
            const RE =
              /\b(?:copy|open|view|read|get)\s+(?:this\s+)?(?:page\s+)?(?:as|in)\s+markdown\b|\bview\s+as\s+\.md\b|\bmarkdown\s+version\b/i;
            let affordanceHref: string | null = null;
            let hasAffordance = false;
            for (const el of Array.from(
              document.querySelectorAll<HTMLElement>('a[href], button, [role="button"]'),
            ).slice(0, 400)) {
              const label = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.trim();
              if (!label || !RE.test(label)) continue;
              hasAffordance = true;
              const href = el.getAttribute('href');
              if (href) {
                affordanceHref = abs(href);
                if (affordanceHref) break;
              }
            }
            return {
              alt_href: altHref,
              affordance_href: affordanceHref,
              has_affordance: hasAffordance,
            };
          })(),
        }),
      });
      const result = probe?.result as { href: string; signals: MarkdownSignals } | undefined;
      if (result) {
        if (!cfg.signals) signals = result.signals;
        if (!pageUrl) pageUrl = result.href;
      }
    }

    if (!pageUrl) throw new Error('Could not read the current page URL. Reload and try again.');

    const candidates = candidateMarkdownUrls(pageUrl, signals);
    const tried: string[] = [];
    for (const url of candidates) {
      tried.push(url);
      const { ok, body, contentType } = await fetchMarkdown(url, false);
      if (ok && looksLikeMarkdown(body, contentType)) {
        return [{ source_url: url, chars: body.length, markdown: body }];
      }
    }

    // Last resort: content-negotiation on the original URL.
    const negUrl = contentNegotiationUrl(pageUrl);
    if (negUrl && !tried.includes(negUrl)) {
      const { ok, body, contentType } = await fetchMarkdown(negUrl, true);
      if (ok && looksLikeMarkdown(body, contentType)) {
        return [{ source_url: negUrl, chars: body.length, markdown: body }];
      }
    }

    throw new Error(
      'No Markdown version found for this page. Tried the declared link, sibling .md, and llms.txt.',
    );
  },
};
