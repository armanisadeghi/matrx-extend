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
};
