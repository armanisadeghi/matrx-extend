import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const microdataConfigSchema = z.object({
  itemtype: z.string().optional(),
});
export type MicrodataConfig = z.infer<typeof microdataConfigSchema>;

/**
 * Schema.org microdata extractor. Reads [itemscope][itemtype] blocks and
 * descendant [itemprop] children, returning one row per top-level itemscope.
 *
 * Best surface for: Yelp (Restaurant, Review, AggregateRating), Amazon
 * (Product, Offer), recipe sites (Recipe, NutritionInformation), local
 * directories (LocalBusiness).
 */
export const microdataMode: ExtractionMode<MicrodataConfig> = {
  id: 'microdata',
  label: 'Microdata',
  description:
    'Schema.org microdata: reads [itemscope][itemtype] blocks. Best on Yelp, Amazon, recipes, local business sites.',
  configSchema: microdataConfigSchema,
  defaultConfig: () => ({}),

  detectInPage: (config) => {
    const cfg = (config ?? {}) as { itemtype?: string };
    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[itemscope][itemtype]'),
    );
    const topLevel = items.filter((el) => !el.parentElement?.closest('[itemscope]'));
    if (topLevel.length === 0) {
      return { available: false, summary: 'No microdata on this page' };
    }
    const types = new Map<string, number>();
    for (const el of topLevel) {
      const t = el.getAttribute('itemtype') ?? '';
      const short = t.split('/').pop() ?? t;
      types.set(short, (types.get(short) ?? 0) + 1);
    }
    let summary: string;
    if (cfg.itemtype) {
      const c = types.get(cfg.itemtype) ?? 0;
      summary = `${c} ${cfg.itemtype} item${c === 1 ? '' : 's'}`;
    } else {
      const parts = Array.from(types.entries())
        .map(([t, n]) => `${n} ${t}`)
        .join(', ');
      summary = `${topLevel.length} items: ${parts}`;
    }
    return {
      available: true,
      summary,
      count: cfg.itemtype ? (types.get(cfg.itemtype) ?? 0) : topLevel.length,
      meta: { types: Object.fromEntries(types) },
    };
  },

  runInPage: (config) => {
    const cfg = config as { itemtype?: string };

    const readPropValue = (el: Element): string | null => {
      const t = el.tagName.toUpperCase();
      // Element-specific attribute reads per Schema.org microdata spec.
      if (t === 'META') return el.getAttribute('content');
      if (t === 'IMG' || t === 'AUDIO' || t === 'VIDEO' || t === 'SOURCE')
        return el.getAttribute('src');
      if (t === 'A' || t === 'AREA' || t === 'LINK') return el.getAttribute('href');
      if (t === 'OBJECT') return el.getAttribute('data');
      if (t === 'TIME') return el.getAttribute('datetime') ?? (el as HTMLElement).innerText.trim();
      if (t === 'DATA' || t === 'METER') return el.getAttribute('value');
      return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
    };

    const extractItem = (root: HTMLElement): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      const itemtype = root.getAttribute('itemtype');
      if (itemtype) out['@type'] = itemtype.split('/').pop() ?? itemtype;
      const itemid = root.getAttribute('itemid');
      if (itemid) out['@id'] = itemid;

      // Find descendant itemprops that aren't inside a NESTED itemscope
      // (those belong to that nested item, recursed below).
      const props = Array.from(root.querySelectorAll<HTMLElement>('[itemprop]')).filter(
        (el) => {
          let p = el.parentElement;
          while (p && p !== root) {
            if (p.hasAttribute('itemscope')) return false;
            p = p.parentElement;
          }
          return true;
        },
      );

      for (const el of props) {
        const propsAttr = el.getAttribute('itemprop');
        if (!propsAttr) continue;
        const names = propsAttr.split(/\s+/);
        const value: unknown = el.hasAttribute('itemscope')
          ? extractItem(el)
          : readPropValue(el);
        for (const name of names) {
          if (out[name] === undefined) {
            out[name] = value;
          } else if (Array.isArray(out[name])) {
            (out[name] as unknown[]).push(value);
          } else {
            out[name] = [out[name], value];
          }
        }
      }
      return out;
    };

    const items = Array.from(
      document.querySelectorAll<HTMLElement>('[itemscope][itemtype]'),
    ).filter((el) => !el.parentElement?.closest('[itemscope]'));

    const filtered = cfg.itemtype
      ? items.filter((el) => {
          const t = el.getAttribute('itemtype') ?? '';
          const short = t.split('/').pop() ?? t;
          return short === cfg.itemtype || t === cfg.itemtype;
        })
      : items;

    return filtered.map(extractItem);
  },
};
