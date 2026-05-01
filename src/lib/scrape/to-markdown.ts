/**
 * Centralized content-to-markdown converters for everything we extract from
 * a webpage capture. One source of truth so:
 *   - The Scrape tab's display, the clipboard copies, the chat-context paste,
 *     and any future export all produce identical text.
 *   - Adding a new field (e.g. publication date) means editing one file.
 *
 * Pure functions only. No React, no DOM. Safe to call from any context.
 *
 * Naming:
 *   - sectionToMarkdown(soup) — full markdown document for one tab/section
 *   - sectionToPlainText(soup) — markdown stripped, for non-md targets
 *   - markdownToPlainText(md) — generic stripper (for callers who already have md)
 */

import type { SoupResult } from '@/lib/scrape/pipeline';
import type { SeoAudit } from '@/lib/seo/audit';

const HR = '\n\n---\n\n';

/* ------------------------------------------------------------------ */
/* Article                                                            */
/* ------------------------------------------------------------------ */

export function articleToMarkdown(soup: SoupResult): string {
  const a = soup.article;
  const lines: string[] = [];
  if (a.title) lines.push(`# ${a.title}`);
  const meta = articleMetaLine(soup);
  if (meta) lines.push(`*${meta}*`);
  if (a.excerpt) lines.push(`> ${a.excerpt}`);
  if (a.content_markdown) lines.push(cleanArticleMarkdown(a.content_markdown).trim());
  else lines.push('_No clean article extracted._');
  return lines.join('\n\n');
}

/**
 * Post-process article markdown to fix common HTML→md conversion artifacts.
 * Conservative — every transform matches what a CommonMark renderer would
 * already display.
 *
 * Three patterns we handle:
 *
 *   1. Multi-line link text (calendar badges, button labels):
 *        [\n\nMay\n\n12\n\n](url)  →  [May 12](url)
 *      CommonMark treats newlines in link text as soft breaks (rendered as
 *      a single space), so collapsing makes the source match the render.
 *
 *   2. Empty link shells:
 *        [   ](url)  →  url
 *
 *   3. Card-wrapping `<a>` (NYT-style story cards, big nav cards):
 *        [headline + summary + ![alt](img)](url)
 *      becomes
 *        headline + summary + ![alt](img)
 *
 *        [Read more →](url)
 *      The original markdown is *technically valid* but renders poorly:
 *      the entire card visually becomes one giant link, an embedded image
 *      lives inside the link text, and the summary loses paragraph breaks.
 *      Unwrapping preserves all information (image, text, URL) and lets the
 *      reader actually read the card.
 *
 * Trigger for case 3: link text contains an `![…](…)` image. That marker
 * reliably distinguishes "wraps a block of content" from "labels a phrase".
 *
 * The raw `SoupResult.article.content_markdown` is *not* mutated — only the
 * display + copy path runs through this. Anything that reads the raw field
 * directly is unaffected.
 */
export function cleanArticleMarkdown(md: string): string {
  if (!md) return md;

  // Pass 1 — collapse whitespace in image alt text (independent of links).
  let out = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
    const collapsed = alt.replace(/\s+/g, ' ').trim();
    return `![${collapsed}](${url})`;
  });

  // Pass 2 — process links. Allow link text to contain a complete image
  // syntax (otherwise the image's `]` ends our match early and card-style
  // wrappers slip through). The image alternative is listed *first* so the
  // engine prefers it over the single-char `[^\[\]]` fallback.
  const linkRe = /\[((?:!\[[^\]]*\]\([^)]+\)|[^\[\]])*)\]\(([^)]+)\)/g;
  out = out.replace(linkRe, (_m, text: string, url: string) => {
    const trimmed = text.trim();
    if (!trimmed) return url;

    const hasNestedImage = /!\[[^\]]*\]\([^)]+\)/.test(trimmed);

    if (!hasNestedImage) {
      // Standard inline link — collapse whitespace (matches CommonMark render).
      const collapsed = trimmed.replace(/\s+/g, ' ');
      if (collapsed === url) return url;
      return `[${collapsed}](${url})`;
    }

    // Card-wrapping <a>. Unwrap: keep paragraphs (split on blank lines),
    // collapse internal whitespace within each paragraph, and append a
    // "Read more" link so the original URL stays one click away.
    const paragraphs = trimmed
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return `${paragraphs.join('\n\n')}\n\n[Read more →](${url})`;
  });

  return out;
}

