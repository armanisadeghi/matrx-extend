/**
 * Resolution helpers for the tool-display registry. Everything here is silent
 * on bad input — invalid paths return undefined, unknown transforms/icons log
 * a console.warn and return a sensible fallback. Nothing throws into a render.
 */

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import type { ComponentType } from 'react';
import type { ToolTimelineEntry } from '../ToolTimelineRow';
import { transforms } from './registry-transforms';
import type { ColorToken, IconName, Phase, PhaseAware, TransformName } from './types';

/**
 * If `v` is a `PhaseMap` (a plain object whose only keys are phase names),
 * return the entry for the current phase (or undefined). Otherwise return `v`
 * as-is — single-value config applies to every phase.
 */
export function resolvePhase<T>(v: PhaseAware<T> | undefined, phase: Phase): T | undefined {
  if (v == null) return undefined;
  if (isPhaseMap<T>(v)) return v[phase];
  return v;
}

function isPhaseMap<T>(v: unknown): v is Partial<Record<Phase, T>> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (keys.length === 0) return false;
  return keys.every((k) => k === 'started' || k === 'completed' || k === 'error');
}

/**
 * Resolve a dot-path against a tool entry. Recognized roots: args, output,
 * result (alias of output), message, toolName, callId. Numeric path segments
 * index into arrays. Returns undefined silently on any miss.
 *
 *   getByPath(entry, 'args.key')              → entry.args.key
 *   getByPath(entry, 'output.items.0.title')  → entry.output.items[0].title
 *   getByPath(entry, 'result.label')          → entry.output.label   (alias)
 */
export function getByPath(entry: ToolTimelineEntry, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split('.');
  const head = segments[0];
  let cursor: unknown;
  switch (head) {
    case 'args':
      cursor = entry.args;
      break;
    case 'output':
    case 'result':
      cursor = entry.output;
      break;
    case 'message':
      cursor = entry.message;
      break;
    case 'toolName':
      cursor = entry.toolName;
      break;
    case 'callId':
      cursor = entry.callId;
      break;
    default:
      return undefined;
  }
  for (let i = 1; i < segments.length; i++) {
    if (cursor == null) return undefined;
    const seg = segments[i];
    if (seg === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/**
 * Run a value through one or more named transforms. Unknown names log a
 * warning and pass the value through. A throwing transform logs and returns
 * the last good value.
 */
export function applyTransforms(
  value: unknown,
  names?: TransformName | TransformName[] | null,
): unknown {
  if (names == null) return value;
  const list = Array.isArray(names) ? names : [names];
  let cursor = value;
  for (const name of list) {
    const fn = transforms[name];
    if (!fn) {
      console.warn(`[tool-display] unknown transform: "${name}"`);
      continue;
    }
    try {
      cursor = fn(cursor);
    } catch (err) {
      console.warn(`[tool-display] transform "${name}" threw:`, err, { value: cursor });
    }
  }
  return cursor;
}

const COLOR_CLASSES: Record<ColorToken, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-slate-600 dark:text-slate-400',
  primary: 'text-primary',
  muted: 'text-muted-foreground',
};

/**
 * Resolve a color token to a tailwind class. Error phase always wins (red),
 * even if the registry tries to override it — keeps error visuals consistent.
 */
export function resolveColor(token: ColorToken | undefined, phase: Phase): string {
  if (phase === 'error') return COLOR_CLASSES.red;
  if (token && COLOR_CLASSES[token]) return COLOR_CLASSES[token];
  if (phase === 'started') return COLOR_CLASSES.primary;
  if (phase === 'completed') return COLOR_CLASSES.emerald;
  return COLOR_CLASSES.muted;
}

const PHASE_DEFAULT_ICON: Record<Phase, ComponentType<{ className?: string }>> = {
  started: Loader2,
  completed: CheckCircle2,
  error: AlertTriangle,
};

/**
 * Look up an icon by lucide-react export name. Unknown name → warn + use the
 * phase default. (`Loader2` for started, `CheckCircle2` for completed,
 * `AlertTriangle` for error.)
 */
export function resolveIcon(
  name: IconName | undefined,
  phase: Phase,
): ComponentType<{ className?: string }> {
  if (!name) return PHASE_DEFAULT_ICON[phase];
  const found = (LucideIcons as unknown as Record<string, unknown>)[name];
  if (typeof found === 'object' || typeof found === 'function') {
    return found as ComponentType<{ className?: string }>;
  }
  console.warn(`[tool-display] unknown lucide icon: "${name}"`);
  return PHASE_DEFAULT_ICON[phase];
}
