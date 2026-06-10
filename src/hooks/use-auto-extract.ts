import { useActiveTab } from '@/hooks/use-active-tab';
import { urlMatchesPattern } from '@/lib/data-pattern/matcher';
import { runPattern } from '@/lib/data-pattern/run-pattern';
import {
  type ExtractionPattern,
  bumpPatternRun,
  fetchPatternsForDomain,
} from '@/lib/supabase/queries';
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
  const tab = useActiveTab();
  const records = useAutoExtractStore((s) => s.records);
  const setRecord = useAutoExtractStore((s) => s.setRecord);
  const pruneTo = useAutoExtractStore((s) => s.pruneTo);

  // useRef to keep the last URL we kicked off, so React-strict-mode
  // double-invocation doesn't fire two runs for the same URL.
  const lastFiredUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const url = tab.url ?? null;
    pruneTo(url);
  }, [tab.url, pruneTo]);

  useEffect(() => {
    const tabId = tab.id;
    const url = tab.url;
    if (!tabId || !url) return;
    if (lastFiredUrlRef.current === url) return;

    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    if (!host) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      lastFiredUrlRef.current = url;

      let patterns: ExtractionPattern[];
      try {
        patterns = await fetchPatternsForDomain(host);
      } catch {
        return;
      }
      if (cancelled) return;

      const matched = patterns.filter((p) => urlMatchesPattern(url, p));
      if (matched.length === 0) return;

      // Fire each matching pattern in parallel.
      await Promise.all(
        matched.map(async (pattern) => {
          if (cancelled) return;
          const key = autoExtractKey(pattern.id, url);
          const existing = records.get(key);
          if (existing && existing.status === 'ok' && Date.now() - existing.lastRunAt < TTL_MS) {
            return; // recent successful run — skip
          }
          setRecord(key, {
            pattern,
            url,
            rows: [],
            status: 'running',
            lastRunAt: Date.now(),
          });

          try {
            const rows = await runPattern(pattern, tabId);
            if (cancelled) return;
            setRecord(key, {
              pattern,
              url,
              rows,
              status: 'ok',
              lastRunAt: Date.now(),
            });
            void bumpPatternRun(pattern.id, 'ok', rows.length);
          } catch (err) {
            if (cancelled) return;
            setRecord(key, {
              pattern,
              url,
              rows: [],
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
              lastRunAt: Date.now(),
            });
            void bumpPatternRun(pattern.id, 'broken', 0);
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
  }, [tab.id, tab.url]);
}