function articleMetaLine(soup: SoupResult): string | null {
  const a = soup.article;
  const parts: string[] = [];
  if (a.byline) parts.push(`By ${a.byline}`);
  if (soup.url) parts.push(soup.url);
  if (a.word_count != null) parts.push(`${a.word_count} words`);
  if (a.reading_time_minutes != null) parts.push(`${a.reading_time_minutes} min read`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/* ------------------------------------------------------------------ */
/* Images                                                             */
/* ------------------------------------------------------------------ */

export function imagesToMarkdown(soup: SoupResult): string {
  if (soup.images.length === 0) return '_No images on this page._';
  const lines = [`## Images (${soup.images.length})`, ''];
  for (const img of soup.images) {
    const alt = img.alt ? img.alt.replace(/[\[\]]/g, '') : '';
    lines.push(`- ![${alt}](${img.src})`);
    if (img.alt) lines.push(`  - alt: ${img.alt}`);
    if (img.width && img.height) lines.push(`  - ${img.width}×${img.height}`);
  }
  return lines.join('\n');
}

export function imagesToList(soup: SoupResult): string {
  return soup.images.map((i) => i.src).join('\n');
}

/* ------------------------------------------------------------------ */
/* Videos                                                             */
/* ------------------------------------------------------------------ */

export function videosToMarkdown(soup: SoupResult): string {
  if (soup.videos.length === 0) return '_No videos on this page._';
  const lines = [`## Videos (${soup.videos.length})`, ''];
  for (const v of soup.videos) {
    lines.push(`- ${v.src}`);
    if (v.poster) lines.push(`  - poster: ${v.poster}`);
    if (v.duration != null) lines.push(`  - duration: ${v.duration}s`);
  }
  return lines.join('\n');
}

export function videosToList(soup: SoupResult): string {
  return soup.videos.map((v) => v.src).join('\n');
}

/* ------------------------------------------------------------------ */
/* Links                                                              */
/* ------------------------------------------------------------------ */

export function linksToMarkdown(soup: SoupResult): string {
  if (soup.links.length === 0) return '_No links on this page._';
  const lines = [`## Links (${soup.links.length})`, ''];
  for (const l of soup.links) {
    const text = l.text || l.href;
    lines.push(`- [${text}](${l.href})`);
  }
  return lines.join('\n');
}

export function linksToList(soup: SoupResult): string {
  return soup.links.map((l) => l.href).join('\n');
}

/* ------------------------------------------------------------------ */
/* SEO                                                                */
/* ------------------------------------------------------------------ */

export function seoToMarkdown(soup: SoupResult): string {
  return seoAuditToMarkdown(soup.seo, soup.url);
}

export function seoAuditToMarkdown(seo: SeoAudit, url: string | null): string {
  const lines: string[] = ['## SEO audit', ''];
  if (url) lines.push(`**URL:** ${url}`);
  lines.push(`**Title** *(${seo.title.length} chars)* — ${seo.title.value || '—'}`);
  lines.push(
    `**Description** *(${seo.description.length} chars)* — ${seo.description.value ?? '—'}`,
  );
  lines.push(`**Canonical:** ${seo.canonical ?? '—'}`);
  lines.push(`**Robots:** ${seo.robots ?? '—'}`);

  if (seo.hreflang.length > 0) {
    lines.push('', `### Hreflang (${seo.hreflang.length})`);
    for (const h of seo.hreflang) lines.push(`- \`${h.lang}\` → ${h.href}`);
  }

  if (seo.schema_types.length > 0) {
    lines.push('', `### Schema types`, seo.schema_types.map((t) => `\`${t}\``).join(' '));
  }

  if (seo.headings.length > 0) {
    lines.push('', `### Headings (${seo.headings.length})`);
    for (const h of seo.headings.slice(0, 50)) lines.push(`- **H${h.level}:** ${h.text}`);
    if (seo.headings.length > 50) lines.push(`- _…+${seo.headings.length - 50} more_`);
  }

  lines.push('', '### Page stats');
  lines.push(`- Images: ${seo.images.total} (missing alt: ${seo.images.missing_alt})`);
  lines.push(`- Words: ${seo.word_count}`);
  lines.push(`- Internal links: ${seo.links.internal}`);
  lines.push(`- External links: ${seo.links.external}`);
  if (seo.flesch_reading_ease !== null) {
    lines.push(`- Flesch reading ease: ${seo.flesch_reading_ease}`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Schema / metadata                                                  */
/* ------------------------------------------------------------------ */

export function schemaToMarkdown(soup: SoupResult): string {
  const lines: string[] = ['## Metadata & schema', ''];
  lines.push('```json');
  lines.push(JSON.stringify({ metadata: soup.metadata, ld_json: soup.ld_json }, null, 2));
  lines.push('```');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Full capture                                                       */
/* ------------------------------------------------------------------ */

export function fullCaptureToMarkdown(soup: SoupResult): string {
  return [
    articleToMarkdown(soup),
    imagesToMarkdown(soup),
    videosToMarkdown(soup),
    linksToMarkdown(soup),
    seoToMarkdown(soup),
    schemaToMarkdown(soup),
  ].join(HR);
}

/* ------------------------------------------------------------------ */
/* Plain text                                                         */
/* ------------------------------------------------------------------ */

/**
 * Strip markdown formatting characters for plain-text targets (Slack, email).
 *
 * Information-preserving: link URLs and image URLs are *kept*, surfaced as
 * `text (url)` after the visible text. Earlier versions silently dropped the
 * URL — that lost data the user might paste somewhere that doesn't render
 * markdown.
 *
 * Bullets keep their indentation depth so nested lists stay readable.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|\n?```$/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
      const t = alt.replace(/\s+/g, ' ').trim();
      return t ? `${t} (${url})` : url;
    })
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!t || t === url) return url;
      return `${t} (${url})`;
    })
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^([ \t]*)[-*+]\s+/gm, '$1• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const articleToPlainText = (soup: SoupResult) =>
  markdownToPlainText(articleToMarkdown(soup));
export const fullCaptureToPlainText = (soup: SoupResult) =>
  markdownToPlainText(fullCaptureToMarkdown(soup));
