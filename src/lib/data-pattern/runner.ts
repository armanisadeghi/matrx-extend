/**
 * Apply an extraction pattern to a Document and return the rows.
 */

import type { ExtractionPattern, ExtractionPatternField } from '@/lib/supabase/queries';

export interface PatternRow {
  [field: string]: string | string[] | null;
}

export function applyPattern(pattern: ExtractionPattern, doc: Document = document): PatternRow[] {
  const root = pattern.list_root_selector
    ? Array.from(doc.querySelectorAll(pattern.list_root_selector))
    : [doc as unknown as Element];

  return root.map((scope) => extractRow(scope, pattern.fields));
}

function extractRow(scope: Element | Document, fields: ExtractionPatternField[]): PatternRow {
  const row: PatternRow = {};
  for (const f of fields) {
    if (f.is_list) {
      row[f.name] = Array.from(scope.querySelectorAll(f.selector)).map((el) =>
        readValue(el, f.attr),
      );
    } else {
      const el = scope.querySelector(f.selector);
      row[f.name] = el ? readValue(el, f.attr) : null;
    }
  }
  return row;
}

function readValue(el: Element, attr: string | undefined): string {
  if (attr) {
    const raw = (el.getAttribute(attr) ?? '').trim();
    if (!raw || !/^(?:href|src|data|poster|action|data-(?:href|src|url))$/i.test(attr)) return raw;
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      return raw;
    }
  }
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
}
