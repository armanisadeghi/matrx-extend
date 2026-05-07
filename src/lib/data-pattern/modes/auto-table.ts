import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const autoTableConfigSchema = z.object({
  table_index: z.number().int().nonnegative().optional(),
  selector: z.string().optional(),
  /**
   * Override the auto-detected header-row count. Auto = every `<tr>` inside
   * `<thead>` (handles multi-tier headers); set explicitly when a page puts
   * its header rows inside `<tbody>` instead.
   */
  header_rows: z.number().int().nonnegative().optional(),
  /** Separator used when merging multi-tier header text. Default ' - '. */
  header_join: z.string().optional(),
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
      const headRows = t.querySelectorAll('thead tr').length;
      const tier = headRows > 1 ? `, ${headRows}-tier hdr` : '';
      return `#${i}: ${rows}r×${cols}c${tier}`;
    });
    return {
      available: true,
      count: usable.length,
      summary: `${usable.length} table${usable.length === 1 ? '' : 's'} (${summaries.join(', ')})`,
    };
  },

  runInPage: (config) => {
    const cfg = (config ?? {}) as {
      table_index?: number;
      selector?: string;
      header_rows?: number;
      header_join?: string;
    };

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

    const join = cfg.header_join ?? ' - ';

    // Resolve which <tr>s are header rows. Auto: every <tr> inside <thead>
    // (multi-tier headers like the OpenAI pricing table). Override with
    // header_rows for tables that put headers inside <tbody>.
    const thead = table.querySelector('thead');
    let headerTrs: HTMLTableRowElement[] = thead
      ? Array.from(thead.querySelectorAll<HTMLTableRowElement>('tr'))
      : [];
    if (cfg.header_rows != null) {
      headerTrs = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr')).slice(
        0,
        Math.max(0, cfg.header_rows),
      );
    } else if (headerTrs.length === 0) {
      // No <thead>: assume the first <tr> is the header (legacy behavior).
      const first = table.querySelector<HTMLTableRowElement>('tr');
      if (first) headerTrs = [first];
    }

    // Build a column-aligned grid by expanding colspan/rowspan, then merge
    // each column's text down the rows (consecutive duplicates collapsed —
    // a rowspan=2 cell shouldn't produce "Model - Model").
    const grid: string[][] = [];
    const occupied: boolean[][] = [];
    const ensureRow = (r: number): { g: string[]; o: boolean[] } => {
      let g = grid[r];
      if (!g) {
        g = [];
        grid[r] = g;
      }
      let o = occupied[r];
      if (!o) {
        o = [];
        occupied[r] = o;
      }
      return { g, o };
    };
    for (let r = 0; r < headerTrs.length; r++) {
      const { o } = ensureRow(r);
      let col = 0;
      const tr = headerTrs[r];
      if (!tr) continue;
      const cells = Array.from(tr.querySelectorAll('th, td'));
      for (const cell of cells) {
        while (o[col]) col++;
        const text =
          ((cell as HTMLElement).innerText ?? cell.textContent ?? '').trim();
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;
        for (let dr = 0; dr < rowspan; dr++) {
          const slot = ensureRow(r + dr);
          for (let dc = 0; dc < colspan; dc++) {
            slot.g[col + dc] = text;
            slot.o[col + dc] = true;
          }
        }
        col += colspan;
      }
    }

    const colCount = grid.reduce((n, r) => Math.max(n, r.length), 0);
    const headers: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const parts: string[] = [];
      let last = '';
      for (let r = 0; r < grid.length; r++) {
        const v = (grid[r]?.[c] ?? '').trim();
        if (v && v !== last) {
          parts.push(v);
          last = v;
        }
      }
      headers.push(parts.length > 0 ? parts.join(join) : `col_${c + 1}`);
    }

    // Body rows: prefer <tbody>; otherwise skip past the header rows we used.
    const tbody = table.querySelector('tbody');
    const bodyTrs = tbody
      ? Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'))
      : Array.from(table.querySelectorAll<HTMLTableRowElement>('tr')).slice(
          headerTrs.length,
        );

    return bodyTrs.map((tr) => {
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
