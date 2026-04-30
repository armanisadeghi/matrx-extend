import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const ogMetaConfigSchema = z.object({});
export type OgMetaConfig = z.infer<typeof ogMetaConfigSchema>;

export const ogMetaMode: ExtractionMode<OgMetaConfig> = {
  id: 'og_meta',
  label: 'Snapshot',
  description:
    'One-shot snapshot: title, description, OG tags, Twitter card, JSON-LD, canonical, language.',
  configSchema: ogMetaConfigSchema,
  defaultConfig: () => ({}),

  detectInPage: () => ({ available: true, summary: 'Always available' }),

  runInPage: () => {
    const out: Record<string, unknown> = {};

    out.title = document.title || null;
    out.url = location.href;
    out.canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
    out.lang = document.documentElement.getAttribute('lang') ?? null;
    out.description =
      document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null;
    out.author = document.querySelector('meta[name="author"]')?.getAttribute('content') ?? null;
    out.viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null;
    out.theme_color =
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

    const collectByPrefix = (attr: 'property' | 'name', prefix: string): Record<string, string> => {
      const result: Record<string, string> = {};
      const sel = `meta[${attr}^="${prefix}"]`;
      for (const m of Array.from(document.querySelectorAll<HTMLMetaElement>(sel))) {
        const raw = m.getAttribute(attr);
        if (!raw) continue;
        const key = raw.slice(prefix.length);
        if (!key) continue;
        result[key] = m.getAttribute('content') ?? '';
      }
      return result;
    };

    const og = collectByPrefix('property', 'og:');
    const twitter = collectByPrefix('name', 'twitter:');
    const article = collectByPrefix('property', 'article:');

    if (Object.keys(og).length > 0) out.og = og;
    if (Object.keys(twitter).length > 0) out.twitter = twitter;
    if (Object.keys(article).length > 0) out.article = article;

    const jsonLd: unknown[] = [];
    for (const s of Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    )) {
      try {
        jsonLd.push(JSON.parse(s.textContent ?? ''));
      } catch {
        // skip malformed
      }
    }
    if (jsonLd.length > 0) out.json_ld = jsonLd;

    const favicon =
      document.querySelector('link[rel="icon"]')?.getAttribute('href') ??
      document.querySelector('link[rel="shortcut icon"]')?.getAttribute('href') ??
      null;
    if (favicon) {
      try {
        out.favicon = new URL(favicon, location.href).toString();
      } catch {
        out.favicon = favicon;
      }
    }

    return [out];
  },
};
