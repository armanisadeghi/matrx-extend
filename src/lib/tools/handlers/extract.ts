/**
 * Tier: READ.
 *
 * `extract_table` — turn a `<table>` (or ARIA `role="table"` / `role="grid"`)
 * into structured JSON with proper rowspan / colspan / multi-row-header
 * handling. Saves 5–10 agent calls per data-heavy page versus scraping
 * cell-by-cell.
 *
 * `screenshot_region` — capture a bounded portion of the active viewport
 * and return the same envelope as `take_screenshot` but cropped. Pair
 * with refs from `read_page` to get cheap focused vision-API calls
 * (5–20× fewer tokens than a full-page screenshot).
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (items #2 and #4)
 */
import { z } from 'zod';
import { resolveProfile, type ScreenshotProfile } from '@/lib/screenshot/profiles';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';

// ─── extract_table ─────────────────────────────────────────────────────────
const ExtractTableArgs = z
  .object({
    /**
     * Reference id from `read_page` (preferred) — points at a specific
     * <table> or grid element.
     */
    ref: z.string().optional(),
    /**
     * CSS selector for the table. Used when `ref` is not available.
     * Defaults to the largest visible table on the page.
     */
    selector: z.string().optional(),
    /** Cap on body rows returned (headers are always included). Default 500. */
    max_rows: z.number().int().positive().max(5000).optional().default(500),
    /**
     * When true (default), strip whitespace + collapse internal newlines
     * in cell values. Set false to preserve exact text.
     */
    normalize: z.boolean().optional().default(true),
    /**
     * When true, attempt header-path computation across multi-row
     * headers. Default true.
     */
    compute_header_paths: z.boolean().optional().default(true),
  })
  .default({});
type ExtractTableArgs = z.infer<typeof ExtractTableArgs>;

interface ExtractTableResult {
  ok: boolean;
  reason?: string;
  /** Either 'table' (HTML <table>) or 'aria-grid' (role="table"/"grid"). */
  table_kind?: 'table' | 'aria-grid';
  row_count?: number;
  column_count?: number;
  header_row_count?: number;
  truncated?: boolean;
  columns?: Array<{ index: number; path: string[] }>;
  rows?: Array<{ index: number; cells: Array<{ value: string; is_header: boolean; colspan?: number; rowspan?: number }> }>;
  merged_cells?: Array<{ row: number; col: number; colspan: number; rowspan: number; value: string; is_header: boolean }>;
}

export const extract_table: ToolHandler<ExtractTableArgs, ExtractTableResult> = {
  name: 'extract_table',
  tier: 'read',
  description:
    "Extract a table on the active page as structured JSON. Handles native <table> with thead/tbody, rowspan/colspan, multi-row headers, and ARIA role=\"table\" / role=\"grid\" patterns. Provide `ref` (preferred) from a prior read_page, or `selector` (any CSS), or omit both to pick the largest visible table. Returns { columns: [{ index, path: [headerLevels...] }], rows: [{ cells: [{ value, is_header, colspan?, rowspan? }] }], merged_cells, row_count, column_count }. Use this instead of cell-by-cell scraping — one call versus dozens.",
  argsSchema: ExtractTableArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
    if (!tab?.id) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractTableInPage,
        args: [args.ref ?? null, args.selector ?? null, args.max_rows, args.normalize, args.compute_header_paths],
      });
      return (first?.result as ExtractTableResult) ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

/**
 * In-page extractor. Self-contained; runs across the chrome.scripting boundary.
 */
