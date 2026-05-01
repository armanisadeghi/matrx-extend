import { useActiveTab } from '@/hooks/use-active-tab';
import {
  type PagePrepConfig,
  type PagePrepReport,
  defaultPagePrepConfig,
  preparePage,
} from '@/lib/data-pattern/page-prep';
import { useCallback, useState } from 'react';

export function usePagePrep() {
  const tab = useActiveTab();
  const [report, setReport] = useState<PagePrepReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (config: Partial<PagePrepConfig> = {}): Promise<PagePrepReport | null> => {
      if (!tab.id) return null;
      setRunning(true);
      setError(null);
      try {
        const r = await preparePage(tab.id, config);
        setReport(r);
        return r;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setRunning(false);
      }
    },
    [tab.id],
  );

  const reset = useCallback(() => {
    setReport(null);
    setError(null);
  }, []);

  return { tab, report, running, error, run, reset, defaultConfig: defaultPagePrepConfig };
}
