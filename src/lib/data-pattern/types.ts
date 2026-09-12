import type { z } from 'zod';

export type DetectionHint = {
  available: boolean;
  summary: string;
  count?: number;
  meta?: Record<string, unknown>;
};

export type ExtractedRow = Record<string, unknown>;

export type PatternForBuildConfig = {
  config: unknown;
  fields: unknown;
  list_root_selector: string | null;
};

/**
 * Self-contained extraction mode.
 *
 * `detectInPage` and `runInPage` cross the chrome.scripting boundary via
 * .toString() — they MUST be standalone JS (no imports, no outer-scope refs).
 * Any helpers a mode needs go inline inside those functions.
 */
export type ExtractionMode<TConfig = unknown> = {
  id: string;
  label: string;
  description: string;
  configSchema: z.ZodType<TConfig>;
  defaultConfig: () => TConfig;
  detectInPage: (config?: TConfig) => DetectionHint;
  runInPage: (config: TConfig) => ExtractedRow[];
  buildConfig?: (pattern: PatternForBuildConfig) => TConfig;
  /**
   * Rewrite the hint's `summary` in the EXTENSION realm, from the facts the
   * probe returned in `meta`.
   *
   * WHY THIS EXISTS (2026-09-12). `detectInPage` crosses the chrome.scripting
   * boundary, so it genuinely cannot import a package symbol — and that fact
   * was being used as a reason to let a probe keep FORMATTING. It is not one:
   * the probe's job is to report facts about the page, and a byte count is a
   * fact while "12.4 KB" is a rendering decision. `next_data`'s probe divided
   * by 1024 and appended " KB" inside the page; now it returns the sizes it
   * already carried in `meta.sources` and this hook, which runs where the
   * imports DO exist, calls `formatFileSize`. The boundary was never the
   * problem — the probe returning a sentence instead of a number was.
   *
   * `detectModeInPage` applies it to every hint. Optional: a mode whose summary
   * is a constant ("Manual mode") has nothing to format.
   */
  summarize?: (hint: DetectionHint) => string;
  /**
   * True for modes whose runInPage is a stub (ai_extract, network_capture):
   * a real run needs surface-level orchestration (agent stream / re-capture),
   * not a single executeScript pass. `runPattern` refuses these so they can
   * never silently "succeed" with 0 rows; surfaces route them to the
   * interactive runner instead.
   */
  interactiveOnly?: boolean;
};
