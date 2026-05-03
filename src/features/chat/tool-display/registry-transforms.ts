/**
 * Named value transformers — used by both `inline.info` (header text) and
 * `results.keysInfo` (expanded body fields). Add a new transform here, then
 * reference it by name from a registry entry.
 *
 * Contract: `(unknown) => unknown`. A transform should be a no-op for inputs
 * it can't handle (e.g. titleCase only acts on strings) — never throw.
 */

import type { TransformName } from './types';

const titleCaseFn = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  return v
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => (p[0] ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
};

export const transforms: Record<TransformName, (v: unknown) => unknown> = {
  titleCase: titleCaseFn,
  snakeToTitle: titleCaseFn,
  kebabToTitle: titleCaseFn,
  textClean: (v) => (typeof v === 'string' ? v.replace(/\\([_*`])/g, '$1').trim() : v),
  truncate80: (v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}…` : v),
  truncate200: (v) => (typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v),
  lowercase: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  uppercase: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
};
