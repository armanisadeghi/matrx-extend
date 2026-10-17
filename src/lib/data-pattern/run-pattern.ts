import type { ExtractionPattern } from '@/lib/supabase/queries';
import { getMode } from './registry';
import type { DetectionHint, ExtractedRow } from './types';

/**
 * chrome.scripting.executeScript serializes args via structured clone, which
 * does NOT permit `undefined` as a top-level value (it does permit undefined
 * inside objects). Coerce undefined to an empty object so callers can pass
 * configs through without manually defaulting at every site.
 */
function safeArg(v: unknown): unknown {
  return v === undefined ? {} : v;
}

/**
 * A mode's in-page runner normally returns the rows. When it has something the
 * person must be told (the saved table was not found exactly), it returns
 * `{ __matrx_run: true, rows, notice }` instead; the notice travels to the
 * caller's `onNotice` — a weak match is announced, never silent.
 */
type InPageRun = { __matrx_run: true; rows: ExtractedRow[]; notice?: string; signature?: unknown };

function readRun(result: chrome.scripting.InjectionResult<unknown>[]): {
  rows: ExtractedRow[];
  notice?: string;
  signature?: unknown;
} {
  const value = result?.[0]?.result;
  if (Array.isArray(value)) return { rows: value as ExtractedRow[] };
  if (value && typeof value === 'object' && (value as InPageRun).__matrx_run === true) {
    const run = value as InPageRun;
    return {
      rows: run.rows,
      ...(run.notice && { notice: run.notice }),
      ...(run.signature !== undefined && { signature: run.signature }),
    };
  }
  throw new Error('The page did not return an extraction result. Try running the pattern again.');
}

function extractionRows(
  result: chrome.scripting.InjectionResult<unknown>[],
  onNotice?: (notice: string) => void,
): ExtractedRow[] {
  const run = readRun(result);
  if (run.notice) onNotice?.(run.notice);
  return run.rows;
}

/**
 * Thrown when a saved pattern's kind can't be re-run via a plain in-page pass
 * (ai_extract, network_capture). Surfaces catch this to route the pattern to
 * its interactive runner — and to avoid bumping last_status='broken' for what
 * is a routing condition, not a pattern failure.
 */
export class InteractiveOnlyError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(
      `Pattern kind "${kind}" can't run in a single page pass — it needs its interactive runner.`,
    );
    this.name = 'InteractiveOnlyError';
    this.kind = kind;
  }
}

export function isInteractiveOnlyKind(kind: string): boolean {
  return getMode(kind)?.interactiveOnly === true;
}

/**
 * Mode-aware pattern runner. Replaces inline chrome.scripting calls in DataView.
 * Looks up the pattern's kind in the registry, builds the per-mode config, and
 * executes the mode's runInPage function in the active tab.
 */
export async function runPattern(
  pattern: ExtractionPattern,
  tabId: number,
  documentId?: string,
  onNotice?: (notice: string) => void,
): Promise<ExtractedRow[]> {
  const mode = getMode(pattern.kind);
  if (!mode) throw new Error(`Unknown pattern kind: ${pattern.kind}`);
  if (mode.interactiveOnly) throw new InteractiveOnlyError(pattern.kind);

  const config = mode.buildConfig
    ? mode.buildConfig({
        config: pattern.config,
        fields: pattern.fields,
        list_root_selector: pattern.list_root_selector,
      })
    : (pattern.config ?? {});

  if (mode.runInExtension) {
    if (!documentId)
      throw new Error('Page identity is unavailable. Reload the page and run this pattern again.');
    return mode.runInExtension(tabId, config, documentId);
  }
  if (!mode.runInPage) throw new Error(`Pattern kind "${pattern.kind}" has no runner.`);

  const result = await chrome.scripting.executeScript({
    target: { tabId, ...(documentId && { documentIds: [documentId] }) },
    func: mode.runInPage as (cfg: unknown) => ExtractedRow[],
    args: [safeArg(config)],
  });

  return extractionRows(result, onNotice);
}

export async function detectModeInPage(
  modeId: string,
  tabId: number,
  config?: unknown,
  documentId?: string,
): Promise<DetectionHint | null> {
  const mode = getMode(modeId);
  if (!mode) return null;
  const result = await chrome.scripting.executeScript({
    target: { tabId, ...(documentId && { documentIds: [documentId] }) },
    func: mode.detectInPage as (cfg?: unknown) => DetectionHint,
    args: [safeArg(config)],
  });
  const hint = (result?.[0]?.result ?? null) as DetectionHint | null;
  if (hint === null) return null;
  // THE PROBE RETURNS FACTS; THE EXTENSION REALM RENDERS THEM (2026-09-12).
  // `detectInPage` runs in the page, where no import exists — which is why a
  // mode that wanted to print a byte count used to divide by 1024 and append
  // " KB" in there. The hook runs HERE, where `@ai-matrx/kit/format` resolves.
  return mode.summarize ? { ...hint, summary: mode.summarize(hint) } : hint;
}

/**
 * Run a mode against the active tab without a saved pattern. Used by Showcase
 * sub-tabs to preview rows before the user saves anything.
 */
export async function runMode(
  modeId: string,
  tabId: number,
  config: unknown,
  documentId?: string,
  onNotice?: (notice: string) => void,
): Promise<ExtractedRow[]> {
  const mode = getMode(modeId);
  if (!mode) throw new Error(`Unknown mode: ${modeId}`);
  // Same guard as runPattern — the in-page stub for interactive kinds
  // "succeeds" with 0 rows, which a DB-added ai_extract/network recipe
  // would otherwise silently hit.
  if (mode.interactiveOnly) throw new InteractiveOnlyError(modeId);
  if (mode.runInExtension) {
    if (!documentId)
      throw new Error('Page identity is unavailable. Reload the page and run this mode again.');
    return mode.runInExtension(tabId, config, documentId);
  }
  if (!mode.runInPage) throw new Error(`Mode "${modeId}" has no runner.`);
  const result = await chrome.scripting.executeScript({
    target: { tabId, ...(documentId && { documentIds: [documentId] }) },
    func: mode.runInPage as (cfg: unknown) => ExtractedRow[],
    args: [safeArg(config)],
  });
  return extractionRows(result, onNotice);
}

/**
 * Describe the table the person picked so a saved pattern can find it again by
 * what it is (headers, caption, heading, id) instead of its position.
 */
export async function describeTableSignature(
  tabId: number,
  tableIndex: number,
  documentId?: string,
): Promise<unknown | null> {
  const mode = getMode('auto_table');
  if (!mode?.runInPage) return null;
  const result = await chrome.scripting.executeScript({
    target: { tabId, ...(documentId && { documentIds: [documentId] }) },
    func: mode.runInPage as (cfg: unknown) => ExtractedRow[],
    args: [{ table_index: tableIndex, describe_only: true }],
  });
  return readRun(result).signature ?? null;
}
