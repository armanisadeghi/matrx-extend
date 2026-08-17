/**
 * Tools tab → Recorder sub-pane.
 *
 * User-facing surface for the tab-video-capture feature (TASK-003). Shares
 * the offscreen-recorder + cld_files upload path with the agent's
 * `record_tab_video` tool — the only difference is the entry point. The
 * sidepanel UI lives in the Tools tab to avoid bloating the side-panel
 * tab list (the Tools tab is already the home of "exercise the agent's
 * capabilities by hand").
 *
 * Permission model: `tabCapture` is in optional_permissions. The hook
 * runs `chrome.permissions.request` on the first start; the toggle in
 * Settings → Advanced exposes the same grant for users who want to opt
 * in once and never see the prompt.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TabCaptureDialog } from '@/features/tools/TabCaptureDialog';
import { cn } from '@/lib/utils';
import { type RecordingEntry, useRecordingsStore } from '@/lib/video/recordings-store';
import { type RecorderStatus, useTabVideoRecorder } from '@/lib/video/useTabVideoRecorder';
import { Circle, Copy, ExternalLink, Square, Trash2, Video, VideoOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const MIN_DURATION_S = 1;
const MAX_DURATION_S = 60;

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function StatusBadge({ status }: { status: RecorderStatus }) {
  const config: Record<RecorderStatus, { label: string; className: string }> = {
    idle: {
      label: 'Idle',
      className:
        'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300',
    },
    permission: {
      label: 'Checking permission',
      className:
        'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300',
    },
    starting: {
      label: 'Starting',
      className:
        'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300',
    },
    recording: {
      label: 'Recording',
      className:
        'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700/60 dark:bg-rose-950/30 dark:text-rose-300',
    },
    stopping: {
      label: 'Finalizing',
      className:
        'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-300',
    },
    uploading: {
      label: 'Uploading',
      className:
        'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/60 dark:bg-sky-950/30 dark:text-sky-300',
    },
    error: {
      label: 'Error',
      className:
        'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700/60 dark:bg-rose-950/30 dark:text-rose-300',
    },
  };
  const c = config[status];
  return (
    <Badge
      variant="outline"
      className={cn('h-5 px-2 text-[10px] uppercase tracking-wide', c.className)}
    >
      {c.label}
    </Badge>
  );
}

export function RecorderPane() {
  const {
    status,
    errorMessage,
    elapsedMs,
    lastDurationMs,
    recoveryDialogOpen,
    start,
    stop,
    reset,
    confirmRecoveryDialog,
    closeRecoveryDialog,
  } = useTabVideoRecorder();
  const entries = useRecordingsStore((s) => s.entries);
  const hydrated = useRecordingsStore((s) => s.hydrated);
  const hydrate = useRecordingsStore((s) => s.hydrate);
  const removeEntry = useRecordingsStore((s) => s.remove);
  const clearEntries = useRecordingsStore((s) => s.clear);

  const [durationSec, setDurationSec] = useState(5);
  const [audio, setAudio] = useState(false);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Refresh the active-tab snapshot whenever the recorder is idle so the
  // user sees which tab the next recording will capture. We don't refresh
  // mid-recording because the bound tab is already locked.
  useEffect(() => {
    if (status !== 'idle' && status !== 'error') return;
    let cancelled = false;
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!cancelled) setActiveTab(tab ?? null);
      } catch {
        if (!cancelled) setActiveTab(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const isBusy =
    status === 'starting' ||
    status === 'recording' ||
    status === 'stopping' ||
    status === 'uploading' ||
    status === 'permission';
  const isRecording = status === 'recording';

  const handleStart = async (): Promise<void> => {
    if (!activeTab?.id) return;
    const clamped = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, durationSec));
    await start({
      tabId: activeTab.id,
      durationMs: clamped * 1000,
      audio,
    });
  };

  const remainingMs = useMemo(() => {
    if (!isRecording) return null;
    const total = durationSec * 1000;
    return Math.max(0, total - elapsedMs);
  }, [isRecording, elapsedMs, durationSec]);

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="shrink-0 space-y-3 border-b px-3 pb-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Tab recorder</span>
              <StatusBadge status={status} />
            </div>
            <span className="text-[11px] text-muted-foreground">{entries.length} saved</span>
          </div>

          <div className="rounded-md border bg-card p-2.5">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Target tab:</span>
              <span className="truncate" title={activeTab?.url ?? ''}>
                {activeTab?.title ?? '— no active tab —'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="font-medium text-foreground">Duration (sec)</span>
                <Input
                  type="number"
                  min={MIN_DURATION_S}
                  max={MAX_DURATION_S}
                  step={1}
                  value={durationSec}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) {
                      setDurationSec(Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, n)));
                    }
                  }}
                  disabled={isBusy}
                  className="h-7 text-xs"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-medium">
                  {audio ? (
                    <Video className="size-3 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <VideoOff className="size-3 text-muted-foreground" />
                  )}
                  Capture audio
                </span>
                <Switch checked={audio} onCheckedChange={setAudio} disabled={isBusy} />
              </label>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isRecording && (
                  <>
                    <span
                      className="size-2 rounded-full bg-rose-500"
                      style={{ animation: 'pulse 1.2s ease-in-out infinite' }}
                    />
                    <span className="font-mono text-xs tabular-nums">
                      {formatDuration(elapsedMs)}
                    </span>
                    {remainingMs != null && (
                      <span className="text-[11px] text-muted-foreground">
                        / {formatDuration(durationSec * 1000)}
                      </span>
                    )}
                  </>
                )}
                {!isRecording && status === 'uploading' && (
                  <span className="text-[11px] text-muted-foreground">
                    Uploading to your files…
                  </span>
                )}
                {!isRecording && status === 'idle' && lastDurationMs != null && (
                  <span className="text-[11px] text-muted-foreground">
                    Last recording {formatDuration(lastDurationMs)} — see list below
                  </span>
                )}
              </div>
              {isRecording ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void stop()}
                  className="h-7 gap-1.5 px-2.5 text-xs"
                >
                  <Square className="size-3" /> Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void handleStart()}
                  disabled={isBusy || !activeTab?.id}
                  className="h-7 gap-1.5 px-2.5 text-xs"
                >
                  <Circle className="size-3 fill-current" /> Record
                </Button>
              )}
            </div>
          </div>

          {status === 'error' && errorMessage && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-[11px] text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/30 dark:text-rose-300">
              <span className="leading-snug">{errorMessage}</span>
              <Button variant="ghost" size="sm" onClick={reset} className="h-5 px-2 text-[10px]">
                Dismiss
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Recordings
            </span>
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void clearEntries()}
                className="h-6 px-2 text-[11px] text-muted-foreground"
              >
                Clear list
              </Button>
            )}
          </div>
          {!hydrated ? (
            <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              No recordings yet. Hit Record to capture this tab.
            </div>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <RecordingRow
                  key={entry.id}
                  entry={entry}
                  onRemove={() => void removeEntry(entry.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {recoveryDialogOpen && (
        <TabCaptureDialog
          onConfirm={() => void confirmRecoveryDialog()}
          onClose={closeRecoveryDialog}
        />
      )}
    </>
  );
}

function RecordingRow({
  entry,
  onRemove,
}: {
  entry: RecordingEntry;
  onRemove: () => void;
}) {
  const captured = useMemo(() => new Date(entry.capturedAt), [entry.capturedAt]);
  const handleCopyId = (): void => {
    void navigator.clipboard.writeText(entry.fileId).catch(() => undefined);
  };
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px] font-medium">
          <span className="truncate" title={entry.tabTitle ?? ''}>
            {entry.tabTitle ?? 'Untitled tab'}
          </span>
          {entry.audio && (
            <Badge
              variant="outline"
              className="h-4 border-emerald-300 bg-emerald-50 px-1 py-0 text-[9px] uppercase text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-400"
            >
              audio
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span>{captured.toLocaleString()}</span>
          <span>·</span>
          <span>{(entry.durationMs / 1000).toFixed(1)}s</span>
          <span>·</span>
          <span>{formatBytes(entry.sizeBytes)}</span>
          <span>·</span>
          <span className="font-mono">{entry.mimeType}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {entry.fileUrl ? (
            <a
              href={entry.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent"
            >
              <ExternalLink className="size-2.5" /> Open
            </a>
          ) : null}
          <button
            type="button"
            onClick={handleCopyId}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent"
            title={`Copy file_id: ${entry.fileId}`}
          >
            <Copy className="size-2.5" /> file_id
          </button>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="size-6 p-0 text-muted-foreground hover:text-destructive"
        title="Remove from list (does not delete the file)"
      >
        <Trash2 className="size-3" />
      </Button>
    </li>
  );
}
