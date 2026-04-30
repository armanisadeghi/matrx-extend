import type { ExtractionPattern } from '@/lib/supabase/queries';
import { getMode } from './registry';
import type { DetectionHint, ExtractedRow } from './types';

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
    args: [config],
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
    args: [config],
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
    args: [config],
  });
  return (result?.[0]?.result ?? []) as ExtractedRow[];
}
