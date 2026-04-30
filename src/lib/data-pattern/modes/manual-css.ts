import { z } from 'zod';
import type { ExtractionMode } from '../types';

const FieldSelectorSchema = z.object({
  type: z.enum(['css', 'xpath', 'text-anchor', 'aria-path']),
  value: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

const FieldSchema = z.object({
  name: z.string(),
  selector: z.string(),
  selectors: z.array(FieldSelectorSchema).optional(),
  attr: z.string().optional(),
  is_list: z.boolean(),
});

export const manualCssConfigSchema = z.object({
  fields: z.array(FieldSchema),
  list_root_selector: z.string().nullable(),
});

export type ManualCssConfig = z.infer<typeof manualCssConfigSchema>;

export const manualCssMode: ExtractionMode<ManualCssConfig> = {
  id: 'manual_css',
  label: 'Manual CSS picker',
  description: 'User-picked CSS selectors with optional XPath/ARIA fallbacks.',
  configSchema: manualCssConfigSchema,
  defaultConfig: () => ({ fields: [], list_root_selector: null }),

  detectInPage: () => ({ available: true, summary: 'Manual mode' }),

  runInPage: (config) => {
    type FieldShape = {
      name: string;
      selector: string;
      selectors?: { type: string; value: string }[];
      attr?: string;
      is_list?: boolean;
    };
    type Cfg = { fields: FieldShape[]; list_root_selector: string | null };
    const cfg = config as unknown as Cfg;

    const root: (Element | Document)[] = cfg.list_root_selector
      ? Array.from(document.querySelectorAll(cfg.list_root_selector))
      : [document];

    const tryQuery = (scope: Element | Document, field: FieldShape): Element | null => {
      const list = field.selectors;
      if (list && Array.isArray(list)) {
        for (const s of list) {
          try {
            if (s.type === 'css') {
              const el = (scope as ParentNode).querySelector(s.value);
              if (el) return el;
            } else if (s.type === 'xpath') {
              const result = document.evaluate(
                s.value,
                scope as Node,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null,
              );
              const node = result.singleNodeValue;
              if (node && node.nodeType === 1) return node as Element;
            }
          } catch {
            // try next selector
          }
        }
      }
      try {
        return (scope as ParentNode).querySelector(field.selector);
      } catch {
        return null;
      }
    };

    const readValue = (el: Element, attr: string | undefined): string => {
      if (attr) return (el.getAttribute(attr) ?? '').trim();
      return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
    };

    return root.map((scope) => {
      const out: Record<string, unknown> = {};
      for (const f of cfg.fields) {
        if (f.is_list) {
          const els = Array.from((scope as ParentNode).querySelectorAll(f.selector));
          out[f.name] = els.map((el) => readValue(el as Element, f.attr));
        } else {
          const el = tryQuery(scope, f);
          out[f.name] = el ? readValue(el, f.attr) : null;
        }
      }
      return out;
    });
  },

  buildConfig: (pattern) => ({
    fields: (pattern.fields as ManualCssConfig['fields']) ?? [],
    list_root_selector: pattern.list_root_selector,
  }),
};
