import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const autoTableConfigSchema = z.object({
  table_index: z.number().int().nonnegative().optional(),
  selector: z.string().optional(),
});
export type AutoTableConfig = z.infer<typeof autoTableConfigSchema>;

export const autoTableMode: ExtractionMode<AutoTableConfig> = {
  id: 'auto_table',
  label: 'Tables',
  description: 'Detect <table> elements on the page and extract them as JSON rows.',
  configSchema: autoTableConfigSchema,
  defaultConfig: () => ({ table_index: 0 }),

  detectInPage: () => {
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
    const usable = tables.filter((t) => t.querySelectorAll('tr').length >= 2);
    if (usable.length === 0) {
      return { available: false, summary: 'No tables on this page' };
    }
    const summaries = usable.slice(0, 5).map((t, i) => {
      const rows = t.querySelectorAll('tr').length;
      const cols = t.querySelector('tr')?.children.length ?? 0;
      return `#${i}: ${rows}r×${cols}c`;
    });
    return {
      available: true,
      count: usable.length,
      summary: `${usable.length} table${usable.length === 1 ? '' : 's'} (${summaries.join(', ')})`,
    };
  },

  runInPage: (config) => {
    const cfg = (config ?? {}) as { table_index?: number; selector?: string };

    let table: HTMLTableElement | null = null;
    if (cfg.selector) {
      table = document.querySelector<HTMLTableElement>(cfg.selector);
    } else {
      const all = Array.from(document.querySelectorAll<HTMLTableElement>('table')).filter(
        (t) => t.querySelectorAll('tr').length >= 2,
      );
      table = all[cfg.table_index ?? 0] ?? null;
    }
    if (!table) return [];

    const headers: string[] = [];
    const headerRow = table.querySelector('thead tr') ?? table.querySelector('tr');
    if (headerRow) {
      for (const c of Array.from(headerRow.querySelectorAll('th, td'))) {
        const text = (c as HTMLElement).innerText?.trim() || `col_${headers.length + 1}`;
        headers.push(text);
      }
    }

    const bodyRows = table.querySelectorAll<HTMLTableRowElement>('tbody tr');
    const trs =
      bodyRows.length > 0
        ? Array.from(bodyRows)
        : Array.from(table.querySelectorAll<HTMLTableRowElement>('tr')).slice(1);

    return trs.map((tr) => {
      const row: Record<string, string> = {};
      const cells = Array.from(tr.querySelectorAll('th, td'));
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i] as HTMLElement;
        const key = headers[i] ?? `col_${i + 1}`;
        row[key] = cell.innerText?.trim() ?? '';
      }
      return row;
    });
  },
};
