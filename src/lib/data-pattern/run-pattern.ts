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

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: mode.runInPage as (cfg: unknown) => ExtractedRow[],
    args: [safeArg(config)],
  });

  return (result?.[0]?.result ?? []) as ExtractedRow[];
}

export async function detectModeInPage(
  modeId: string,
  tabId: number,
  config?: unknown,
): Promise<DetectionHint | null> {
  const mode = getMode(modeId);
  if (!mode) return null;
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: mode.detectInPage as (cfg?: unknown) => DetectionHint,
    args: [safeArg(config)],
  });
  return (result?.[0]?.result ?? null) as DetectionHint | null;
}

/**
 * Run a mode against the active tab without a saved pattern. Used by Showcase
 * sub-tabs to preview rows before the user saves anything.
 */
export async function runMode(
  modeId: string,
  tabId: number,
  config: unknown,
): Promise<ExtractedRow[]> {
  const mode = getMode(modeId);
  if (!mode) throw new Error(`Unknown mode: ${modeId}`);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: mode.runInPage as (cfg: unknown) => ExtractedRow[],
    args: [safeArg(config)],
  });
  return (result?.[0]?.result ?? []) as ExtractedRow[];
}
