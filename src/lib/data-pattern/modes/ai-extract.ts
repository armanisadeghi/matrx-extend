import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const aiExtractConfigSchema = z.object({
  description: z.string(),
  output_schema: z.unknown(),
  agent_id: z.string(),
});
export type AiExtractConfig = z.infer<typeof aiExtractConfigSchema>;

/**
 * AI Extract is special: it's not pure DOM extraction. The actual run happens
 * server-side via a backend agent. The runInPage here just captures the page
 * text the agent will use — the showcase tab orchestrates the full call via
 * useAiExtraction and surfaces the rows directly.
 *
 * Saved patterns of this kind are re-run by the backend cron worker, which
 * reads {description, output_schema, agent_id} from config and invokes the
 * extractor agent against a freshly-rendered page snapshot.
 */
export const aiExtractMode: ExtractionMode<AiExtractConfig> = {
  id: 'ai_extract',
  label: 'AI Extract',
  description: 'Describe what you want; an extractor agent returns structured rows.',
  configSchema: aiExtractConfigSchema,
  defaultConfig: () => ({ description: '', output_schema: {}, agent_id: '' }),

  detectInPage: () => ({ available: true, summary: 'AI extraction is always available' }),

  // Stub — the showcase orchestrates the agent call directly. This runInPage
  // is reserved for the backend re-run flow and intentionally returns nothing.
  runInPage: () => [],
  interactiveOnly: true,
};

/**
 * Captures up to ~50KB of visible page text. Used by the AI Extract tab to
 * build the agent payload without round-tripping through the heavier scrape
 * pipeline. The 50KB cap keeps token costs predictable.
 */
export const aiExtractCapturePage = (): {
  url: string;
  title: string;
  page_text: string;
  page_metadata: Record<string, unknown>;
} => {
  const collectMeta = (attr: 'property' | 'name', prefix: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const sel = `meta[${attr}^="${prefix}"]`;
    for (const m of Array.from(document.querySelectorAll<HTMLMetaElement>(sel))) {
      const raw = m.getAttribute(attr);
      if (!raw) continue;
      const key = raw.slice(prefix.length);
      if (key) out[key] = m.getAttribute('content') ?? '';
    }
    return out;
  };

  const og = collectMeta('property', 'og:');
  const twitter = collectMeta('name', 'twitter:');

  const jsonLd: unknown[] = [];
  for (const s of Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )) {
    try {
      jsonLd.push(JSON.parse(s.textContent ?? ''));
    } catch {
      // skip
    }
  }

  const main = document.querySelector('main, article, [role="main"]') ?? document.body;
  const raw = ((main as HTMLElement)?.innerText ?? document.body.innerText ?? '').trim();
  const page_text = raw.slice(0, 50_000);

  return {
    url: location.href,
    title: document.title || '',
    page_text,
    page_metadata: {
      description:
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
      author: document.querySelector('meta[name="author"]')?.getAttribute('content') ?? null,
      lang: document.documentElement.getAttribute('lang') ?? null,
      og: Object.keys(og).length ? og : null,
      twitter: Object.keys(twitter).length ? twitter : null,
      json_ld: jsonLd.length ? jsonLd : null,
      truncated: raw.length > 50_000,
    },
  };
};
