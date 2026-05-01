import { z } from 'zod';
import type { ExtractionMode } from '../types';

const FieldPathSchema = z.object({
  name: z.string(),
  rel_selector: z.string(),
  attr: z.string().optional(),
});

export const listPatternConfigSchema = z.object({
  list_root: z.string(),
  item_selector: z.string(),
  field_paths: z.array(FieldPathSchema),
});
export type ListPatternConfig = z.infer<typeof listPatternConfigSchema>;

export const listPatternMode: ExtractionMode<ListPatternConfig> = {
  id: 'list_pattern',
  label: 'List Pattern',
  description:
    'Click one example item; we infer all similar siblings. Then pick fields inside it.',
  configSchema: listPatternConfigSchema,
  defaultConfig: () => ({ list_root: '', item_selector: '', field_paths: [] }),

  detectInPage: () => ({
    available: true,
    summary: 'Click an example item to infer the list',
  }),

  runInPage: (config) => {
    type FieldPath = { name: string; rel_selector: string; attr?: string };
    type Cfg = { list_root: string; item_selector: string; field_paths: FieldPath[] };
    const cfg = config as unknown as Cfg;

    let scope: ParentNode = document;
    if (cfg.list_root) {
      const root = document.querySelector(cfg.list_root);
      if (root) scope = root;
    }

    let items: Element[] = [];
    try {
      items = cfg.item_selector
        ? Array.from((scope as ParentNode).querySelectorAll(cfg.item_selector))
        : Array.from((scope as ParentNode).children);
    } catch {
      items = [];
    }

    const readValue = (el: Element, attr: string | undefined): string => {
      if (attr) return (el.getAttribute(attr) ?? '').trim();
      return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
    };

    return items.map((item) => {
      const row: Record<string, string | null> = {};
      for (const f of cfg.field_paths) {
        try {
          const el =
            f.rel_selector === ':scope' ? item : item.querySelector(f.rel_selector);
          row[f.name] = el ? readValue(el, f.attr) : null;
        } catch {
          row[f.name] = null;
        }
      }
      return row;
    });
  },
};
