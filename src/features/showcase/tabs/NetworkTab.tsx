import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonTree } from '@/components/ui/json-tree';
import { useNetworkCapture } from '@/hooks/use-network-capture';
import { cn } from '@/lib/utils';
import { Circle, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

const isJsonContentType = (ct: string | undefined): boolean => !!ct && /json/.test(ct);

export function NetworkTab() {
  const { capturing, events, error, installed, start, stop, reload, clear, source, dropped } =
    useNetworkCapture();
  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [extractKeyPath, setExtractKeyPath] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return events;
    const lower = filter.toLowerCase();
    return events.filter(
      (e) =>
        e.url.toLowerCase().includes(lower) || (e.content_type ?? '').toLowerCase().includes(lower),
    );
  }, [events, filter]);

  const selected = selectedIdx !== null ? filtered[selectedIdx] : null;

  const parsedBody = useMemo<unknown | null>(() => {
    if (!selected) return null;
    if (!isJsonContentType(selected.content_type)) {
      // Some sites return JSON with text/html or no Content-Type. Try anyway.
      try {
        const t = selected.body.trim();
        if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
      } catch {
        return null;
      }
      return null;
    }
    try {
      return JSON.parse(selected.body);
    } catch {
      return null;
    }
  }, [selected]);

  const extractedRows = useMemo<Record<string, unknown>[] | null>(() => {
    if (!parsedBody) return null;
    let target: unknown = parsedBody;
    if (extractKeyPath) {
      for (const part of extractKeyPath.split('.')) {
        if (target == null || typeof target !== 'object') break;
        target = (target as Record<string, unknown>)[part];
      }
    }
    if (Array.isArray(target)) return target as Record<string, unknown>[];
    if (target && typeof target === 'object') return [target as Record<string, unknown>];
    return null;
  }, [parsedBody, extractKeyPath]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Network capture
          </div>
          <div className="text-xs text-muted-foreground">
            Patches <code className="rounded bg-secondary/60 px-1">fetch</code> and{' '}
            <code className="rounded bg-secondary/60 px-1">XMLHttpRequest</code> on the active tab.
            Click anywhere on the page after starting — every API response gets recorded. Your best
            path on hostile UIs.
          </div>
        </div>

        <div className="flex gap-2">
          {!capturing ? (
            <Button
              onClick={() => void start()}
              className="flex-1 rounded-full"
              disabled={!installed && capturing}
            >
              <Circle className="size-3.5 fill-red-500 text-red-500" />
              Start capture
            </Button>
          ) : (
            <Button onClick={stop} variant="secondary" className="flex-1 rounded-full">
              <Square className="size-3.5" />
              Stop
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void reload()}
            title="Reload page (catches initial fetches)"
            className="size-9 shrink-0 rounded-full"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={clear}
            title="Clear events"
            disabled={events.length === 0}
            className="size-9 shrink-0 rounded-full"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          {capturing ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              ● recording — {events.length} response{events.length === 1 ? '' : 's'} captured
            </span>
          ) : events.length > 0 ? (
            <>{events.length} responses captured · stopped</>
          ) : (
            <>
              Start capture, then interact with the page. Captures fetch/XHR from the top frame —
              WebSockets, beacons, workers, and iframes are not intercepted.
            </>
          )}
          {dropped > 0 && (
            <span className="ml-1 text-amber-700 dark:text-amber-400">
              · {dropped} oldest dropped (500-event cap)
            </span>
          )}
        </div>

        {events.length > 0 && (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by URL or content-type (e.g. voyager, json)"
            className="h-8 rounded-full bg-secondary/40 text-xs"
          />
        )}

        {filtered.length > 0 && (
          <div className="max-h-[260px] space-y-0.5 overflow-y-auto rounded-xl bg-secondary/40 p-1.5">
            {filtered.map((e, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only.
                key={i}
                type="button"
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  'flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left font-mono text-[10px] hover:bg-background/60',
                  selectedIdx === i && 'bg-primary/10 ring-1 ring-primary/40',
                )}
              >
                <StatusBadge status={e.status} />
                <span className="w-8 shrink-0 text-muted-foreground">{e.method}</span>
                <span className="flex-1 truncate">{shortenUrl(e.url)}</span>
                <span className="shrink-0 text-muted-foreground">
                  {(e.body_size / 1024).toFixed(1)}KB
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="space-y-2 rounded-xl bg-secondary/40 p-3">
            <div className="space-y-1 text-[11px]">
              <div className="font-mono break-all">{selected.url}</div>
              <div className="text-muted-foreground">
                {selected.method} · {selected.status}
                {selected.status_text ? ` ${selected.status_text}` : ''} ·{' '}
                {selected.content_type ?? 'unknown'} · {(selected.body_size / 1024).toFixed(1)}KB
                {selected.body_truncated && ' · truncated'}
              </div>
            </div>

            {parsedBody !== null ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-full bg-background px-3 py-1 text-[10px]">
                    {extractKeyPath || '(root)'}
                  </code>
                </div>
                <div className="max-h-[280px] overflow-y-auto">
                  <JsonTree
                    data={parsedBody}
                    onSelectPath={setExtractKeyPath}
                    selectedPath={extractKeyPath}
                    defaultDepth={2}
                  />
                </div>
              </>
            ) : (
              <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 text-[10px]">
                {selected.body.slice(0, 4000)}
                {selected.body.length > 4000 && '\n…'}
              </pre>
            )}
          </div>
        )}

        {extractedRows && (
          <>
            <ResultPreview rows={extractedRows} />
            {extractedRows.length > 0 && selected && (
              <div className="flex justify-end">
                <SaveAsPattern
                  kind="network_capture"
                  config={{
                    url_filter: filter || urlPattern(selected.url),
                    method: selected.method,
                    key_path: extractKeyPath,
                  }}
                  rows={extractedRows}
                  source={source}
                  defaultName={`Network: ${shortenUrl(selected.url, 40)}`}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function shortenUrl(url: string, maxLen = 80): string {
  try {
    const u = new URL(url);
    const tail = u.pathname + u.search;
    return tail.length > maxLen
      ? `${u.host}…${tail.slice(-(maxLen - u.host.length - 1))}`
      : `${u.host}${tail}`;
  } catch {
    return url.slice(0, maxLen);
  }
}

function urlPattern(url: string): string {
  // Generalize a URL into a glob: replace digits/uuids with *.
  try {
    const u = new URL(url);
    let path = u.pathname.replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?/gi,
      '/*/',
    );
    path = path.replace(/\/\d+(?=\/|$)/g, '/*');
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

function StatusBadge({ status }: { status: number }) {
  const ok = status >= 200 && status < 300;
  const redir = status >= 300 && status < 400;
  return (
    <span
      className={cn(
        'inline-block rounded px-1 py-px text-[9px] font-medium',
        ok && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        redir && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        !ok && !redir && 'bg-red-500/15 text-red-600 dark:text-red-400',
      )}
    >
      {status || '—'}
    </span>
  );
}
