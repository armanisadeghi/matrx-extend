import { JsonTree } from '@/components/ui/json-tree';
import { useNetworkCapture } from '@/hooks/use-network-capture';
import {
  isCredentialQueryKey,
  networkPatternDefaultName,
  queryKeysInNetworkUrl,
  safeRequestBodyKey,
  sanitizeNetworkUrl,
} from '@/lib/credentials/network-urls';
import type { CapturedNetEvent } from '@/lib/data-pattern/network-tap';
import { matchesUrlFilter, rowsFromBody } from '@/lib/data-pattern/run-interactive';
import { cn } from '@/lib/utils';
import { Button, BasicInput as Input } from '@ai-matrx/design-system';
import { formatFileSize } from '@ai-matrx/kit/format';
import { Circle, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

const isJsonContentType = (ct: string | undefined): boolean => !!ct && /json/.test(ct);

export function NetworkTab() {
  const { capturing, events, error, installed, start, stop, reload, clear, source, dropped } =
    useNetworkCapture();
  const [filter, setFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CapturedNetEvent | null>(null);
  const [extractKeyPath, setExtractKeyPath] = useState('');
  const [replayUrlFilter, setReplayUrlFilter] = useState('');
  const [extraCredentialKeys, setExtraCredentialKeys] = useState<string[]>([]);
  const [urlMatch, setUrlMatch] = useState<'exact' | 'filter'>('exact');
  const [matchRequestBody, setMatchRequestBody] = useState(true);

  const filtered = useMemo(() => {
    if (!filter) return events;
    const lower = filter.toLowerCase();
    return events.filter(
      (e) =>
        e.url.toLowerCase().includes(lower) || (e.content_type ?? '').toLowerCase().includes(lower),
    );
  }, [events, filter]);

  // Search only changes the visible list. Keep the preview pinned to the
  // captured response itself, including when the search hides it.
  const selected = selectedEvent && events.includes(selectedEvent) ? selectedEvent : null;
  const savedUrlFilter = selected
    ? sanitizeNetworkUrl(replayUrlFilter.trim() || selected.url, extraCredentialKeys)
    : '';
  const safeSelectedUrl = selected ? sanitizeNetworkUrl(selected.url, extraCredentialKeys) : '';
  const queryKeys = selected
    ? [
        ...new Set([
          ...queryKeysInNetworkUrl(selected.url),
          ...queryKeysInNetworkUrl(replayUrlFilter),
        ]),
      ]
    : [];
  const selectedBodyKey = selected ? safeRequestBodyKey(selected.request_body_key) : undefined;

  const selectEvent = (event: CapturedNetEvent) => {
    setSelectedEvent(event);
    setExtractKeyPath('');
    setReplayUrlFilter(event.url);
    setExtraCredentialKeys([]);
    setUrlMatch('exact');
    setMatchRequestBody(true);
  };

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
    try {
      return selected ? rowsFromBody(selected.body, extractKeyPath) : null;
    } catch {
      return null;
    }
  }, [parsedBody, extractKeyPath, selected]);

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
            title="Reload page (stops capture; start capture again afterward)"
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
                onClick={() => selectEvent(e)}
                className={cn(
                  'flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left font-mono text-[10px] hover:bg-background/60',
                  selected === e && 'bg-primary/10 ring-1 ring-primary/40',
                )}
              >
                <StatusBadge status={e.status} />
                <span className="w-8 shrink-0 text-muted-foreground">{e.method}</span>
                <span className="flex-1 truncate">
                  {shortenUrl(sanitizeNetworkUrl(e.url, selected === e ? extraCredentialKeys : []))}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatFileSize(e.body_size)}
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="space-y-2 rounded-xl bg-secondary/40 p-3">
            <div className="space-y-1 text-[11px]">
              <div className="font-mono break-all">{safeSelectedUrl}</div>
              <div className="text-muted-foreground">
                {selected.method} · {selected.status}
                {selected.status_text ? ` ${selected.status_text}` : ''} ·{' '}
                {selected.content_type ?? 'unknown'} · {formatFileSize(selected.body_size)}
                {selected.body_truncated && ' · truncated'}
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="network-replay-url-filter"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Request URL to match on rerun
              </label>
              <Input
                id="network-replay-url-filter"
                value={sanitizeNetworkUrl(replayUrlFilter, extraCredentialKeys)}
                onChange={(event) => setReplayUrlFilter(event.target.value)}
                placeholder={safeSelectedUrl}
                className="h-8 rounded-full bg-background text-xs"
              />
              {queryKeys.length > 0 && (
                <div className="space-y-1 text-[10px] text-muted-foreground">
                  <div>
                    Known credential values are masked. Review every query key; unknown keys may
                    still contain a credential.
                  </div>
                  {queryKeys.map((key) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Treat ${key} as credential`}
                        checked={isCredentialQueryKey(key, extraCredentialKeys)}
                        disabled={isCredentialQueryKey(key)}
                        onChange={(event) =>
                          setExtraCredentialKeys((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter((entry) => entry !== key),
                          )
                        }
                      />
                      Treat {key} as credential{isCredentialQueryKey(key) ? ' (recognized)' : ''}
                    </label>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-[11px]">
                URL matching
                <select
                  aria-label="URL matching"
                  value={urlMatch}
                  onChange={(event) =>
                    setUrlMatch(event.target.value === 'exact' ? 'exact' : 'filter')
                  }
                  className="rounded bg-background px-2 py-1"
                >
                  <option value="exact">Exact URL</option>
                  <option value="filter">Partial URL or * wildcard</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={matchRequestBody}
                  onChange={(event) => setMatchRequestBody(event.target.checked)}
                />
                Match the selected request body
              </label>
              <div className="text-[10px] text-muted-foreground">
                Exact URL includes the query and literal * characters. Partial matching uses text or
                * wildcards. Body matching saves only an opaque digest, never the request body.
                Masked credential values may rotate between runs. If different credential values
                match within one capture window, rerun reports ambiguity instead of choosing one.
                Rerun checks the full capture window. Search above only filters this list.
              </div>
              {(!matchRequestBody ||
                selectedBodyKey === 'unavailable' ||
                selectedBodyKey === undefined) && (
                <div className="text-[10px] text-amber-700 dark:text-amber-400">
                  {matchRequestBody
                    ? 'This capture has no stable body identity. Start a fresh capture, or turn off body matching to explicitly use URL and method only.'
                    : 'URL and method only may include different operations. If multiple request identities match, rerun will ask you to narrow the matcher instead of choosing one.'}
                </div>
              )}
              {!matchesUrlFilter(selected.url, savedUrlFilter, urlMatch, extraCredentialKeys) && (
                <div className="text-[10px] text-amber-700 dark:text-amber-400">
                  This matcher does not include the selected response. Rerun may capture different
                  data or find no request.
                </div>
              )}
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
                    url_filter: savedUrlFilter,
                    credential_query_keys: extraCredentialKeys,
                    url_match: urlMatch,
                    body_match: matchRequestBody ? 'exact' : 'ignore',
                    ...(matchRequestBody && {
                      request_body_key: selectedBodyKey ?? 'unavailable',
                    }),
                    method: selected.method,
                    key_path: extractKeyPath,
                  }}
                  rows={extractedRows}
                  source={source}
                  defaultName={networkPatternDefaultName(selected.url, extraCredentialKeys)}
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
