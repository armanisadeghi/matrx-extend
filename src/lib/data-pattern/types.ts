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
   * True for modes whose runInPage is a stub (ai_extract, network_capture):
   * a real run needs surface-level orchestration (agent stream / re-capture),
   * not a single executeScript pass. `runPattern` refuses these so they can
   * never silently "succeed" with 0 rows; surfaces route them to the
   * interactive runner instead.
   */
  interactiveOnly?: boolean;
};
