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
 *   - A screenshot is persisted anywhere (broadcast on the
 *     SCREENSHOT_SAVED channel by `persistScreenshot()`). Covers the
 *     agent path (broadcast originates in the SW so the sidepanel
 *     receives it) and the Tools-tab path. The user-button path on
 *     this same view broadcasts from the sidepanel itself —
 *     chrome.runtime.sendMessage does not loop back to the sender's
 *     own context, so we additionally call reload() inline after a
 *     successful capture below to cover that gap.
 *   - A `take_screenshot` tool call completes via the streaming
 *     dispatcher (TOOL_TIMELINE_EVENT, agent path only — kept for
 *     backwards compatibility with tool calls that fail to persist).
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ENV } from '@/config/env';
import { useActiveTab } from '@/hooks/use-active-tab';
import { downloadFileBytes } from '@/lib/api/routes/files';
import { newId } from '@/lib/id';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { ScreenshotSavedPayload } from '@/lib/screenshot/persist';
import {
  type ScreenshotRow,
  deleteScreenshot,
  fetchScreenshotsForUrl,
} from '@/lib/supabase/queries';
import { take_screenshot } from '@/lib/tools/handlers/read';
import { normalizeUrl } from '@/lib/url/match';
import {
  AlertTriangle,
  Camera,
  ExternalLink,
  FileImage,
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
type CaptureMode = 'visible' | 'full_page';

export function ScreenshotsView() {
  const tab = useActiveTab();
  const canonicalUrl = useMemo(() => normalizeUrl(tab.url), [tab.url]);

  const [rows, setRows] = useState<ScreenshotRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [capturingMode, setCapturingMode] = useState<CaptureMode | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  // Track the URL we last fetched for, so the "tab url change" effect
  // doesn't fire a redundant load while a refresh from the timeline
  // event is still in flight.
  const lastFetchedUrlRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const reload = useCallback(async (urlCanonical: string | null) => {
    const generation = ++loadGenerationRef.current;
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
      // navigated or a newer reload of the same URL has started.
      if (generation !== loadGenerationRef.current || lastFetchedUrlRef.current !== urlCanonical)
        return;
      setRows(data);
      setLoadState('ready');
    } catch (err) {
      if (generation !== loadGenerationRef.current || lastFetchedUrlRef.current !== urlCanonical)
        return;
      setError((err as Error).message ?? 'Failed to load screenshots');
      setLoadState('error');
    }
  }, []);

  // Re-query whenever the active tab's canonical URL changes.
  useEffect(() => {
    lastFetchedUrlRef.current = canonicalUrl;
    void reload(canonicalUrl);
  }, [canonicalUrl, reload]);

  // Refresh on a successful screenshot persistence. Fires for every
  // capture path that calls persistScreenshot — agent dispatcher, Tools
  // tab manual run, or another sidepanel tab. The user-button capture
  // on THIS view will not be received here (Chrome doesn't loop back a
  // chrome.runtime.sendMessage to the sender's own context); the inline
  // reload after `captureNow` covers that case.
  useEffect(() => {
    const off = on<ScreenshotSavedPayload, { ack: true }>(CHANNELS.SCREENSHOT_SAVED, (evt) => {
      if (evt.pageUrlCanonical === lastFetchedUrlRef.current) {
        void reload(lastFetchedUrlRef.current);
      }
      return { ack: true };
    });
    return off;
  }, [reload]);

  // Belt-and-suspenders: also listen for TOOL_TIMELINE_EVENT completions of
  // `take_screenshot` (the streaming-dispatcher path). If persistScreenshot
  // failed to insert the row but the tool itself returned ok, this still
  // triggers a refresh so the gallery doesn't appear stale.
  useEffect(() => {
    const off = on<{ callId: string; toolName: string; phase: string }, { ack: true }>(
      CHANNELS.TOOL_TIMELINE_EVENT,
      (evt) => {
        if (evt.toolName === 'take_screenshot' && evt.phase === 'completed') {
          void reload(lastFetchedUrlRef.current);
        }
        return { ack: true };
      },
    );
    return off;
  }, [reload]);

  const captureNow = useCallback(
    async (mode: CaptureMode) => {
      if (capturingMode) return;
      if (!tab.id || !tab.url) {
        setCaptureError('No active tab');
        return;
      }
      setCaptureError(null);
      setPersistWarning(null);
      setCapturingMode(mode);
      const callId = newId('user-screenshot');
      broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
        callId,
        toolName: 'take_screenshot',
        phase: 'started',
        args: { capture_source: 'user', mode },
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
            mode,
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
        const r = result as {
          ok?: boolean;
          reason?: string;
          screenshot_id?: string | null;
          file_id?: string | null;
          truncated?: boolean;
        };
        if (r.ok === false) {
          setCaptureError(r.reason ?? 'Screenshot failed');
          broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
            callId,
            toolName: 'take_screenshot',
            phase: 'error',
            message: r.reason ?? 'Screenshot failed',
          });
        } else {
          // Capture succeeded but persistence may have failed silently
          // (uploadFile threw, RLS rejected the row, etc.). The handler
          // logs to console; surface a hint here so the user knows why
          // the gallery didn't refresh with a new card.
          if (!r.screenshot_id || !r.file_id) {
            setPersistWarning(
              'Captured, but failed to save to the gallery. Check the SW console for the error.',
            );
          } else if (mode === 'full_page' && r.truncated) {
            setPersistWarning('Page exceeded the 30-screen tile cap; the bottom is cropped.');
          }
          broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
            callId,
            toolName: 'take_screenshot',
            phase: 'completed',
            output: result,
          });
          // broadcast() self-delivers since 2026-06-10, so the
          // TOOL_TIMELINE_EVENT listener above refreshes the gallery for
          // this context too — no direct reload needed (it double-fetched).
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
        setCapturingMode(null);
      }
    },
    [capturingMode, tab.id, tab.url],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const ok = await deleteScreenshot(id);
      if (ok) {
        setRows((prev) => prev.filter((r) => r.id !== id));
        // Supersede any query that captured the deleted row, while retaining
        // unrelated captures and honoring a page navigation that happened
        // during deletion.
        void reload(lastFetchedUrlRef.current);
      }
    },
    [reload],
  );

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

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-border/50 px-3 py-2">
        {captureError && (
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{captureError}</span>
          </div>
        )}
        {persistWarning && !captureError && (
          <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{persistWarning}</span>
          </div>
        )}
        <div className="flex gap-1.5">
          <Button
            onClick={() => void captureNow('visible')}
            disabled={!!capturingMode || !tab.id || !tab.url}
            className="flex-1 rounded-full"
            title="Capture the current viewport only"
          >
            {capturingMode === 'visible' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Camera className="size-3.5" />
            )}
            {capturingMode === 'visible' ? 'Capturing…' : 'Visible'}
          </Button>
          <Button
            onClick={() => void captureNow('full_page')}
            disabled={!!capturingMode || !tab.id || !tab.url}
            variant="secondary"
            className="flex-1 rounded-full"
            title="Scroll the page top → bottom and stitch every viewport into one tall image"
          >
            {capturingMode === 'full_page' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileImage className="size-3.5" />
            )}
            {capturingMode === 'full_page' ? 'Capturing…' : 'Full page'}
          </Button>
        </div>
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const previewTargetRef = useRef<HTMLButtonElement | null>(null);
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
  const sourceLabel = row.source === 'agent' ? 'Agent' : row.source === 'user' ? 'You' : 'Unknown';
  const canonicalFileUrl = `${ENV.FRONTEND_URL}/files/f/${encodeURIComponent(row.file_id)}`;

  const openFullSize = useCallback(() => {
    void chrome.tabs.create({ url: canonicalFileUrl });
  }, [canonicalFileUrl]);

  const copyUrl = useCallback(() => {
    void navigator.clipboard.writeText(canonicalFileUrl).catch(() => undefined);
  }, [canonicalFileUrl]);

  useEffect(() => {
    const target = previewTargetRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setPreviewVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPreviewVisible(entry?.isIntersecting ?? false);
      },
      { rootMargin: '160px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!previewVisible) {
      setPreviewUrl(null);
      setPreviewFailed(false);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setPreviewUrl(null);
    setPreviewFailed(false);
    void downloadFileBytes(row.file_id, controller.signal)
      .then(({ blob }) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPreviewFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewVisible, row.file_id]);

  return (
    <div className="group overflow-hidden rounded-md border border-border/60 bg-card text-xs">
      <button
        ref={previewTargetRef}
        type="button"
        onClick={openFullSize}
        className="block w-full bg-muted/40 transition-opacity hover:opacity-90"
        title="Open in Files"
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={row.page_title ?? 'screenshot'}
            loading="lazy"
            className="block aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-muted-foreground">
            {previewFailed ? (
              <ImageOff className="size-5" />
            ) : (
              <Loader2 className="size-4 animate-spin" />
            )}
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
            title="Open in Files"
          >
            <ExternalLink className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="size-6 p-0 text-muted-foreground"
            onClick={copyUrl}
            title="Copy durable Files URL"
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
      {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((slot) => (
        <div key={slot} className="overflow-hidden rounded-md border border-border/60 bg-card">
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
      <div className="flex size-9 items-center justify-center rounded-full bg-muted/60">{icon}</div>
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
