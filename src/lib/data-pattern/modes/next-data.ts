import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const nextDataConfigSchema = z.object({
  source: z.enum(['__NEXT_DATA__', '__NUXT_DATA__', '__NUXT__', 'apollo', 'redux']).optional(),
  key_path: z.string(),
});
export type NextDataConfig = z.infer<typeof nextDataConfigSchema>;

type ParsedSource = { source: string; data: unknown };

const parseSourcesInPage = (): ParsedSource[] => {
  const out: ParsedSource[] = [];
  const tryParse = (id: string, node: Element | null) => {
    if (!node?.textContent) return;
    try {
      out.push({ source: id, data: JSON.parse(node.textContent) });
    } catch {
      // skip
    }
  };
  tryParse('__NEXT_DATA__', document.getElementById('__NEXT_DATA__'));
  tryParse('__NUXT_DATA__', document.getElementById('__NUXT_DATA__'));
  // __NUXT__ is set on window, not always exposed in DOM. Check both forms.
  const nuxtEl = document.querySelector('script[data-nuxt-data]');
  tryParse('__NUXT__', nuxtEl);
  // Apollo state is sometimes embedded as <script id="__APOLLO_STATE__">.
  tryParse('apollo', document.getElementById('__APOLLO_STATE__'));
  return out;
};

export const nextDataMode: ExtractionMode<NextDataConfig> = {
  id: 'next_data',
  label: 'Framework',
  description:
    'Read embedded framework data (Next.js, Nuxt, Apollo). Pick a key path with the JSON tree to extract rows.',
  configSchema: nextDataConfigSchema,
  defaultConfig: () => ({ key_path: '' }),

  detectInPage: () => {
    const found: { source: string; size: number }[] = [];
    const checkJson = (id: string, node: Element | null) => {
      if (!node?.textContent) return;
      try {
        JSON.parse(node.textContent);
        found.push({ source: id, size: node.textContent.length });
      } catch {
        // skip
      }
    };
    checkJson('__NEXT_DATA__', document.getElementById('__NEXT_DATA__'));
    checkJson('__NUXT_DATA__', document.getElementById('__NUXT_DATA__'));
    checkJson('__APOLLO_STATE__', document.getElementById('__APOLLO_STATE__'));

    // LinkedIn Voyager hydration: <code id="bpr-guid-*"> blocks contain
    // typed entity payloads (Profile, Job, Company, etc.) in `included[]`.
    const bprBlocks = document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]');
    if (bprBlocks.length > 0) {
      let total = 0;
      let parsedCount = 0;
      for (const b of Array.from(bprBlocks)) {
        const txt = b.textContent ?? '';
        try {
          JSON.parse(txt);
          parsedCount++;
          total += txt.length;
        } catch {
          // skip
        }
      }
      if (parsedCount > 0) {
        found.push({ source: `bpr-guid (LinkedIn) ×${parsedCount}`, size: total });
      }
    }

    // Apollo state regex-extracted from inline <script> when not in #__APOLLO_STATE__.
    if (!document.getElementById('__APOLLO_STATE__')) {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
      );
      for (const s of scripts) {
        const t = s.textContent ?? '';
        if (!t.includes('apolloState') && !t.includes('__APOLLO_STATE__')) continue;
        const m = t.match(/(?:apolloState|__APOLLO_STATE__)["']?\s*[:=]\s*(\{[\s\S]+?\});?\s*$/m);
        if (m?.[1]) {
          try {
            JSON.parse(m[1]);
            found.push({ source: 'apollo (inline)', size: m[1].length });
            break;
          } catch {
            // skip
          }
        }
      }
    }

    if (found.length === 0) {
      return { available: false, summary: 'No embedded framework data' };
    }
    const summary = found.map((f) => `${f.source} (${(f.size / 1024).toFixed(1)} KB)`).join(', ');
    return {
      available: true,
      summary,
      count: found.length,
      meta: { sources: found },
    };
  },

  runInPage: (config) => {
    const cfg = config as { source?: string; key_path: string };

    const tryParse = (node: Element | null): unknown => {
      if (!node?.textContent) return undefined;
      try {
        return JSON.parse(node.textContent);
      } catch {
        return undefined;
      }
    };

    const sources: { id: string; data: unknown }[] = [];
    const candidates: [string, Element | null][] = [
      ['__NEXT_DATA__', document.getElementById('__NEXT_DATA__')],
      ['__NUXT_DATA__', document.getElementById('__NUXT_DATA__')],
      ['apollo', document.getElementById('__APOLLO_STATE__')],
    ];
    for (const [id, node] of candidates) {
      if (cfg.source && cfg.source !== id) continue;
      const data = tryParse(node);
      if (data !== undefined) sources.push({ id, data });
    }

    // LinkedIn bpr-guid hydration blocks. Aggregate all into one virtual
    // source for easier key-path navigation.
    if (!cfg.source || cfg.source === 'bpr-guid') {
      const blocks = Array.from(document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]'));
      const aggregated: Record<string, unknown> = {};
      let included: unknown[] = [];
      for (const b of blocks) {
        try {
          const parsed = JSON.parse(b.textContent ?? '') as Record<string, unknown>;
          aggregated[b.id] = parsed;
          if (Array.isArray(parsed.included)) {
            included = included.concat(parsed.included);
          }
        } catch {
          // skip
        }
      }
      if (Object.keys(aggregated).length > 0) {
        sources.push({
          id: 'bpr-guid',
          data: { blocks: aggregated, included },
        });
      }
    }

    // Apollo state regex-extracted from inline scripts.
    if ((!cfg.source || cfg.source === 'apollo') && !document.getElementById('__APOLLO_STATE__')) {
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
      );
      for (const s of scripts) {
        const t = s.textContent ?? '';
        if (!t.includes('apolloState') && !t.includes('__APOLLO_STATE__')) continue;
        const m = t.match(/(?:apolloState|__APOLLO_STATE__)["']?\s*[:=]\s*(\{[\s\S]+?\});?\s*$/m);
        if (m?.[1]) {
          try {
            sources.push({ id: 'apollo', data: JSON.parse(m[1]) });
            break;
          } catch {
            // skip
          }
        }
      }
    }

    const first = sources[0];
    if (!first) return [];

    let target: unknown = first.data;
    if (cfg.key_path) {
      for (const part of cfg.key_path.split('.')) {
        if (target == null || typeof target !== 'object') break;
        target = (target as Record<string, unknown>)[part];
      }
    }

    if (Array.isArray(target)) return target as Record<string, unknown>[];
    if (target && typeof target === 'object') return [target as Record<string, unknown>];
    if (target != null) return [{ value: target }];
    return [];
  },
};

// Also export a helper used by the Framework tab UI to get the full parsed
// data tree for the JSON-tree picker. Lives here to keep the in-page parsing
// in one place.
export const nextDataInPageDump = parseSourcesInPage;
