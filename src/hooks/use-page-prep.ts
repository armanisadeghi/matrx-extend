import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import {
  type PagePrepConfig,
  type PagePrepReport,
  defaultPagePrepConfig,
  preparePage,
} from '@/lib/data-pattern/page-prep';
import { useCallback, useEffect, useRef, useState } from 'react';

interface PrepState {
  pageKey: string;
  report: PagePrepReport | null;
  running: boolean;
  error: string | null;
}

function emptyState(pageKey: string): PrepState {
  return { pageKey, report: null, running: false, error: null };
}

export function usePagePrep() {
  const tab = useActiveTab();
  const pageKey = tab.pageKey ?? '';
  const currentPageKey = useRef(pageKey);
  currentPageKey.current = pageKey;
  const runSeq = useRef(0);
  const mounted = useRef(false);
  const [state, setState] = useState<PrepState>(() => emptyState(pageKey));
  // A new page is hidden immediately, including the render before the reset effect runs.
  const visible = state.pageKey === pageKey ? state : emptyState(pageKey);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runSeq.current += 1;
    };
  }, []);

  // An old page's async completion cannot repopulate the new page's status.
  useEffect(() => {
    runSeq.current += 1;
    setState(emptyState(pageKey));
  }, [pageKey]);

  const run = useCallback(
    async (config: Partial<PagePrepConfig> = {}): Promise<PagePrepReport | null> => {
      if (!tab.id || !tab.documentId || !tab.pageKey) return null;
      const seq = ++runSeq.current;
      const startedOn = pageKey;
      const isCurrent = () =>
        mounted.current && seq === runSeq.current && startedOn === currentPageKey.current && isCurrentPageIdentity(startedOn);
      setState({ pageKey: startedOn, report: null, running: true, error: null });
      try {
        const r = await preparePage(tab.id, config, tab.documentId);
        if (isCurrent()) setState({ pageKey: startedOn, report: r, running: true, error: null });
        return isCurrent() ? r : null;
      } catch (err) {
        if (isCurrent()) {
          setState({
            pageKey: startedOn,
            report: null,
            running: true,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return null;
      } finally {
        if (isCurrent()) setState((current) => ({ ...current, running: false }));
      }
    },
    [tab.id, tab.documentId, pageKey],
  );

  const reset = useCallback(() => {
    runSeq.current += 1;
    setState(emptyState(pageKey));
  }, [pageKey]);

  return {
    tab,
    report: visible.report,
    running: visible.running,
    error: visible.error,
    run,
    reset,
    defaultConfig: defaultPagePrepConfig,
  };
}
