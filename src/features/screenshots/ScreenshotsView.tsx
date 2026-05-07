/**
 * Screenshots side-panel tab — gallery of every screenshot taken of the
 * currently-active page (canonical URL match), regardless of whether the
 * agent or the user triggered the capture.
 *
 * The "Take screenshot" button calls the same `take_screenshot` tool
 * handler the agent uses (cross-working principle) — both flows go
 * through `persistScreenshot()` which uploads to cld_files and indexes
 * into `wbx_screenshot`. Listing the tab is a simple Supabase select on
 * `wbx_screenshot.page_url_canonical`.
 *
 * Live-refreshes when:
 *   - The active tab's URL changes (re-query for the new page).
 *   - A `take_screenshot` tool call completes (broadcast on the
 *     TOOL_TIMELINE_EVENT channel — both the agent dispatcher and the
 *     Tools tab manual run emit this).
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useActiveTab } from '@/hooks/use-active-tab';
import { newId } from '@/lib/id';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type ScreenshotRow,
  deleteScreenshot,
  fetchScreenshotsForUrl,
} from '@/lib/supabase/queries';
import { take_screenshot } from '@/lib/tools/handlers/read';
import { normalizeUrl } from '@/lib/url/match';
import {
  Camera,
  ExternalLink,
  Globe2,
  ImageOff,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function ScreenshotsView() {
  const tab = useActiveTab();
  const canonicalUrl = useMemo(() => normalizeUrl(tab.url), [tab.url]);

  const [rows, setRows] = useState<ScreenshotRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Track the URL we last fetched for, so the "tab url change" effect
  // doesn't fire a redundant load while a refresh from the timeline
  // event is still in flight.
  const lastFetchedUrlRef = useRef<string | null>(null);

  const reload = useCallback(
    async (urlCanonical: string | null) => {
      if (!urlCanonical) {
        setRows([]);
        setLoadState('idle');
        return;
      }
      setLoadState('loading');
      setError(null);
      try {
        const data = await fetchScreenshotsForUrl(urlCanonical);
        // Guard against a stale request resolving after the user has
        // navigated to a new page — only commit if the URL still matches.
        if (lastFetchedUrlRef.current !== urlCanonical) return;
        setRows(data);
        setLoadState('ready');
      } catch (err) {
        if (lastFetchedUrlRef.current !== urlCanonical) return;
        setError((err as Error).message ?? 'Failed to load screenshots');
        setLoadState('error');
      }
    },
    [],
  );

  // Re-query whenever the active tab's canonical URL changes.
  useEffect(() => {
    lastFetchedUrlRef.current = canonicalUrl;
    void reload(canonicalUrl);
  }, [canonicalUrl, reload]);

  // Refresh on `take_screenshot` completion (agent or Tools-tab run).
  useEffect(() => {
    const off = on<
      { callId: string; toolName: string; phase: string },
      { ack: true }
    >(CHANNELS.TOOL_TIMELINE_EVENT, (evt) => {
      if (evt.toolName === 'take_screenshot' && evt.phase === 'completed') {
        // Use the latched URL so a navigation that happens during the
        // refresh doesn't accidentally pull data for the old page.
        void reload(lastFetchedUrlRef.current);
      }
      return { ack: true };
    });
    return off;
  }, [reload]);

  const captureNow = useCallback(async () => {
    if (capturing) return;
    if (!tab.id || !tab.url) {
      setCaptureError('No active tab');
      return;
    }
    setCaptureError(null);
    setCapturing(true);
    const callId = newId('user-screenshot');
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId,
      toolName: 'take_screenshot',
      phase: 'started',
      args: { capture_source: 'user' },
    });
    try {
      const result = await take_screenshot.run(
        {
          profile: 'auto',
          format: undefined,
          quality: undefined,
          max_dimension: undefined,
          persist: true,
          capture_source: 'user',
        } as never,
        {
          conversationId: null,
          runId: 'user-screenshots-tab',
          callId,
          agentName: 'user',
          permissionMode: 'act',
          assignedTabId: null,
        },
      );
      const r = result as { ok?: boolean; reason?: string };
      if (r.ok === false) {
        setCaptureError(r.reason ?? 'Screenshot failed');
        broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
          callId,
          toolName: 'take_screenshot',
          phase: 'error',
          message: r.reason ?? 'Screenshot failed',
        });
      } else {
        broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
          callId,
          toolName: 'take_screenshot',
          phase: 'completed',
          output: result,
        });
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'Screenshot failed';
      setCaptureError(msg);
      broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
        callId,
        toolName: 'take_screenshot',
        phase: 'error',
        message: msg,
      });
    } finally {
      setCapturing(false);
    }
  }, [capturing, tab.id, tab.url]);

  const onDelete = useCallback(async (id: string) => {
    const ok = await deleteScreenshot(id);
    if (ok) {
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <Camera className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Screenshots</span>
        {canonicalUrl && (
          <span className="ml-1 truncate text-[11px] text-muted-foreground" title={tab.url ?? ''}>
            {canonicalUrl}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto size-7 p-0"
          onClick={() => void reload(canonicalUrl)}
          disabled={loadState === 'loading' || !canonicalUrl}
          title="Refresh"
        >
          <RefreshCw className={loadState === 'loading' ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!canonicalUrl ? (
          <EmptyMessage
            icon={<Globe2 className="size-5 text-muted-foreground" />}
            title="No active page"
            body="Navigate to a regular web page to see its screenshot history."
          />
        ) : loadState === 'loading' && rows.length === 0 ? (
          <SkeletonGrid />
        ) : loadState === 'error' ? (
          <EmptyMessage
            icon={<ImageOff className="size-5 text-muted-foreground" />}
            title="Couldn't load screenshots"
            body={error ?? 'Try refreshing.'}
          />
        ) : rows.length === 0 ? (
          <EmptyMessage
            icon={<Camera className="size-5 text-muted-foreground" />}
            title="No screenshots yet"
            body="Take one below — every screenshot of this page (yours or the agent's) shows up here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 px-3 py-3">
            {rows.map((row) => (
              <ScreenshotCard key={row.id} row={row} onDelete={() => void onDelete(row.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-1 border-t border-border/50 px-3 py-2">
        {captureError && (
          <div className="text-xs text-destructive">{captureError}</div>
        )}
        <Button
          onClick={() => void captureNow()}
          disabled={capturing || !tab.id || !tab.url}
          className="w-full rounded-full"
        >
          {capturing ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          {capturing ? 'Capturing…' : 'Take screenshot'}
        </Button>
      </div>
    </div>
  );
}

function ScreenshotCard({
  row,
  onDelete,
}: {
  row: ScreenshotRow;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const captured = useMemo(() => formatTimestamp(row.captured_at), [row.captured_at]);
  const dim = row.width && row.height ? `${row.width}×${row.height}` : null;
  const sourceIcon =
    row.source === 'agent' ? (
      <Camera className="size-3" />
    ) : row.source === 'user' ? (
      <UserIcon className="size-3" />
    ) : (
      <Camera className="size-3" />
    );
  const sourceLabel =
    row.source === 'agent' ? 'Agent' : row.source === 'user' ? 'You' : 'Unknown';

  const openFullSize = useCallback(() => {
    if (row.file_url) void chrome.tabs.create({ url: row.file_url });
  }, [row.file_url]);

  const copyUrl = useCallback(() => {
    if (row.file_url) void navigator.clipboard.writeText(row.file_url).catch(() => undefined);
  }, [row.file_url]);

  return (
    <div className="group overflow-hidden rounded-md border border-border/60 bg-card text-xs">
      <button
        type="button"
        onClick={openFullSize}
        disabled={!row.file_url}
        className="block w-full bg-muted/40 transition-opacity hover:opacity-90 disabled:cursor-default disabled:hover:opacity-100"
        title={row.file_url ? 'Open full size' : 'Image URL unavailable'}
      >
        {row.file_url ? (
          <img
            src={row.file_url}
            alt={row.page_title ?? 'screenshot'}
            loading="lazy"
            className="block aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-5" />
          </div>
        )}
      </button>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title="Source">
          {sourceIcon}
          {sourceLabel}
        </span>
        <span className="ml-auto truncate text-[10px] text-muted-foreground" title={captured.full}>
          {captured.short}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 border-t border-border/50 px-1 py-1">
        <span className="px-1 text-[10px] text-muted-foreground" title={`${dim ?? ''}`.trim()}>
          {dim ?? ''}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="size-6 p-0 text-muted-foreground"
            onClick={openFullSize}
            disabled={!row.file_url}
            title="Open full size"
          >
            <ExternalLink className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="size-6 p-0 text-muted-foreground"
            onClick={copyUrl}
            disabled={!row.file_url}
            title="Copy image URL"
          >
            <Link2 className="size-3" />
          </Button>
          <Popover open={confirming} onOpenChange={setConfirming}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="size-6 p-0 text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                <Trash2 className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2 text-xs">
              <div className="mb-2 text-foreground">Delete this screenshot?</div>
              <div className="mb-2 text-muted-foreground">
                Removes the index row only — the file in cloud storage is kept.
              </div>
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                >
                  Delete
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-2 px-3 py-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-md border border-border/60 bg-card"
        >
          <div className="aspect-[4/3] w-full animate-pulse bg-muted/60" />
          <div className="space-y-1 p-2">
            <div className="h-2 w-1/2 animate-pulse rounded bg-muted/60" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyMessage({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted/60">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-xs text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

function formatTimestamp(iso: string): { short: string; full: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { short: iso, full: iso };
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);
  let short: string;
  if (diffMin < 1) short = 'just now';
  else if (diffMin < 60) short = `${diffMin}m ago`;
  else if (diffHr < 24) short = `${diffHr}h ago`;
  else if (diffDay < 7) short = `${diffDay}d ago`;
  else short = d.toLocaleDateString();
  return { short, full: d.toLocaleString() };
}
