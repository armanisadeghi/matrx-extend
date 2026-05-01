/**
 * Centralized CopyOption[] builders for everything a Scrape capture exposes.
 * Every CopyMenu in the Scrape tab pulls from here so the available formats
 * are identical across sections — no more hand-rolling the same five options
 * in six different JSX blocks.
 *
 * Each builder returns a complete option set in a stable order:
 *   1. Markdown — the .md text rendered by MarkdownView
 *   2. Plain text — markdown stripped, for non-md targets
 *   3. (For lists) URL list — one per line
 *   4. For AI — wrapped with source context
 *   5. JSON (admin) — raw underlying object
 *   6. JSON for AI (admin) — wrapped JSON
 */

import type { CopyOption } from '@/components/CopyMenu';
import {
  stringifyJson,
  wrapForAgent,
  wrapJsonForAgent,
} from '@/lib/clipboard/copy';
import type { SoupResult } from '@/lib/scrape/pipeline';
import {
  articleToMarkdown,
  articleToPlainText,
  fullCaptureToMarkdown,
  fullCaptureToPlainText,
  imagesToList,
  imagesToMarkdown,
  linksToList,
  linksToMarkdown,
  schemaToMarkdown,
  seoToMarkdown,
  videosToList,
  videosToMarkdown,
} from '@/lib/scrape/to-markdown';
import { markdownToPlainText } from '@/lib/scrape/to-markdown';

const sourceFor = (soup: SoupResult) => ({
  url: soup.url || null,
  title: soup.article.title ?? soup.metadata.title ?? null,
  capturedAt: soup.capturedAt,
});

/* ------------------------------------------------------------------ */
/* Article                                                            */
/* ------------------------------------------------------------------ */

export function articleCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      description: 'Article with title, byline, content',
      getContent: () => articleToMarkdown(soup),
    },
    {
      label: 'Plain text',
      description: 'Markdown stripped',
      getContent: () => articleToPlainText(soup),
    },
    {
      label: 'For AI agent',
      ai: true,
      description: 'Markdown + source context',
      getContent: () =>
        wrapForAgent({
          description: 'an article scraped from a webpage',
          source: sourceFor(soup),
          meta: {
            wordCount: soup.article.word_count,
            readingTimeMinutes: soup.article.reading_time_minutes,
            extractor: soup.article.extractor,
          },
          format: 'markdown',
          content: articleToMarkdown(soup),
        }),
    },
    {
      label: 'HTML (cleaned)',
      adminOnly: true,
      getContent: () => soup.article.content_html_safe ?? '',
    },
    {
      label: 'Article (JSON)',
      adminOnly: true,
      getContent: () => stringifyJson(soup.article),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Images                                                             */
/* ------------------------------------------------------------------ */

export function imagesCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      description: 'Image list with alt + dimensions',
      getContent: () => imagesToMarkdown(soup),
    },
    {
      label: 'URLs (one per line)',
      getContent: () => imagesToList(soup),
    },
    {
      label: 'For AI agent',
      ai: true,
      getContent: () =>
        wrapForAgent({
          description: 'a list of images extracted from a webpage',
          source: sourceFor(soup),
          meta: { count: soup.images.length },
          format: 'markdown',
          content: imagesToMarkdown(soup),
        }),
    },
    {
      label: 'JSON',
      adminOnly: true,
      getContent: () => stringifyJson(soup.images),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Videos                                                             */
/* ------------------------------------------------------------------ */

export function videosCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      getContent: () => videosToMarkdown(soup),
    },
    {
      label: 'URLs (one per line)',
      getContent: () => videosToList(soup),
    },
    {
      label: 'For AI agent',
      ai: true,
      getContent: () =>
        wrapForAgent({
          description: 'a list of video sources extracted from a webpage',
          source: sourceFor(soup),
          meta: { count: soup.videos.length },
          format: 'markdown',
          content: videosToMarkdown(soup),
        }),
    },
    {
      label: 'JSON',
      adminOnly: true,
      getContent: () => stringifyJson(soup.videos),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Links                                                              */
/* ------------------------------------------------------------------ */

export function linksCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      description: 'Numbered, with anchor text',
      getContent: () => linksToMarkdown(soup),
    },
    {
      label: 'URLs (one per line)',
      getContent: () => linksToList(soup),
    },
    {
      label: 'For AI agent',
      ai: true,
      getContent: () =>
        wrapForAgent({
          description: 'a list of links extracted from a webpage',
          source: sourceFor(soup),
          meta: { count: soup.links.length },
          format: 'markdown',
          content: linksToMarkdown(soup),
        }),
    },
    {
      label: 'JSON',
      adminOnly: true,
      getContent: () => stringifyJson(soup.links),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* SEO                                                                */
/* ------------------------------------------------------------------ */

export function seoCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      getContent: () => seoToMarkdown(soup),
    },
    {
      label: 'Plain text',
      getContent: () => markdownToPlainText(seoToMarkdown(soup)),
    },
    {
      label: 'For AI agent',
      ai: true,
      getContent: () =>
        wrapForAgent({
          description: 'an SEO audit for a webpage',
          source: sourceFor(soup),
          format: 'markdown',
          content: seoToMarkdown(soup),
        }),
    },
    {
      label: 'JSON',
      adminOnly: true,
      getContent: () => stringifyJson(soup.seo),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Schema / metadata                                                  */
/* ------------------------------------------------------------------ */

export function schemaCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      description: 'Metadata + JSON-LD as fenced JSON',
      getContent: () => schemaToMarkdown(soup),
    },
    {
      label: 'JSON',
      getContent: () =>
        stringifyJson({ metadata: soup.metadata, ld_json: soup.ld_json }),
    },
    {
      label: 'For AI agent',
      ai: true,
      getContent: () =>
        wrapJsonForAgent(
          { metadata: soup.metadata, ld_json: soup.ld_json },
          {
            description: 'metadata + JSON-LD schema extracted from a webpage',
            source: sourceFor(soup),
          },
        ),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Full capture                                                       */
/* ------------------------------------------------------------------ */

export function fullCaptureCopyOptions(soup: SoupResult): CopyOption[] {
  return [
    {
      label: 'Markdown',
      description: 'Article + images + links + SEO + schema',
      getContent: () => fullCaptureToMarkdown(soup),
    },
    {
      label: 'Plain text',
      description: 'Everything, markdown stripped',
      getContent: () => fullCaptureToPlainText(soup),
    },
    {
      label: 'Page URL',
      getContent: () => soup.url || '',
    },
    {
      label: 'For AI agent',
      ai: true,
      description: 'Full capture as markdown',
      getContent: () =>
        wrapForAgent({
          description: 'a full Matrx scrape result for a webpage',
          source: sourceFor(soup),
          meta: {
            wordCount: soup.article.word_count,
            images: soup.images.length,
            videos: soup.videos.length,
            links: soup.links.length,
          },
          format: 'markdown',
          content: fullCaptureToMarkdown(soup),
        }),
    },
    {
      label: 'Full capture (JSON)',
      description: 'Article + media + schema',
      adminOnly: true,
      getContent: () => stringifyJson(soup),
    },
    {
      label: 'Full capture for AI (JSON)',
      ai: true,
      adminOnly: true,
      getContent: () =>
        wrapJsonForAgent(soup, {
          description: 'the full Matrx scrape result for a webpage',
          source: sourceFor(soup),
        }),
    },
  ];
}
