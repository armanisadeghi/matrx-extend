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
  | 'sky'
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
  | 'formatBytes'
  | 'browserCategoryIcon'
  // Mega-tool action → verb (e.g. computer.left_click → 'Clicked')
  | 'computerActionVerb'
  | 'computerActionPresent'
  | 'computerActionIcon'
  | 'tabsActionVerb'
  | 'tabsActionPresent'
  | 'tabsActionIcon'
  | 'navigateActionVerb'
  | 'navigateActionPresent'
  | 'aiActionVerb'
  | 'aiActionPresent'
  | 'aiActionIcon'
  | 'memoryActionVerb'
  | 'memoryActionPresent'
  | 'cookiesActionVerb'
  | 'cookiesActionPresent'
  | 'historyActionVerb'
  | 'historyActionPresent'
  | 'bookmarksActionVerb'
  | 'bookmarksActionPresent'
  | 'tabGroupsActionVerb'
  | 'tabGroupsActionPresent'
  | 'recentlyClosedActionVerb'
  | 'recentlyClosedActionPresent'
  | 'stylesheetActionVerb'
  | 'stylesheetActionPresent'
  | 'cdpSessionActionVerb'
  | 'cdpSessionActionPresent'
  | 'cdpEmulateActionVerb'
  | 'cdpEmulateActionPresent'
  | 'webmcpActionVerb'
  | 'webmcpActionPresent'
  | 'clipboardActionVerb'
  | 'clipboardActionPresent'
  | 'downloadsActionVerb'
  | 'downloadsActionPresent'
  | 'waitForConditionVerb'
  | 'waitForConditionPresent'
  // Unified `user` tool — args.type → verb/icon
  | 'userToolVerbPast'
  | 'userToolVerbPresent'
  | 'userToolIcon';

export interface InfoSpec {
  path: string;
  transform?: TransformName | TransformName[];
  fallback?: string;
}

export interface InlineConfig {
  hidden?: PhaseAware<boolean>;
  /**
   * Lucide icon name OR an `InfoSpec` whose path resolves to either:
   *   - a lucide icon name (string passed through `transforms` is fine, e.g.
   *     `browserCategoryIcon` mapping `args.category` → lucide name)
   *   - a URL (http(s):// or data:) — rendered as an `<img>` instead of a
   *     lucide component. Useful for favicons.
   * If the resolution returns nothing, falls back to the phase-default icon.
   */
  icon?: PhaseAware<IconName | InfoSpec>;
  prefix?: PhaseAware<string>;
  /**
   * Default: titleCase(toolName). Pass `''` to suppress, a literal string to
   * override, or an `InfoSpec` to pull the name from args/output (e.g. the
   * category passed into `load_chrome_tools`, or the title of the active tab).
   */
  name?: PhaseAware<string | InfoSpec>;
  suffix?: PhaseAware<string>;
  info?: PhaseAware<string | InfoSpec>;
  color?: PhaseAware<ColorToken>;
  isMultiline?: boolean;
  spinIcon?: PhaseAware<boolean>;
  /**
   * Shimmer the label while phase is `started`. Default: true. Set false to
   * suppress (e.g. very fast tools where the shimmer is overkill).
   */
  shimmerOnRunning?: boolean;
}

export interface ArgsConfig {
  hidden?: PhaseAware<boolean>;
  displayType?: 'json' | 'key-value' | 'values-only';
}

export interface ResultsConfig {
  hidden?: PhaseAware<boolean>;
  displayType?: 'json' | 'key-value' | 'values-only' | 'custom';
  keysInfo?: KeyDisplay[];
  /**
   * When true (and phase is `completed`), render the result content directly
   * under the row — visible by default, no click required. The click-to-expand
   * still works for inspecting args + raw JSON. Use for tools whose result
   * payload IS the point (screenshots, charts).
   */
  alwaysShow?: boolean;
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
  | 'TabCard'
  | 'Table';

export interface KeyDisplay {
  key: string;
  component: FieldComponentName;
  className?: string;
  transform?: TransformName | TransformName[] | null;
  fallback?: string;
}

/**
 * How to render a tool's incremental progress updates (the `progress[]` log
 * a long-running tool emits via server `tool_progress` events or client
 * `ctx.reportProgress`). Entirely optional: a tool with no progress entries
 * renders nothing extra. When entries DO exist, the generic default ('log',
 * auto-collapse) applies even without a config block — registering one only
 * customizes the presentation.
 */
export type ProgressDisplayMode =
  /** Chronological list of recent updates; collapses to a summary on completion. */
  | 'log'
  /** Single status line that the latest update replaces. */
  | 'latest'
  /** Named steps (grouped by `step`) ticking pending → active → done/error. */
  | 'steps';

export interface ProgressConfig {
  hidden?: PhaseAware<boolean>;
  /** Default 'log'. */
  mode?: ProgressDisplayMode;
  /** 'log' mode: how many recent lines to keep visible while running. Default 4. */
  visibleWhileRunning?: number;
  /** Keep progress expanded after completion instead of collapsing. Default false. */
  showWhenComplete?: boolean;
}

export interface ToolDisplayEntry {
  inline?: InlineConfig;
  args?: ArgsConfig;
  results?: ResultsConfig;
  /** Opt-in incremental-progress display for long-running tools. */
  progress?: ProgressConfig;
  CustomComponent?: ComponentType<{ entry: ToolTimelineEntry; kind: 'server' | 'client' }>;
}
