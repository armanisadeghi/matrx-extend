/**
 * Guidance — user-saved clues for the agent.
 *
 * Lists notes, screenshots, GIFs, and demo references the user has
 * saved per-domain. Each item auto-surfaces in chat context the next
 * time the user (or agent) visits a matching domain. Demos additionally
 * become callable as `replay_demo`.
 *
 * Layout mirrors AgendaView: header with add menu + filter pills +
 * scrolling list. Recording mutex per
 * `useGuidanceStore.recording` — only one capture (demo OR gif) at a
 * time per the existing recorder backend.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { log } from '@/lib/debug/log';
import { listAllGuidance } from '@/lib/guidance/storage';
import type { GuidanceKind, GuidanceSummary } from '@/lib/guidance/types';
import { type GuidanceFilter, useGuidanceStore } from '@/state/guidance';
import {
  BookOpen,
  Camera,
  Clapperboard,
  ImageIcon,
  Loader2,
  Play,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DemoSaveDialog } from './DemoSaveDialog';
import { GuidancePreview } from './GuidancePreview';
import {
  captureScreenshotAsGuidance,
  deleteGuidance,
  discardDemoRecording,
  discardGifRecording,
  saveNoteAsGuidance,
  startDemoRecordingAsGuidance,
  startGifRecordingAsGuidance,
  stopDemoRecordingAndSave,
  stopGifRecordingAsGuidance,
} from './actions';

type AddMenu = 'closed' | 'note' | 'demo-stop' | 'gif-stop';

export function GuidanceView() {
  const items = useGuidanceStore((s) => s.items);
  const filter = useGuidanceStore((s) => s.filter);
  const selectedId = useGuidanceStore((s) => s.selectedId);
  const recording = useGuidanceStore((s) => s.recording);
  const setItems = useGuidanceStore((s) => s.setItems);
  const setFilter = useGuidanceStore((s) => s.setFilter);
  const setSelectedId = useGuidanceStore((s) => s.setSelectedId);
  const setRecording = useGuidanceStore((s) => s.setRecording);
  const upsertSummary = useGuidanceStore((s) => s.upsertSummary);
  const removeSummary = useGuidanceStore((s) => s.removeSummary);

  const [addMenu, setAddMenu] = useState<AddMenu>('closed');
  const [busy, setBusy] = useState<
    null | 'screenshot' | 'gif-start' | 'gif-stop' | 'demo-start' | 'demo-stop'
  >(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);

  // Active tab domain — defaults the "save" scope and filters by domain.
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      try {
        if (tab?.url) setActiveDomain(new URL(tab.url).hostname);
      } catch {
        /* tab without a URL — leave as null */
      }
    });
  }, []);

  // Initial load.
  const refresh = useCallback(async () => {
    const list = await listAllGuidance();
    setItems(list);
  }, [setItems]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Filtered + sorted list (most recent first).
  const filtered = useMemo(() => {
    if (!items) return null;
    const base = filter === 'all' ? items : items.filter((g) => g.kind === filter);
    return base.slice().sort((a, b) => b.updated_at - a.updated_at);
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<GuidanceFilter, number> = {
      all: 0,
      note: 0,
      screenshot: 0,
      gif: 0,
      demo_ref: 0,
    };
    if (!items) return c;
    c.all = items.length;
    for (const g of items) c[g.kind]++;
    return c;
  }, [items]);

  // ── Capture handlers ────────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    if (busy) return;
    setBusy('screenshot');
    setErrorMsg(null);
    try {
      const item = await captureScreenshotAsGuidance();
      upsertSummary(toSummary(item));
      setAddMenu('closed');
    } catch (err) {
      setErrorMsg((err as Error).message);
      log.error('ui', 'screenshot guidance failed', err);
    } finally {
      setBusy(null);
    }
  }, [busy, upsertSummary]);

  const handleStartGif = useCallback(async () => {
    if (busy) return;
    if (recording.kind !== 'idle') {
      setErrorMsg('Stop the active recording first.');
      return;
    }
    setBusy('gif-start');
    setErrorMsg(null);
    try {
      const handle = await startGifRecordingAsGuidance();
      setRecording({ kind: 'gif', tab_id: handle.tabId, started_at: handle.startedAt });
      setAddMenu('gif-stop');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [busy, recording.kind, setRecording]);

  const handleStopGif = useCallback(
    async (caption?: string) => {
      if (recording.kind !== 'gif') return;
      setBusy('gif-stop');
      setErrorMsg(null);
      try {
        const item = await stopGifRecordingAsGuidance({ tabId: recording.tab_id, caption });
        upsertSummary(toSummary(item));
        setRecording({ kind: 'idle' });
        setAddMenu('closed');
      } catch (err) {
        setErrorMsg((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [recording, setRecording, upsertSummary],
  );

  const handleDiscardGif = useCallback(async () => {
    if (recording.kind !== 'gif') return;
    await discardGifRecording(recording.tab_id);
    setRecording({ kind: 'idle' });
    setAddMenu('closed');
  }, [recording, setRecording]);

  const handleStartDemo = useCallback(async () => {
    if (busy) return;
    if (recording.kind !== 'idle') {
      setErrorMsg('Stop the active recording first.');
      return;
    }
    setBusy('demo-start');
    setErrorMsg(null);
    try {
      const handle = await startDemoRecordingAsGuidance();
      setRecording({
        kind: 'demo',
        tab_id: handle.tabId,
        recording_id: handle.recordingId,
        started_at: handle.startedAt,
        steps_captured: 0,
      });
      setAddMenu('demo-stop');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [busy, recording.kind, setRecording]);

  const handleStopDemo = useCallback(
    async (input: { name: string; description?: string }) => {
      if (recording.kind !== 'demo') return;
      setBusy('demo-stop');
      setErrorMsg(null);
      try {
        const { demo: _demo, guidance_id } = await stopDemoRecordingAndSave({
          name: input.name,
          description: input.description,
        });
        if (guidance_id) {
          await refresh();
        }
        setRecording({ kind: 'idle' });
        setAddMenu('closed');
      } catch (err) {
        setErrorMsg((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [recording, refresh, setRecording],
  );

  const handleDiscardDemo = useCallback(async () => {
    if (recording.kind !== 'demo') return;
    await discardDemoRecording();
    setRecording({ kind: 'idle' });
    setAddMenu('closed');
  }, [recording, setRecording]);

  const handleSaveNote = useCallback(
    async (text: string, caption?: string) => {
      if (!activeDomain) {
        setErrorMsg('Open a tab to attach this note to a domain.');
        return;
      }
      const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t);
      const item = await saveNoteAsGuidance({
        domain: activeDomain,
        text,
        caption,
        origin_url: tab?.url ?? undefined,
      });
      upsertSummary(toSummary(item));
      setAddMenu('closed');
    },
    [activeDomain, upsertSummary],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteGuidance(id);
      removeSummary(id);
    },
    [removeSummary],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="size-4" />
          Guidance
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {items?.length ?? '—'}
          </span>
        </div>
        {recording.kind === 'idle' ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setAddMenu(addMenu === 'closed' ? 'closed' : 'closed') /* close any */}
            onClickCapture={(e) => {
              e.preventDefault();
              setAddMenu(addMenu === 'closed' ? 'note' : 'closed');
            }}
          >
            <Plus className="size-3" />
            Add
          </Button>
        ) : (
          <RecordingChip
            kind={recording.kind}
            stepCount={recording.kind === 'demo' ? recording.steps_captured : undefined}
            onStop={() =>
              recording.kind === 'demo'
                ? setAddMenu('demo-stop')
                : recording.kind === 'gif'
                  ? handleStopGif()
                  : undefined
            }
          />
        )}
      </div>

      {/* Add menu — appears below header when 'note' / 'demo-stop' / 'gif-stop' */}
      {addMenu === 'note' && recording.kind === 'idle' && (
        <AddBar
          activeDomain={activeDomain}
          busy={busy}
          onScreenshot={handleScreenshot}
          onStartGif={handleStartGif}
          onStartDemo={handleStartDemo}
          onPickNote={() => setAddMenu('note')}
          onClose={() => setAddMenu('closed')}
        >
          <NoteForm onSave={handleSaveNote} onCancel={() => setAddMenu('closed')} />
        </AddBar>
      )}
      {addMenu === 'demo-stop' && recording.kind === 'demo' && (
        <DemoSaveDialog
          onSave={handleStopDemo}
          onDiscard={handleDiscardDemo}
          busy={busy === 'demo-stop'}
        />
      )}
      {addMenu === 'gif-stop' && recording.kind === 'gif' && (
        <GifStopBar
          onStop={(caption) => handleStopGif(caption)}
          onDiscard={handleDiscardGif}
          busy={busy === 'gif-stop'}
        />
      )}

      {/* Error banner */}
      {errorMsg && (
        <div className="flex shrink-0 items-center justify-between border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="rounded p-1 hover:bg-destructive/20"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-1.5">
        <FilterPill value="all" current={filter} count={counts.all} onSelect={setFilter}>
          All
        </FilterPill>
        <FilterPill value="note" current={filter} count={counts.note} onSelect={setFilter}>
          Notes
        </FilterPill>
        <FilterPill
          value="screenshot"
          current={filter}
          count={counts.screenshot}
          onSelect={setFilter}
        >
          Screenshots
        </FilterPill>
        <FilterPill value="gif" current={filter} count={counts.gif} onSelect={setFilter}>
          GIFs
        </FilterPill>
        <FilterPill value="demo_ref" current={filter} count={counts.demo_ref} onSelect={setFilter}>
          Demos
        </FilterPill>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {!filtered ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-12 text-center text-xs text-muted-foreground">
            <p>No guidance saved yet.</p>
            <p className="mt-1">
              Click <span className="font-medium">Add</span> to record a demo, capture a screenshot,
              or leave a note for the agent.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {filtered.map((g) => (
              <GuidanceRow
                key={g.id}
                item={g}
                expanded={selectedId === g.id}
                onToggle={() => setSelectedId(selectedId === g.id ? null : g.id)}
                onDelete={() => handleDelete(g.id)}
                onRefresh={refresh}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function FilterPill({
  value,
  current,
  count,
  children,
  onSelect,
}: {
  value: GuidanceFilter;
  current: GuidanceFilter;
  count: number;
  children: React.ReactNode;
  onSelect: (v: GuidanceFilter) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
      }`}
    >
      {children}
      <span className="font-mono tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function RecordingChip({
  kind,
  stepCount,
  onStop,
}: {
  kind: 'demo' | 'gif';
  stepCount?: number;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onStop}
      className={`flex h-7 items-center gap-1.5 rounded-full px-2 text-xs font-medium ${
        kind === 'demo'
          ? 'bg-red-600/95 text-white hover:bg-red-700'
          : 'bg-amber-600/95 text-white hover:bg-amber-700'
      }`}
    >
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-white" />
      {kind === 'demo'
        ? `Recording demo${stepCount != null ? ` · ${stepCount}` : ''}`
        : 'Recording GIF'}
      <span className="ml-1 opacity-80">stop</span>
    </button>
  );
}

function AddBar({
  busy,
  onScreenshot,
  onStartGif,
  onStartDemo,
  onClose,
  children,
}: {
  activeDomain: string | null;
  busy: string | null;
  onScreenshot: () => void;
  onStartGif: () => void;
  onStartDemo: () => void;
  onPickNote: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border/50 bg-muted/20 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-1 text-[11px] text-muted-foreground">Add:</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onScreenshot}
          disabled={busy === 'screenshot'}
        >
          {busy === 'screenshot' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Camera className="size-3" />
          )}
          Screenshot
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onStartGif}
          disabled={busy === 'gif-start'}
        >
          {busy === 'gif-start' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ImageIcon className="size-3" />
          )}
          GIF
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onStartDemo}
          disabled={busy === 'demo-start'}
        >
          {busy === 'demo-start' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Clapperboard className="size-3" />
          )}
          Demo
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={onClose}>
          <X className="size-3" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function NoteForm({
  onSave,
  onCancel,
}: {
  onSave: (text: string, caption?: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 rounded border border-border/60 bg-background p-2">
      <Label className="text-[11px] text-muted-foreground">
        <StickyNote className="mr-1 inline size-3" />
        Note for agent on the active domain
      </Label>
      <Input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Caption (optional)"
        className="h-7 text-xs"
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What should the agent know? e.g., 'Always use the GraphQL API for this site, REST is rate-limited.'"
        rows={3}
        className="text-xs"
      />
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-7 px-2 text-xs"
          disabled={!text.trim()}
          onClick={() => onSave(text.trim(), caption.trim() || undefined)}
        >
          Save note
        </Button>
      </div>
    </div>
  );
}

function GifStopBar({
  onStop,
  onDiscard,
  busy,
}: {
  onStop: (caption?: string) => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const [caption, setCaption] = useState('');
  return (
    <div className="shrink-0 border-b border-amber-600/30 bg-amber-50/40 px-2 py-1.5 dark:bg-amber-900/10">
      <div className="flex items-center gap-1.5">
        <Input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          className="h-7 flex-1 text-xs"
        />
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1 px-2 text-xs"
          disabled={busy}
          onClick={() => onStop(caption.trim() || undefined)}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
          Stop & save
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}

function GuidanceRow({
  item,
  expanded,
  onToggle,
  onDelete,
  onRefresh,
}: {
  item: GuidanceSummary;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <li className="group">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/30"
      >
        <KindIcon kind={item.kind} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm">{item.caption ?? defaultLabel(item.kind)}</span>
            <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[9px] font-mono">
              {item.kind}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {item.domain} · {timeAgo(item.updated_at)}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="size-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete"
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/40 bg-muted/10 px-3 py-2">
          <GuidancePreview itemId={item.id} onChanged={onRefresh} />
        </div>
      )}
    </li>
  );
}

function KindIcon({ kind }: { kind: GuidanceKind }) {
  const cls = 'mt-0.5 size-3.5 shrink-0';
  switch (kind) {
    case 'note':
      return <StickyNote className={`${cls} text-emerald-600`} />;
    case 'screenshot':
      return <Camera className={`${cls} text-blue-600`} />;
    case 'gif':
      return <ImageIcon className={`${cls} text-amber-600`} />;
    case 'demo_ref':
      return <Play className={`${cls} text-violet-600`} />;
  }
}

function defaultLabel(kind: GuidanceKind): string {
  switch (kind) {
    case 'note':
      return 'Note';
    case 'screenshot':
      return 'Screenshot';
    case 'gif':
      return 'GIF recording';
    case 'demo_ref':
      return 'Demo';
  }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function toSummary(item: {
  id: string;
  kind: GuidanceKind;
  domain: string;
  caption?: string;
  created_at: number;
  updated_at: number;
  demo_id?: string;
}): GuidanceSummary {
  return {
    id: item.id,
    kind: item.kind,
    domain: item.domain,
    caption: item.caption,
    created_at: item.created_at,
    updated_at: item.updated_at,
    demo_id: item.demo_id,
  };
}