function extractTableInPage(
  ref: string | null,
  selector: string | null,
  maxRows: number,
  normalize: boolean,
  computeHeaderPaths: boolean,
): ExtractTableResult {
  // ─── pick the target element ──────────────────────────────────────────
  function findTarget(): Element | null {
    if (ref) {
      const r = ref.replace(/^ref:/, '');
      const found = document.querySelector(`[data-matrx-ref="${cssEscape(r)}"]`);
      if (found) return found;
    }
    if (selector) {
      try {
        const found = document.querySelector(selector);
        if (found) return found;
      } catch {
        // fall through
      }
    }
    // Default: the largest visible <table> by area, then the largest
    // role="table" / role="grid".
    const candidates: Array<{ el: Element; area: number }> = [];
    document.querySelectorAll('table, [role="table"], [role="grid"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      candidates.push({ el, area: r.width * r.height });
    });
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0]?.el ?? null;
  }

  function cssEscape(s: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return s.replace(/(["\\])/g, '\\$1');
  }

  function norm(s: string): string {
    if (!normalize) return s;
    return s.replace(/\s+/g, ' ').trim();
  }

  const target = findTarget();
  if (!target) {
    return { ok: false, reason: ref || selector ? 'No element matched the selector' : 'No table found on the page' };
  }

  // ─── route to the right extractor ────────────────────────────────────
  if (target.tagName === 'TABLE') {
    return extractHtmlTable(target as HTMLTableElement);
  }
  if (target.matches('[role="table"], [role="grid"]')) {
    return extractAriaGrid(target);
  }
  // Fall back to the closest table ancestor / descendant.
  const innerTable = target.querySelector('table');
  if (innerTable) return extractHtmlTable(innerTable);
  const ancestorTable = target.closest('table');
  if (ancestorTable) return extractHtmlTable(ancestorTable);
  return { ok: false, reason: `Element is not a table or grid (tag=${target.tagName.toLowerCase()})` };

  // ─── HTML <table> ────────────────────────────────────────────────────
  function extractHtmlTable(table: HTMLTableElement): ExtractTableResult {
    interface VirtualCell {
      value: string;
      isHeader: boolean;
      colspan: number;
      rowspan: number;
      originRow: number;
      originCol: number;
    }

    const rows = Array.from(table.rows);
    if (rows.length === 0) {
      return { ok: true, table_kind: 'table', row_count: 0, column_count: 0, header_row_count: 0, columns: [], rows: [], merged_cells: [] };
    }

    // Build the virtual 2D grid honoring rowspan / colspan.
    const grid: VirtualCell[][] = [];
    let maxCols = 0;
    for (let r = 0; r < rows.length; r++) {
      if (!grid[r]) grid[r] = [];
      let c = 0;
      for (const rawCell of Array.from(rows[r]!.cells)) {
        const cell = rawCell as HTMLTableCellElement;
        // Skip cells already occupied by a rowspan from above.
        while (grid[r]![c] !== undefined) c++;
        const colspan = Math.max(1, cell.colSpan ?? 1);
        const rowspan = Math.max(1, cell.rowSpan ?? 1);
        const v: VirtualCell = {
          value: norm(cell.innerText ?? cell.textContent ?? ''),
          isHeader: cell.tagName === 'TH',
          colspan,
          rowspan,
          originRow: r,
          originCol: c,
        };
        for (let dr = 0; dr < rowspan; dr++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          for (let dc = 0; dc < colspan; dc++) {
            grid[r + dr]![c + dc] = v;
          }
        }
        c += colspan;
      }
      if (c > maxCols) maxCols = c;
    }

    // Header detection: <thead> wins; else prefix of all-TH rows; else 0.
    let headerRowCount = 0;
    const thead = table.tHead;
    if (thead) {
      headerRowCount = thead.rows.length;
    } else {
      for (let r = 0; r < grid.length; r++) {
        if (grid[r]!.every((c) => c?.isHeader)) headerRowCount = r + 1;
        else break;
      }
    }

    // Compute per-column header path.
    const columns: Array<{ index: number; path: string[] }> = [];
    for (let c = 0; c < maxCols; c++) {
      const path: string[] = [];
      if (computeHeaderPaths) {
        for (let r = 0; r < headerRowCount; r++) {
          const cell = grid[r]?.[c];
          if (!cell) continue;
          if (path[path.length - 1] === cell.value) continue; // dedupe colspan repeats
          if (cell.value) path.push(cell.value);
        }
      }
      columns.push({ index: c, path });
    }

    // Body rows (cap at maxRows).
    const bodyRows: ExtractTableResult['rows'] = [];
    const limit = Math.min(grid.length, headerRowCount + maxRows);
    for (let r = headerRowCount; r < limit; r++) {
      const cells: NonNullable<ExtractTableResult['rows']>[number]['cells'] = [];
      const rowGrid = grid[r]!;
      const seenOrigins = new Set<string>();
      for (let c = 0; c < maxCols; c++) {
        const cell = rowGrid[c];
        if (!cell) {
          cells.push({ value: '', is_header: false });
          continue;
        }
        const originKey = `${cell.originRow}:${cell.originCol}`;
        if (seenOrigins.has(originKey)) {
          // already emitted in this row from the same merged origin → blank passthrough
          cells.push({ value: '', is_header: false });
          continue;
        }
        seenOrigins.add(originKey);
        const out: NonNullable<ExtractTableResult['rows']>[number]['cells'][number] = {
          value: cell.value,
          is_header: cell.isHeader,
        };
        if (cell.colspan > 1) out.colspan = cell.colspan;
        if (cell.rowspan > 1) out.rowspan = cell.rowspan;
        cells.push(out);
      }
      bodyRows.push({ index: r - headerRowCount, cells });
    }

    // Merged-cell index (for callers that need to render the table back).
    const mergedSet = new Set<string>();
    const merged: ExtractTableResult['merged_cells'] = [];
    for (const row of grid) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.colspan === 1 && cell.rowspan === 1) continue;
        const key = `${cell.originRow}:${cell.originCol}`;
        if (mergedSet.has(key)) continue;
        mergedSet.add(key);
        merged.push({
          row: cell.originRow,
          col: cell.originCol,
          colspan: cell.colspan,
          rowspan: cell.rowspan,
          value: cell.value,
          is_header: cell.isHeader,
        });
      }
    }

    return {
      ok: true,
      table_kind: 'table',
      row_count: grid.length - headerRowCount,
      column_count: maxCols,
      header_row_count: headerRowCount,
      truncated: grid.length - headerRowCount > maxRows,
      columns,
      rows: bodyRows,
      merged_cells: merged,
    };
  }

  // ─── ARIA role="table" / role="grid" ─────────────────────────────────
  function extractAriaGrid(root: Element): ExtractTableResult {
    const rowEls = Array.from(root.querySelectorAll('[role="row"]')).filter(
      (r) => r.closest('[role="table"], [role="grid"]') === root,
    );
    if (rowEls.length === 0) return { ok: false, reason: 'role=table/grid has no role=row children' };

    interface VirtualCell {
      value: string;
      isHeader: boolean;
      colspan: number;
      rowspan: number;
      originRow: number;
      originCol: number;
    }

    const grid: VirtualCell[][] = [];
    let maxCols = 0;
    for (let r = 0; r < rowEls.length; r++) {
      if (!grid[r]) grid[r] = [];
      let c = 0;
      const cellEls = Array.from(
        rowEls[r]!.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]'),
      ).filter((cell) => cell.closest('[role="row"]') === rowEls[r]);
      for (const cell of cellEls) {
        while (grid[r]![c] !== undefined) c++;
        const colspan = Math.max(1, parseInt(cell.getAttribute('aria-colspan') ?? '1', 10));
        const rowspan = Math.max(1, parseInt(cell.getAttribute('aria-rowspan') ?? '1', 10));
        const role = cell.getAttribute('role') ?? '';
        const v: VirtualCell = {
          value: norm((cell as HTMLElement).innerText ?? cell.textContent ?? ''),
          isHeader: role === 'columnheader' || role === 'rowheader',
          colspan,
          rowspan,
          originRow: r,
          originCol: c,
        };
        for (let dr = 0; dr < rowspan; dr++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          for (let dc = 0; dc < colspan; dc++) grid[r + dr]![c + dc] = v;
        }
        c += colspan;
      }
      if (c > maxCols) maxCols = c;
    }

    // Header detection in ARIA grids: any prefix of rows where every cell
    // has role columnheader.
    let headerRowCount = 0;
    for (let r = 0; r < grid.length; r++) {
      if (grid[r]!.every((c) => c?.isHeader)) headerRowCount = r + 1;
      else break;
    }

    const columns: Array<{ index: number; path: string[] }> = [];
    for (let c = 0; c < maxCols; c++) {
      const path: string[] = [];
      if (computeHeaderPaths) {
        for (let r = 0; r < headerRowCount; r++) {
          const cell = grid[r]?.[c];
          if (!cell) continue;
          if (path[path.length - 1] === cell.value) continue;
          if (cell.value) path.push(cell.value);
        }
      }
      columns.push({ index: c, path });
    }

    const bodyRows: ExtractTableResult['rows'] = [];
    const limit = Math.min(grid.length, headerRowCount + maxRows);
    for (let r = headerRowCount; r < limit; r++) {
      const cells: NonNullable<ExtractTableResult['rows']>[number]['cells'] = [];
      const rowGrid = grid[r]!;
      const seenOrigins = new Set<string>();
      for (let c = 0; c < maxCols; c++) {
        const cell = rowGrid[c];
        if (!cell) {
          cells.push({ value: '', is_header: false });
          continue;
        }
        const k = `${cell.originRow}:${cell.originCol}`;
        if (seenOrigins.has(k)) {
          cells.push({ value: '', is_header: false });
          continue;
        }
        seenOrigins.add(k);
        const out: NonNullable<ExtractTableResult['rows']>[number]['cells'][number] = {
          value: cell.value,
          is_header: cell.isHeader,
        };
        if (cell.colspan > 1) out.colspan = cell.colspan;
        if (cell.rowspan > 1) out.rowspan = cell.rowspan;
        cells.push(out);
      }
      bodyRows.push({ index: r - headerRowCount, cells });
    }

    const mergedSet = new Set<string>();
    const merged: ExtractTableResult['merged_cells'] = [];
    for (const row of grid) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.colspan === 1 && cell.rowspan === 1) continue;
        const k = `${cell.originRow}:${cell.originCol}`;
        if (mergedSet.has(k)) continue;
        mergedSet.add(k);
        merged.push({
          row: cell.originRow,
          col: cell.originCol,
          colspan: cell.colspan,
          rowspan: cell.rowspan,
          value: cell.value,
          is_header: cell.isHeader,
        });
      }
    }

    return {
      ok: true,
      table_kind: 'aria-grid',
      row_count: grid.length - headerRowCount,
      column_count: maxCols,
      header_row_count: headerRowCount,
      truncated: grid.length - headerRowCount > maxRows,
      columns,
      rows: bodyRows,
      merged_cells: merged,
    };
  }
}

