import type { ExtractionPattern } from '@/lib/supabase/queries';
import { urlMatchesPattern } from './matcher';

export type SavedRunOutcome =
  | { kind: 'matched'; message: null }
  | { kind: 'no_match' | 'off_route'; message: string };

/** Classify a completed saved run before changing its persisted health. */
export function classifySavedRun(
  pattern: ExtractionPattern,
  pageUrl: string,
  rows: readonly unknown[],
): SavedRunOutcome {
  const onSavedRoute = urlMatchesPattern(pageUrl, pattern);
  if (rows.length === 0) {
    return {
      kind: 'no_match',
      message: onSavedRoute
        ? 'No matching data was found on this page. Check whether the saved root and selectors still match, then run again.'
        : 'No matching data was found. This page is outside the saved route; open the intended page or review the saved selectors.',
    };
  }
  if (!onSavedRoute) {
    return {
      kind: 'off_route',
      message: 'This run was outside the saved route. Review these rows before treating them as the intended data.',
    };
  }
  return { kind: 'matched', message: null };
}
