import { z } from 'zod';
import type { ExtractionMode } from '../types';

const FieldTransformSchema = z.object({
  kind: z.enum(['regex']),
  expr: z.string(),
});

const FieldPathSchema = z.object({
  name: z.string(),
  rel_selector: z.string(),
  attr: z.string().optional(),
  /**
   * Optional value transform applied AFTER reading text/attribute. Today
   * only `regex` is supported — runner runs the regex and returns the
   * first match. Used by inspector regex-candidates so what you see in the
   * suggested-fields preview is exactly what the runner produces.
   */
  transform: FieldTransformSchema.optional(),
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
  description: 'Click one example item; we infer all similar siblings. Then pick fields inside it.',
  configSchema: listPatternConfigSchema,
  defaultConfig: () => ({ list_root: '', item_selector: '', field_paths: [] }),

  detectInPage: () => ({
    available: true,
    summary: 'Click an example item to infer the list',
  }),

  runInPage: (config) => {
    type Transform = { kind: 'regex'; expr: string };
    type FieldPath = {
      name: string;
      rel_selector: string;
      attr?: string;
      transform?: Transform;
    };
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

    const readValue = (
      el: Element,
      attr: string | undefined,
      transform: Transform | undefined,
    ): string => {
      let v = attr
        ? (el.getAttribute(attr) ?? '').trim()
        : ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
      if (transform?.kind === 'regex' && transform.expr) {
        try {
          const re = new RegExp(transform.expr);
          const m = re.exec(v);
          // Capture-group-first: '(\\d+)' means "extract the digits", not
          // "give me the whole match". Falls back to the full match when no
          // group is present.
          v = m ? (m[1] ?? m[0]) : '';
        } catch {
          // bad regex — fall through to original
        }
      }
      return v;
    };

    return items.map((item) => {
      const row: Record<string, string | null> = {};
      for (const f of cfg.field_paths) {
        try {
          const el = f.rel_selector === ':scope' ? item : item.querySelector(f.rel_selector);
          row[f.name] = el ? readValue(el, f.attr, f.transform) : null;
        } catch {
          row[f.name] = null;
        }
      }
      return row;
    });
  },
};

/**
 * Probe ONE row using the SAME extraction logic as `runInPage`. Used by the
 * sidepanel's preview row so what the user sees inline matches exactly what
 * the runner will produce — no second implementation, no drift.
 */
export function probeFirstRowInPage(
  config: ListPatternConfig,
): Record<string, string | null> | null {
  type Transform = { kind: 'regex'; expr: string };
  type FieldPath = {
    name: string;
    rel_selector: string;
    attr?: string;
    transform?: Transform;
  };
  const cfg = config as unknown as {
    list_root: string;
    item_selector: string;
    field_paths: FieldPath[];
  };

  let scope: ParentNode = document;
  if (cfg.list_root) {
    const root = document.querySelector(cfg.list_root);
    if (root) scope = root;
  }
  let item: Element | null;
  try {
    item = cfg.item_selector ? (scope as ParentNode).querySelector(cfg.item_selector) : null;
  } catch {
    item = null;
  }
  if (!item) return null;

  const readValue = (
    el: Element,
    attr: string | undefined,
    transform: Transform | undefined,
  ): string => {
    let v = attr
      ? (el.getAttribute(attr) ?? '').trim()
      : ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
    if (transform?.kind === 'regex' && transform.expr) {
      try {
        const re = new RegExp(transform.expr);
        const m = re.exec(v);
        v = m ? (m[1] ?? m[0]) : '';
      } catch {
        // bad regex
      }
    }
    return v;
  };

  const row: Record<string, string | null> = {};
  for (const f of cfg.field_paths) {
    try {
      const el = f.rel_selector === ':scope' ? item : item.querySelector(f.rel_selector);
      row[f.name] = el ? readValue(el, f.attr, f.transform) : null;
    } catch {
      row[f.name] = null;
    }
  }
  return row;
}
