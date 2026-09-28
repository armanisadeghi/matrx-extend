import { useActiveTab } from '@/hooks/use-active-tab';
import { urlMatchesPattern } from '@/lib/data-pattern/matcher';
import { isInteractiveOnlyKind, runPattern } from '@/lib/data-pattern/run-pattern';
import { classifySavedRun } from '@/lib/data-pattern/saved-run-outcome';
import {
  type ExtractionPattern,
  bumpPatternRun,
  fetchPatternsForDomain,
} from '@/lib/supabase/queries';
import { useAuthStore } from '@/state/auth';
import { autoExtractKey, useAutoExtractStore } from '@/state/auto-extract';
import { useEffect, useRef } from 'react';

/**
 * Auto-extract orchestrator. Mount ONCE at the top of the app (we mount in
 * App.tsx). Watches the active tab URL, fetches matching patterns for the
 * host, and fires each in the background. Results land in the auto-extract
 * store; any UI surface (DataView, Showcase) reads from there.
 *
 * Behavior rules — deliberately conservative for v1:
 *   - Only EXTRACT on URL change. We do NOT auto-append rows to a target
 *     dataset; that's still a manual "Save" click. Auto-append can ship
 *     once we have a per-pattern `auto_run` flag the user opts into.
 *   - Skip re-running the same pattern+URL within TTL (debounce on tight
 *     navigation loops).
 *   - On error, mark status='error' and bump pattern's last_status='broken'.
 *   - Each run also calls bumpPatternRun so the Patterns sub-tab health
 *     badge stays current.
 */

const DEBOUNCE_MS = 600;
const TTL_MS = 5 * 60 * 1000; // skip re-run within 5 minutes of a successful run

export function useAutoExtract(): void {
  const signedIn = useAuthStore((state) => state.status === 'signed-in' && state.user !== null);
  const tab = useActiveTab();
  const records = useAutoExtractStore((s) => s.records);
  const setRecord = useAutoExtractStore((s) => s.setRecord);
  const pruneTo = useAutoExtractStore((s) => s.pruneTo);

  const pageKey = `${tab.id ?? 'none'}|${tab.url ?? ''}`;
  const currentPage = useRef(pageKey);
  currentPage.current = pageKey;

  useEffect(() => {
    const url = tab.url ?? null;
    pruneTo(tab.id, url);
  }, [tab.id, tab.url, pruneTo]);

  useEffect(() => {
    if (!signedIn) return;
    const tabId = tab.id;
    const url = tab.url;
    if (!tabId || !url) return;

    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    if (!host) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled || currentPage.current !== pageKey) return;

      let patterns: ExtractionPattern[];
      try {
        patterns = await fetchPatternsForDomain(host);
      } catch {
        return;
      }
      if (cancelled || currentPage.current !== pageKey) return;

      // Interactive-only kinds (ai_extract, network_capture) are never run in
      // the background — no surprise reloads or agent spend without a click.
      const matched = patterns.filter(
        (p) => urlMatchesPattern(url, p) && !isInteractiveOnlyKind(p.kind),
      );
      if (matched.length === 0) return;

      // Fire each matching pattern in parallel.
      await Promise.all(
        matched.map(async (pattern) => {
          if (cancelled || currentPage.current !== pageKey) return;
          const key = autoExtractKey(pattern.id, tabId, url);
          const existing = records.get(key);
          if (existing && existing.status === 'ok' && Date.now() - existing.lastRunAt < TTL_MS) {
            return; // recent successful run — skip
          }
          setRecord(key, {
            pattern,
            url,
            tabId,
            rows: [],
            status: 'running',
            lastRunAt: Date.now(),
          });

          try {
            const rows = await runPattern(pattern, tabId);
            if (cancelled || currentPage.current !== pageKey) return;
            const outcome = classifySavedRun(pattern, url, rows);
            setRecord(key, {
              pattern,
              url,
              tabId,
              rows,
              status: outcome.kind === 'matched' ? 'ok' : 'no_match',
              ...(outcome.message && { note: outcome.message }),
              lastRunAt: Date.now(),
            });
            if (outcome.kind === 'matched') {
              const updateError = await bumpPatternRun(pattern.id, 'ok', rows.length);
              if (updateError && !cancelled && currentPage.current === pageKey) {
                setRecord(key, {
                  pattern,
                  url,
                  tabId,
                  rows,
                  status: 'ok',
                  note: [outcome.message, `Saved run history could not be updated: ${updateError}`]
                    .filter(Boolean)
                    .join(' '),
                  lastRunAt: Date.now(),
                });
              }
            }
          } catch (err) {
            if (cancelled || currentPage.current !== pageKey) return;
            const errorMessage = err instanceof Error ? err.message : String(err);
            setRecord(key, {
              pattern,
              url,
              tabId,
              rows: [],
              status: 'error',
              error: errorMessage,
              lastRunAt: Date.now(),
            });
            const updateError = await bumpPatternRun(pattern.id, 'broken', 0);
            if (updateError && !cancelled && currentPage.current === pageKey) {
              setRecord(key, {
                pattern,
                url,
                tabId,
                rows: [],
                status: 'error',
                error: `${errorMessage} Saved run history could not be updated: ${updateError}`,
                lastRunAt: Date.now(),
              });
            }
          }
        }),
      );
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // We intentionally exclude `records` and `setRecord` from deps — they're
    // stable from Zustand and including `records` would re-fire on every
    // store update. (useExhaustiveDependencies is warn-level during the
    // lint-baseline ratchet, so no suppression needed.)
  }, [signedIn, tab.id, tab.url]);
}