// ─── screenshot_region ─────────────────────────────────────────────────────
const ScreenshotRegionArgs = z
  .object({
    /** Ref id from `read_page` — captures that element's bounding box. */
    ref: z.string().optional(),
    /** CSS selector for the element whose bounding box to capture. */
    selector: z.string().optional(),
    /** Explicit viewport rect (alternative to ref/selector). */
    rect: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .optional(),
    /** Optional pad in CSS px around the resolved rect. Default 8. */
    padding: z.number().int().min(0).max(200).optional().default(8),
    /** Screenshot profile (same set as take_screenshot). Default 'auto'. */
    profile: z
      .enum([
        'auto',
        'auto-final',
        'anthropic-default',
        'anthropic-hires',
        'openai-original',
        'openai-high',
        'openai-low',
        'gemini-screenshot',
        'gemini-overview',
        'gemini-2.5-default',
        'ocr-heavy',
        'lossless',
      ])
      .optional()
      .default('auto'),
    format: z.enum(['png', 'jpeg']).optional(),
    quality: z.number().int().min(1).max(100).optional(),
  })
  .refine((a) => a.ref || a.selector || a.rect, {
    message: 'one of ref / selector / rect is required',
  });
type ScreenshotRegionArgs = z.infer<typeof ScreenshotRegionArgs>;

