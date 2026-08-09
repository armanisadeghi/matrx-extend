/**
 * Inline detail rendered when a guidance row is expanded. Shape per kind:
 *
 *   note        — full text + caption, edit + save
 *   screenshot  — thumbnail + Annotate button (lazy-loads tldraw)
 *   gif         — embedded <img src=gif_url> (browser animates natively)
 *   demo_ref    — step count, parameters, Replay button (confirms first)
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getDemoOrHydrate } from '@/lib/demos/cloud-sync';
import { replayDemo } from '@/lib/demos/replayer';
import type { Demo } from '@/lib/demos/types';
import { getGuidanceItem, saveGuidanceItem } from '@/lib/guidance/storage';
import type { GuidanceItem } from '@/lib/guidance/types';
import { Camera, Loader2, Pencil, Play } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';

const AnnotationEditor = lazy(() =>
  import('./AnnotationEditor').then((m) => ({ default: m.AnnotationEditor })),
);

export function GuidancePreview({
  itemId,
  onChanged,
}: {
  itemId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [item, setItem] = useState<GuidanceItem | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const g = await getGuidanceItem(itemId);
    setItem(g);
    setLoading(false);
  }, [itemId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Children report saves through this — without the local refetch the
  // preview kept rendering the STALE item (old note text, un-annotated
  // screenshot) until collapse + re-expand; onChanged only refreshes the
  // parent's summaries.
  const handleChanged = useCallback(async () => {
    await reload();
    await onChanged();
  }, [reload, onChanged]);

  if (loading) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Loading…
      </div>
    );
  }
  if (!item) return <div className="text-xs text-muted-foreground">Item missing.</div>;

  if (item.kind === 'note') return <NotePreview item={item} onChanged={handleChanged} />;
  if (item.kind === 'screenshot')
    return <ScreenshotPreview item={item} onChanged={handleChanged} />;
  if (item.kind === 'gif') return <GifPreview item={item} />;
  if (item.kind === 'demo_ref') return <DemoPreview item={item} />;
  return null;
}

function NotePreview({
  item,
  onChanged,
}: {
  item: Extract<GuidanceItem, { kind: 'note' }>;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  // Track upstream refreshes (our own save round-trips through the parent
  // reload) so the next edit starts from the saved text, not a stale copy.
  useEffect(() => {
    if (!editing) setText(item.text);
  }, [item.text, editing]);

  const handleSave = useCallback(async () => {
    await saveGuidanceItem({ ...item, text, updated_at: Date.now() });
    setEditing(false);
    await onChanged();
  }, [item, text, onChanged]);

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full rounded border bg-background p-2 text-xs"
        />
        <div className="flex gap-1.5">
          <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={handleSave}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setText(item.text);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="whitespace-pre-wrap text-xs leading-relaxed">{item.text}</p>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 w-fit gap-1 px-2 text-[11px]"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-3" />
        Edit
      </Button>
    </div>
  );
}

function ScreenshotPreview({
  item,
  onChanged,
}: {
  item: Extract<GuidanceItem, { kind: 'screenshot' }>;
  onChanged: () => void | Promise<void>;
}) {
  const [annotating, setAnnotating] = useState(false);
  const displayUrl = item.annotated_url ?? item.url;
  return (
    <div className="flex flex-col gap-1.5">
      {displayUrl ? (
        <a href={displayUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={displayUrl}
            alt={item.caption ?? 'guidance screenshot'}
            className="max-h-64 w-full rounded border object-contain"
          />
        </a>
      ) : (
        <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
          No URL available — file_id: <span className="font-mono">{item.file_id}</span>
        </div>
      )}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => setAnnotating((v) => !v)}
        >
          <Pencil className="size-3" />
          {item.annotated_file_id ? 'Edit annotations' : 'Annotate'}
        </Button>
        {item.annotated_file_id && (
          <Badge variant="secondary" className="h-6 gap-1 px-2 text-[11px]">
            <Camera className="size-3" />
            Annotated
          </Badge>
        )}
      </div>
      {annotating && (
        <Suspense
          fallback={
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading editor…
            </div>
          }
        >
          <AnnotationEditor
            item={item}
            onClose={() => setAnnotating(false)}
            onSaved={async () => {
              setAnnotating(false);
              await onChanged();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function GifPreview({ item }: { item: Extract<GuidanceItem, { kind: 'gif' }> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="block">
          <img
            src={item.url}
            alt={item.caption ?? 'guidance GIF'}
            className="max-h-64 w-full rounded border object-contain"
          />
        </a>
      ) : (
        <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
          No URL available — file_id: <span className="font-mono">{item.file_id}</span>
        </div>
      )}
      {item.duration_ms != null && (
        <div className="text-[11px] text-muted-foreground">
          Duration: {(item.duration_ms / 1000).toFixed(1)}s
          {item.frame_count != null && ` · ${item.frame_count} frames`}
        </div>
      )}
    </div>
  );
}

function DemoPreview({ item }: { item: Extract<GuidanceItem, { kind: 'demo_ref' }> }) {
  const [demo, setDemo] = useState<Demo | null>(null);
  // A demo_ref is a POINTER. Its body syncs through extend.wbx_demo, but a
  // machine that just signed in (or is signed out) can hold the ref without
  // the body. Say so plainly rather than offering a Replay button that fails.
  const [bodyMissing, setBodyMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBodyMissing(false);
    setDemo(null);
    void getDemoOrHydrate(item.demo_id).then((d) => {
      if (cancelled) return;
      setDemo(d);
      setBodyMissing(d === null);
    });
    return () => {
      cancelled = true;
    };
  }, [item.demo_id]);

  const handleReplay = useCallback(async () => {
    if (!demo) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await replayDemo({ demo });
      setResult(
        r.ok
          ? `Replay finished — ${r.steps_succeeded}/${r.steps_attempted} steps in ${r.duration_ms}ms.`
          : `Replay failed at step ${r.failed_at_index ?? '?'}: ${(r as { reason?: string }).reason ?? 'unknown'}`,
      );
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }, [demo]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs">
        <div className="font-medium">{item.name}</div>
        {demo?.description && <div className="text-muted-foreground">{demo.description}</div>}
        <div className="mt-1 text-[11px] text-muted-foreground">
          {item.step_count} steps
          {item.parameter_names.length > 0 && <> · params: {item.parameter_names.join(', ')}</>}
        </div>
      </div>
      {bodyMissing ? (
        <div className="rounded border border-amber-600/40 bg-amber-50/40 p-2 text-[11px] dark:bg-amber-900/10">
          The recorded steps for this demo aren't on this machine. Sign in to sync demos across
          machines, or re-record it here. Replay is unavailable until then.
        </div>
      ) : confirming ? (
        <div className="rounded border border-amber-600/40 bg-amber-50/40 p-2 text-[11px] dark:bg-amber-900/10">
          <p className="mb-1.5">
            Replaying will execute every step against the active tab. The demo can click, type, and
            navigate — buttons like <strong>Send</strong> or <strong>Buy</strong> will fire if they
            were part of the recording. Continue?
          </p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1 px-2 text-xs"
              disabled={running}
              onClick={handleReplay}
            >
              {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              Run replay
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setConfirming(false)}
              disabled={running}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="default"
          className="h-7 w-fit gap-1 px-2 text-xs"
          onClick={() => setConfirming(true)}
        >
          <Play className="size-3" />
          Replay…
        </Button>
      )}
      {result && (
        <div className="rounded border border-border/60 bg-muted/30 p-2 text-[11px]">{result}</div>
      )}
    </div>
  );
}
