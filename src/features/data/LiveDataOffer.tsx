import { ENV } from '@/config/env';
import { fetchData, getDataSources } from '@/lib/api/routes/data-sources';
import {
  DEFAULT_FETCH_RECORDS,
  type DataFetchProgress,
  DataFetchRefusal,
  type DataFetchResult,
  type DataSourceCatalog,
  clampRecords,
  estimatePoints,
  matchSourceForUrl,
  tableUrl,
} from '@/lib/data-sources/contract';
import { Button, BasicInput as Input } from '@ai-matrx/design-system';
import { Loader2, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatCount } from '@ai-matrx/kit/format';

/**
 * "Get as table" — offered when the current page belongs to a live-data source in the server's
 * catalog. Nothing is fetched until the person clicks; the cost is quoted in points first.
 */
export function LiveDataOffer({ url, signedIn }: { url: string; signedIn: boolean }) {
  const [catalog, setCatalog] = useState<DataSourceCatalog | null>(null);
  const [count, setCount] = useState(String(DEFAULT_FETCH_RECORDS));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DataFetchProgress | null>(null);
  const [result, setResult] = useState<DataFetchResult | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; limit: string | null } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const ctl = new AbortController();
    getDataSources(ctl.signal)
      .then(setCatalog)
      .catch(() => setCatalog(null));
    return () => ctl.abort();
  }, [signedIn]);

  const source = useMemo(
    () => (catalog ? matchSourceForUrl(url, catalog.sources) : null),
    [catalog, url],
  );
  // A new page starts clean.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on page change only
  useEffect(() => {
    setResult(null);
    setRefusal(null);
    setProgress(null);
  }, [url]);

  if (!signedIn || !catalog || !source) return null;

  const limit = catalog.maxRecordsPerFetch;
  const records = clampRecords(Number(count), limit);
  const points = estimatePoints(source, records);

  const run = async () => {
    setBusy(true);
    setResult(null);
    setRefusal(null);
    setProgress(null);
    try {
      setResult(
        await fetchData(
          { sourceKey: source.key, url, maxRecords: records },
          { onProgress: setProgress },
        ),
      );
    } catch (err) {
      if (err instanceof DataFetchRefusal) {
        setRefusal({
          message: err.userMessage,
          limit: err.limit ? `${err.limit.setting} = ${err.limit.value}` : null,
        });
      } else {
        setRefusal({ message: err instanceof Error ? err.message : String(err), limit: null });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-2 rounded-xl bg-secondary/40 px-3 py-2.5 text-xs"
      data-testid="live-data-offer"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <Table2 className="size-3.5" />
        <span className="truncate">{source.label}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Records</span>
          <Input
            type="number"
            min={1}
            {...(limit ? { max: limit.value } : {})}
            value={count}
            disabled={busy}
            onChange={(e) => setCount(e.target.value)}
            className="h-7 w-20 text-xs"
            aria-label="How many records"
          />
        </label>
        {limit && <span className="text-muted-foreground">limit {limit.value}</span>}
        <span className="ml-auto text-muted-foreground" data-testid="live-data-points">
          {points == null ? 'cost shown after run' : `about ${formatCount(points)} points`}
        </span>
      </div>
      <Button size="sm" className="h-7 w-full rounded-full text-xs" disabled={busy} onClick={run}>
        {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
        Get as table
      </Button>
      {busy && progress && (
        <div className="text-muted-foreground">
          {progress.label}
          {progress.current != null && progress.total != null
            ? ` ${progress.current}/${progress.total}`
            : ''}
        </div>
      )}
      {refusal && (
        <div className="text-destructive" role="alert">
          {refusal.message}
          {refusal.limit && <span className="ml-1 text-muted-foreground">({refusal.limit})</span>}
        </div>
      )}
      {result && (
        <div className="flex items-center justify-between gap-2" data-testid="live-data-done">
          <span className="min-w-0 truncate">
            {result.tableName} · {result.rowsCreated + result.rowsUpdated} rows
            {result.limitApplied ? ` (limited to ${result.limitApplied.value})` : ''}
          </span>
          <a
            href={tableUrl(ENV.FRONTEND_URL, result.tableId)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-primary-foreground"
          >
            Open table
          </a>
        </div>
      )}
    </div>
  );
}
