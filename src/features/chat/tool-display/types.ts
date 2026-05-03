/**
 * Display config shapes for the per-tool registry. Every visual segment is
 * `PhaseAware` so a tool can show different text/icons/colors while running,
 * after success, and after failure (e.g. "Getting X" → "Got X" → "Failed to
 * get X"). All fields are optional — anything left out falls back to the
 * default rendering used by tools that aren't registered at all.
 */

import type { ComponentType } from 'react';
import type { ToolTimelineEntry } from '../ToolTimelineRow';

export type Phase = 'started' | 'completed' | 'error';
export type PhaseMap<T> = Partial<Record<Phase, T>>;
export type PhaseAware<T> = T | PhaseMap<T>;

export type IconName = string;
export type ColorToken =
  | 'blue'
  | 'emerald'
  | 'amber'
  | 'red'
  | 'violet'
  | 'slate'
  | 'primary'
  | 'muted';

export type TransformName =
  | 'titleCase'
  | 'snakeToTitle'
  | 'kebabToTitle'
  | 'textClean'
  | 'truncate80'
  | 'truncate200'
  | 'lowercase'
  | 'uppercase'
  | 'formatImageDimensions'
  | 'formatBytes';

export interface InfoSpec {
  path: string;
  transform?: TransformName | TransformName[];
  fallback?: string;
}

export interface InlineConfig {
  hidden?: PhaseAware<boolean>;
  icon?: PhaseAware<IconName>;
  prefix?: PhaseAware<string>;
  /**
   * Default: titleCase(toolName). Pass `''` to suppress, a literal string to
   * override, or an `InfoSpec` to pull the name from args/output (e.g. the
   * category passed into `load_browser_tools`, or the title of the active tab).
   */
  name?: PhaseAware<string | InfoSpec>;
  suffix?: PhaseAware<string>;
  info?: PhaseAware<string | InfoSpec>;
  color?: PhaseAware<ColorToken>;
  isMultiline?: boolean;
  spinIcon?: PhaseAware<boolean>;
}

export interface ArgsConfig {
  hidden?: PhaseAware<boolean>;
  displayType?: 'json' | 'key-value' | 'values-only';
}

export interface ResultsConfig {
  hidden?: PhaseAware<boolean>;
  displayType?: 'json' | 'key-value' | 'values-only' | 'custom';
  keysInfo?: KeyDisplay[];
}

export type FieldComponentName =
  | 'BoldLabel'
  | 'TextDisplay'
  | 'Markdown'
  | 'Code'
  | 'Json'
  | 'Image'
  | 'Base64Image'
  | 'Badge'
  | 'Chips'
  | 'TabCard';

export interface KeyDisplay {
  key: string;
  component: FieldComponentName;
  className?: string;
  transform?: TransformName | TransformName[] | null;
  fallback?: string;
}

export interface ToolDisplayEntry {
  inline?: InlineConfig;
  args?: ArgsConfig;
  results?: ResultsConfig;
  CustomComponent?: ComponentType<{ entry: ToolTimelineEntry; kind: 'server' | 'client' }>;
}
