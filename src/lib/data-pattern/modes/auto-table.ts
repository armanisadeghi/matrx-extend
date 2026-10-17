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
  /**
   * What the table looked like when it was saved. Replay finds the table by
   * these stable signals; `table_index` is only the final tie-break.
   */
  signature: z
    .object({
      headers: z.array(z.string()),
      caption: z.string().optional(),
      heading: z.string().optional(),
      id: z.string().optional(),
      label: z.string().optional(),
      columns: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** Return the table's signature instead of its rows (used when saving). */
  describe_only: z.boolean().optional(),
  /** Per-pattern override of {@link MIN_TABLE_MATCH} (0..1). */
  min_match: z.number().min(0).max(1).optional(),
});
export type AutoTableConfig = z.infer<typeof autoTableConfigSchema>;

/**
 * The lowest combined score (0..1) at which a table counts as "the saved one".
 * Below it replay returns NO rows plus the "not found" notice rather than an
 * unrelated table. `runInPage` is serialized into the page and cannot close
 * over this constant, so it carries the same literal (`MIN_MATCH`); the unit
 * test fails if the two ever differ. `config.min_match` overrides per pattern.
 */
export const MIN_TABLE_MATCH = 0.5;

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
    type Signature = {
      headers: string[];
      caption?: string;
      heading?: string;
      id?: string;
      label?: string;
      columns?: number;
    };
    const cfg = (config ?? {}) as {
      table_index?: number;
      selector?: string;
      header_rows?: number;
      header_join?: string;
      signature?: Signature;
      describe_only?: boolean;
      min_match?: number;
    };
    const MIN_MATCH = cfg.min_match ?? 0.5; // keep equal to MIN_TABLE_MATCH (unit-tested)

    // ── Which table? ────────────────────────────────────────────────────
    // A saved table is found by what it IS (header texts, caption, nearest
    // heading, human-typed id / aria-label), never by where it sits: a page
    // that adds a table above it must not change which table is captured.
    // Position is only the final tie-break. Self-contained: this function is
    // serialized into the page.
    const norm = (v: string | null | undefined): string =>
      (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
    const describeTable = (t: HTMLTableElement): Signature => {
      const headRows = t.querySelector('thead')
        ? Array.from(t.querySelectorAll('thead tr'))
        : [t.querySelector('tr')].filter((r): r is HTMLTableRowElement => r !== null);
      const headers = headRows
        .flatMap((r) => Array.from(r.querySelectorAll('th, td')))
        .map((c) => norm((c as HTMLElement).innerText ?? c.textContent))
        .filter(Boolean);
      const sig: Signature = { headers };
      const caption = norm(t.querySelector('caption')?.textContent);
      if (caption) sig.caption = caption;
      // Nearest heading above the table: walk back through siblings, then up.
      let heading = '';
      let node: Element | null = t;
      for (let up = 0; node && !heading && up < 8 && node !== document.body; up++) {
        for (
          let prev: Element | null = node.previousElementSibling;
          prev && !heading;
          prev = prev.previousElementSibling
        ) {
          if (/^H[1-6]$/.test(prev.tagName)) heading = norm(prev.textContent);
          else {
            const inner = prev.querySelectorAll('h1, h2, h3, h4, h5, h6');
            const last = inner[inner.length - 1];
            if (last) heading = norm(last.textContent);
          }
        }
        node = node.parentElement;
      }
      if (heading) sig.heading = heading;
      const stableId = t.id && t.id.length <= 60 && !/\d{4,}/.test(t.id) && !t.id.includes(':');
      if (stableId) sig.id = t.id;
      const label = norm(t.getAttribute('aria-label') || t.getAttribute('data-testid'));
      if (label) sig.label = label;
      sig.columns = headers.length;
      return sig;
    };
    const toSet = (a: string[]) => new Set(a);
    const jaccard = (a: string[], b: string[]): number => {
      const x = toSet(a);
      const y = toSet(b);
      if (x.size === 0 && y.size === 0) return 1;
      let hit = 0;
      for (const v of x) if (y.has(v)) hit++;
      return hit / (x.size + y.size - hit);
    };
    const usable = Array.from(document.querySelectorAll<HTMLTableElement>('table')).filter(
      (t) => t.querySelectorAll('tr').length >= 2,
    );

    if (cfg.describe_only) {
      const t = usable[cfg.table_index ?? 0];
      return { __matrx_run: true, rows: [], signature: t ? describeTable(t) : null } as never;
    }

    let table: HTMLTableElement | null = null;
    let notice: string | undefined;
    const savedIndex = cfg.table_index ?? 0;
    if (cfg.selector) {
      table = document.querySelector<HTMLTableElement>(cfg.selector);
    } else if (!cfg.signature) {
      table = usable[savedIndex] ?? null;
    } else {
      const sig = cfg.signature;
      const scored = usable.map((t, index) => {
        const d = describeTable(t);
        const parts: Array<[number, number]> = [];
        if (sig.headers.length > 0) parts.push([5, jaccard(sig.headers, d.headers)]);
        if (sig.caption) parts.push([2, d.caption === sig.caption ? 1 : 0]);
        if (sig.heading) parts.push([1.5, d.heading === sig.heading ? 1 : 0]);
        if (sig.id) parts.push([2, d.id === sig.id ? 1 : 0]);
        if (sig.label) parts.push([1, d.label === sig.label ? 1 : 0]);
        if (sig.columns) parts.push([0.5, d.columns === sig.columns ? 1 : 0]);
        const total = parts.reduce((n, [w]) => n + w, 0) || 1;
        const score = parts.reduce((n, [w, v]) => n + w * v, 0) / total;
        const headerScore = sig.headers.length > 0 ? jaccard(sig.headers, d.headers) : 0;
        return { t, index, score, headerScore };
      });
      // Position never outranks a signal; it only separates equal scores.
      scored.sort(
        (a, b) =>
          b.score - a.score || Math.abs(a.index - savedIndex) - Math.abs(b.index - savedIndex),
      );
      const best = scored[0];
      const runnerUp = scored[1];
      // With saved headers, header overlap is the evidence a table is the same one
      // (a renamed caption or moved heading must not disqualify it); otherwise the
      // combined score is all there is.
      const strength = best ? (sig.headers.length > 0 ? best.headerScore : best.score) : 0;
      if (!best || strength < MIN_MATCH) {
        notice =
          'The saved table was not found on this page, so nothing was captured. It was identified by its column headings' +
          (sig.headers.length > 0 ? ` (${sig.headers.slice(0, 4).join(', ')})` : '') +
          '.';
      } else {
        table = best.t;
        const strong = best.headerScore >= 0.8 || best.score >= 0.7;
        const tied = runnerUp && Math.abs(runnerUp.score - best.score) < 1e-9;
        if (!strong) {
          notice = `The saved table was not found exactly; this is the closest match (table ${best.index}). Check the result.`;
        } else if (tied) {
          notice = `Several tables look like the saved one; table ${best.index} was chosen by position. Check the result.`;
        }
      }
    }
    if (!table) {
      return (notice ? { __matrx_run: true, rows: [], notice } : []) as never;
    }

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
        const text = ((cell as HTMLElement).innerText ?? cell.textContent ?? '').trim();
        const colspan = Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
        const rowspan = Number.parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;
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
    // A header row that sits inside <tbody> (no <thead>) is never also a data row.
    const tbody = table.querySelector('tbody');
    const headerSet = new Set<HTMLTableRowElement>(headerTrs);
    const bodyTrs = (
      tbody
        ? Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'))
        : Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
    ).filter((tr) => !headerSet.has(tr));

    // Body cells are placed on the same column grid as the header: a
    // rowspan cell (a Nobel year shared by two laureates) repeats its value
    // down the rows it spans, and colspan fills every column it covers, so
    // later cells never shift into the wrong column.
    // A cell that holds a form control (a pricing table's disk-size input)
    // shows its value on screen but has no text — read the control's value.
    const cellText = (cell: HTMLElement): string => {
      const controls = Array.from(
        cell.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea',
        ),
      );
      if (controls.length === 0) return (cell.innerText ?? cell.textContent ?? '').trim();
      // Option lists are not cell text; drop the controls, keep labels.
      const bare = cell.cloneNode(true) as HTMLElement;
      for (const c of Array.from(bare.querySelectorAll('select, textarea, input'))) c.remove();
      const label = (bare.textContent ?? '').replace(/\s+/g, ' ').trim();
      const values = controls
        .map((c) =>
          c instanceof HTMLSelectElement ? (c.selectedOptions[0]?.textContent ?? c.value) : c.value,
        )
        .map((v) => v.trim())
        .filter(Boolean);
      return [label, ...values].filter(Boolean).join(' ').trim();
    };
    const carry: Array<{ text: string; left: number } | undefined> = [];
    const out: Record<string, string>[] = [];
    for (const tr of bodyTrs) {
      const values: string[] = [];
      const cells = Array.from(tr.children).filter(
        (c) => c.tagName === 'TD' || c.tagName === 'TH',
      ) as HTMLElement[];
      let col = 0;
      const fillCarried = () => {
        for (let held = carry[col]; held && held.left > 0; held = carry[col]) {
          values[col] = held.text;
          held.left -= 1;
          col += 1;
        }
      };
      for (const cell of cells) {
        fillCarried();
        const text = cellText(cell);
        const colspan = Number.parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
        const rowspan = Number.parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;
        for (let dc = 0; dc < colspan; dc++) {
          values[col + dc] = text;
          carry[col + dc] = rowspan > 1 ? { text, left: rowspan - 1 } : undefined;
        }
        col += colspan;
      }
      fillCarried();
      // Trailing columns still held by an earlier rowspan.
      for (let c = col; c < carry.length; c++) {
        const held = carry[c];
        if (held && held.left > 0) {
          values[c] = held.text;
          held.left -= 1;
        }
      }
      if (!values.some((v) => v)) continue; // spacer / image-only rows carry no data
      const row: Record<string, string> = {};
      for (let i = 0; i < values.length; i++) {
        row[headers[i] ?? `col_${i + 1}`] = values[i] ?? '';
      }
      out.push(row);
    }
    return (notice ? { __matrx_run: true, rows: out, notice } : out) as never;
  },
};
