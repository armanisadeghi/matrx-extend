/**
 * Scrape pipeline. Runs in the content script (has DOM).
 *
 * Order of operations:
 *   1. Try Defuddle (modern SPA-aware article extractor)
 *   2. Fall back to @mozilla/readability if defuddle isn't confident
 *   3. DOMPurify the article content
 *   4. Turndown → markdown
 *   5. Collect metadata, images, videos, links, audio, JSON-LD
 *
 * Returns a normalized SoupResult with everything the side panel needs.
 */

import {
  type CollectedAudio,
  type CollectedImage,
  type CollectedLink,
  type CollectedMetadata,
  type CollectedVideo,
  collectAudio,
  collectImages,
  collectJsonLd,
  collectLinks,
  collectMetadata,
  collectVideos,
} from '@/lib/scrape/collectors';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

export interface SoupResult {
  url: string;
  capturedAt: number;
  metadata: CollectedMetadata;
  article: {
    title: string | null;
    byline: string | null;
    content_html_safe: string | null;
    content_markdown: string | null;
    excerpt: string | null;
    extractor: 'defuddle' | 'readability' | 'fallback';
    word_count: number | null;
    reading_time_minutes: number | null;
  };
  images: CollectedImage[];
  videos: CollectedVideo[];
  audio: CollectedAudio[];
  links: CollectedLink[];
  ld_json: unknown[];
  raw_html_size: number;
}

export interface ScrapeOptions {
  preferDefuddle: boolean;
  includeImages: boolean;
  includeVideos: boolean;
  includeLinks: boolean;
  includeStructured: boolean;
}

const DEFAULT_OPTS: ScrapeOptions = {
  preferDefuddle: true,
  includeImages: true,
  includeVideos: true,
  includeLinks: true,
  includeStructured: true,
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
turndown.use(gfm);

export async function runScrape(
  doc: Document = document,
  opts: Partial<ScrapeOptions> = {},
): Promise<SoupResult> {
  const o = { ...DEFAULT_OPTS, ...opts };

  const metadata = collectMetadata();
  const article = await extractArticle(doc, o.preferDefuddle);

  return {
    url: doc.location?.href ?? '',
    capturedAt: Date.now(),
    metadata,
    article,
    images: o.includeImages ? collectImages() : [],
    videos: o.includeVideos ? collectVideos() : [],
    audio: o.includeImages ? collectAudio() : [],
    links: o.includeLinks ? collectLinks() : [],
    ld_json: o.includeStructured ? collectJsonLd() : [],
    raw_html_size: doc.documentElement.outerHTML.length,
  };
}

async function extractArticle(
  doc: Document,
  preferDefuddle: boolean,
): Promise<SoupResult['article']> {
  if (preferDefuddle) {
    try {
      const result = await defuddleExtract(doc);
      if (result) return result;
    } catch (err) {
      console.warn('[matrx-extend] defuddle failed, falling back to readability', err);
    }
  }

  const result = readabilityExtract(doc);
  if (result) return result;

  return {
    title: doc.title || null,
    byline: null,
    content_html_safe: null,
    content_markdown: null,
    excerpt: null,
    extractor: 'fallback',
    word_count: null,
    reading_time_minutes: null,
  };
}

async function defuddleExtract(doc: Document): Promise<SoupResult['article'] | null> {
  // Lazy-import so the pipeline pays for it only when used (defuddle pulls
  // additional grammar packs). The default export's API: new Defuddle(doc).parse() → { title, content, ... }
  const mod = await import('defuddle');
  // Defuddle ships both a class and helper. We use the class for richer output.
  const DefuddleCtor = (
    mod as unknown as { default: new (d: Document) => { parse: () => unknown } }
  ).default;
  if (!DefuddleCtor) return null;
  const inst = new DefuddleCtor(doc);
  const parsed = inst.parse() as
    | {
        title?: string;
        author?: string;
        content?: string;
        description?: string;
        wordCount?: number;
      }
    | null
    | undefined;
  if (!parsed?.content) return null;
  const safe = DOMPurify.sanitize(parsed.content, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style'],
  });
  const md = turndown.turndown(safe);
  const wc = parsed.wordCount ?? md.split(/\s+/).filter(Boolean).length;
  return {
    title: parsed.title ?? doc.title ?? null,
    byline: parsed.author ?? null,
    content_html_safe: safe,
    content_markdown: md,
    excerpt: parsed.description ?? null,
    extractor: 'defuddle',
    word_count: wc,
    reading_time_minutes: Math.max(1, Math.round(wc / 220)),
  };
}

function readabilityExtract(doc: Document): SoupResult['article'] | null {
  // Clone — Readability mutates the document.
  const cloned = doc.cloneNode(true) as Document;
  if (!isProbablyReaderable(cloned)) return null;
  const reader = new Readability(cloned);
  const parsed = reader.parse();
  if (!parsed) return null;
  const safe = DOMPurify.sanitize(parsed.content ?? '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style'],
  });
  const md = turndown.turndown(safe);
  const wc = parsed.length ? Math.round(parsed.length / 5) : md.split(/\s+/).filter(Boolean).length;
  return {
    title: parsed.title ?? doc.title ?? null,
    byline: parsed.byline ?? null,
    content_html_safe: safe,
    content_markdown: md,
    excerpt: parsed.excerpt ?? null,
    extractor: 'readability',
    word_count: wc,
    reading_time_minutes: Math.max(1, Math.round(wc / 220)),
  };
}