interface ScreenshotRegionResult {
  ok: boolean;
  reason?: string;
  media_type?: 'image/png' | 'image/jpeg';
  format?: 'png' | 'jpeg';
  width?: number;
  height?: number;
  source_rect?: { x: number; y: number; w: number; h: number };
  image_base64?: string;
  byte_length?: number;
  profile?: string;
}

export const screenshot_region: ToolHandler<ScreenshotRegionArgs, ScreenshotRegionResult> = {
  name: 'screenshot_region',
  tier: 'read',
  description:
    "Capture a bounded region of the active tab's viewport. Provide `ref` (preferred) from a prior read_page, OR `selector`, OR an explicit viewport `rect: {x,y,w,h}`. The handler scrolls the target into view if needed, captures the visible viewport, then crops to the resolved rect (with optional `padding` in CSS px). Returns the same shape as take_screenshot: { media_type, format, width, height, image_base64, byte_length, source_rect }. Use this for focused vision-API calls on a specific component — 5-20× cheaper than a full-page screenshot.",
  argsSchema: ScreenshotRegionArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
    if (!tab?.id || !tab.windowId) return { ok: false, reason: 'No active tab' };

    // 1. Resolve the rect — either explicit or derived from ref/selector.
    let viewportRect: { x: number; y: number; w: number; h: number } | null = null;
    if (args.rect) {
      viewportRect = { ...args.rect };
    } else {
      const refSelector = args.ref
        ? `[data-matrx-ref="${args.ref.replace(/^ref:/, '').replace(/(["\\])/g, '\\$1')}"]`
        : (args.selector ?? null);
      if (!refSelector) return { ok: false, reason: 'No selector resolved' };
      try {
        const [first] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: resolveRectInPage,
          args: [refSelector],
        });
        const r = first?.result as { ok: boolean; rect?: { x: number; y: number; w: number; h: number }; reason?: string } | undefined;
        if (!r?.ok || !r.rect) return { ok: false, reason: r?.reason ?? 'Could not resolve element rect' };
        viewportRect = r.rect;
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }

    // 2. Apply padding and clamp to viewport.
    const pad = args.padding ?? 8;
    const padded = {
      x: Math.max(0, viewportRect!.x - pad),
      y: Math.max(0, viewportRect!.y - pad),
      w: viewportRect!.w + pad * 2,
      h: viewportRect!.h + pad * 2,
    };

    // 3. Capture the visible tab.
    const profileName = (args.profile ?? 'auto') as ScreenshotProfile;
    const profile = resolveProfile(profileName);
    const format = args.format ?? profile.format;
    const quality = args.quality ?? profile.quality;
    let dataUrl: string;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      return { ok: false, reason: `captureVisibleTab failed: ${(err as Error).message}` };
    }

    // 4. Get the device-pixel ratio so we crop in image-pixel space.
    let dpr = 1;
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.devicePixelRatio || 1,
      });
      dpr = (first?.result as number) ?? 1;
    } catch {
      // ignore — fall back to 1x
    }

    // 5. Crop + re-encode to the requested format/quality.
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const bitmap = await createImageBitmap(blob);
      const cropX = Math.max(0, Math.round(padded.x * dpr));
      const cropY = Math.max(0, Math.round(padded.y * dpr));
      const cropW = Math.min(bitmap.width - cropX, Math.round(padded.w * dpr));
      const cropH = Math.min(bitmap.height - cropY, Math.round(padded.h * dpr));
      if (cropW <= 0 || cropH <= 0) {
        bitmap.close();
        return { ok: false, reason: `Resolved rect is outside the viewport: ${JSON.stringify(padded)}` };
      }
      const canvas = new OffscreenCanvas(cropW, cropH);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return { ok: false, reason: 'OffscreenCanvas 2d context unavailable' };
      }
      ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      bitmap.close();
      const out = await canvas.convertToBlob({
        type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        quality: format === 'jpeg' ? quality / 100 : undefined,
      });
      const buf = await out.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      }
      const base64 = btoa(bin);
      return {
        ok: true,
        media_type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        format,
        width: cropW,
        height: cropH,
        source_rect: padded,
        image_base64: base64,
        byte_length: base64.length,
        profile: profileName,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

/**
 * In-page helper: resolve a selector to a viewport rect, scrolling into
 * view first if the element is off-screen.
 */
function resolveRectInPage(selector: string): {
  ok: boolean;
  reason?: string;
  rect?: { x: number; y: number; w: number; h: number };
} {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch (err) {
    return { ok: false, reason: `Bad selector: ${(err as Error).message}` };
  }
  if (!el) return { ok: false, reason: 'Element not found' };
  const r0 = el.getBoundingClientRect();
  // Scroll into view only if any edge is outside the viewport.
  const offscreen =
    r0.top < 0 ||
    r0.left < 0 ||
    r0.bottom > window.innerHeight ||
    r0.right > window.innerWidth;
  if (offscreen) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) {
    return { ok: false, reason: 'Element has zero size' };
  }
  return { ok: true, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

export const extract_handlers = [extract_table, screenshot_region];
