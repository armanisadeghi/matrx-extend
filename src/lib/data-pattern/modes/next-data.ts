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
    const check = (id: string, node: Element | null) => {
      if (!node?.textContent) return;
      try {
        JSON.parse(node.textContent);
        found.push({ source: id, size: node.textContent.length });
      } catch {
        // skip
      }
    };
    check('__NEXT_DATA__', document.getElementById('__NEXT_DATA__'));
    check('__NUXT_DATA__', document.getElementById('__NUXT_DATA__'));
    check('__APOLLO_STATE__', document.getElementById('__APOLLO_STATE__'));

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
