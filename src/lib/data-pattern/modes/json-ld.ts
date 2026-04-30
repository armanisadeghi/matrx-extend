import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const jsonLdConfigSchema = z.object({
  ld_type: z.string().optional(),
});
export type JsonLdConfig = z.infer<typeof jsonLdConfigSchema>;

export const jsonLdMode: ExtractionMode<JsonLdConfig> = {
  id: 'json_ld',
  label: 'JSON-LD',
  description:
    'Extract structured data already embedded as <script type="application/ld+json">. Best on events, products, recipes, articles.',
  configSchema: jsonLdConfigSchema,
  defaultConfig: () => ({}),

  detectInPage: (config) => {
    const cfg = (config ?? {}) as { ld_type?: string };
    const blocks = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    );
    if (blocks.length === 0) {
      return { available: false, summary: 'No JSON-LD on this page' };
    }

    const types = new Map<string, number>();
    const flatten = (item: unknown): void => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) {
        for (const i of item) flatten(i);
        return;
      }
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj['@graph'])) {
        for (const g of obj['@graph']) flatten(g);
        return;
      }
      const t = obj['@type'];
      const names = Array.isArray(t) ? (t as string[]) : t ? [String(t)] : ['(untyped)'];
      for (const n of names) types.set(n, (types.get(n) ?? 0) + 1);
    };

    for (const b of blocks) {
      try {
        flatten(JSON.parse(b.textContent ?? ''));
      } catch {
        // skip malformed
      }
    }

    let summary: string;
    if (cfg.ld_type) {
      const c = types.get(cfg.ld_type) ?? 0;
      summary = `${c} ${cfg.ld_type} block${c === 1 ? '' : 's'}`;
    } else {
      const parts = Array.from(types.entries())
        .map(([t, n]) => `${n} ${t}`)
        .join(', ');
      summary = `${blocks.length} block${blocks.length === 1 ? '' : 's'}: ${parts}`;
    }

    let total = 0;
    for (const n of types.values()) total += n;
    return {
      available: true,
      summary,
      count: cfg.ld_type ? (types.get(cfg.ld_type) ?? 0) : total,
      meta: { types: Object.fromEntries(types) },
    };
  },

  runInPage: (config) => {
    const cfg = config as { ld_type?: string };
    const blocks = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    );
    const rows: Record<string, unknown>[] = [];

    const matches = (item: Record<string, unknown>): boolean => {
      if (!cfg.ld_type) return true;
      const t = item['@type'];
      if (Array.isArray(t)) return (t as unknown[]).includes(cfg.ld_type);
      return t === cfg.ld_type;
    };

    const flatten = (item: unknown): void => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) {
        for (const i of item) flatten(i);
        return;
      }
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj['@graph'])) {
        for (const g of obj['@graph']) flatten(g);
        return;
      }
      if (matches(obj)) rows.push(obj);
    };

    for (const b of blocks) {
      try {
        flatten(JSON.parse(b.textContent ?? ''));
      } catch {
        // skip malformed
      }
    }

    return rows;
  },
};
