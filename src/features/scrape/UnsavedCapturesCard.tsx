import { canonicalUrl } from '@/lib/sources/canonical';
import {
  type UnsavedCapture,
  discardUnsavedCapture,
  listUnsavedCaptures,
  onUnsavedCapturesChange,
  retryUnsavedCapture,
} from '@/lib/sources/save-capture';
import { Button, ConfirmDialog } from '@ai-matrx/design-system';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * "Not yet a Source" (retry): every capture whose save did not land, kept on this
 * device until it does (SOURCE-CONVERGENCE §4.2, never lose input). Rendered
 * at the top of Scrape so an unsaved page is impossible to miss, whichever
 * page the person is on now.
 */
export function UnsavedCapturesCard({
  onLanded,
  onUrlsChange,
  currentPage,
}: {
  /** Called with the capture's URL, Source id, and organization when a retry lands. */
  onLanded?: (url: string, processedDocumentId: string, organizationId: string) => void;
  /** The URLs this card currently owns — while a URL is here, the card is its only save action. */
  onUrlsChange?: (urls: string[]) => void;
  /**
   * The page open in the panel. Retry for THAT page saves the panel's current
   * capture — edits made after the failed save included — which replaces the
   * queued content on the way (never lose input). Other pages retry what was queued.
   */
  currentPage?: { url: string; save: () => Promise<void> } | null;
}) {
  const [rows, setRows] = useState<UnsavedCapture[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<UnsavedCapture | null>(null);

  useEffect(() => {
    onUrlsChange?.(rows.map((r) => r.url));
  }, [rows, onUrlsChange]);

  useEffect(() => {
    let alive = true;
    void listUnsavedCaptures()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => undefined);
    const off = onUnsavedCapturesChange((r) => setRows(r));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const retry = useCallback(
    async (row: UnsavedCapture) => {
      setBusy(row.id);
      setRetryError(null);
      try {
        if (currentPage && canonicalUrl(currentPage.url) === canonicalUrl(row.url)) {
          await currentPage.save();
        } else {
          const outcome = await retryUnsavedCapture(row.id);
          if (outcome.status === 'landed')
            onLanded?.(row.url, outcome.landed.processed_document_id, outcome.organizationId);
        }
        setRows(await listUnsavedCaptures());
      } catch {
        setRetryError('Could not retry this capture. It remains on this device; try again.');
      } finally {
        setBusy(null);
      }
    },
    [onLanded, currentPage],
  );

  if (rows.length === 0) return null;

  return (
    <div
      role="alert"
      aria-label="Captures not yet saved as Sources"
      className="mt-2 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
        <AlertTriangle className="size-3.5 shrink-0" />
        Not yet a Source — kept on this device until the save lands ({rows.length})
      </div>
      {retryError && <p className="text-red-700 dark:text-red-300">{retryError}</p>}
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg bg-background/60 px-2 py-1.5">
          <div className="truncate font-medium">{row.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{row.url}</div>
          <p className="mt-1 text-[11px] text-amber-900 dark:text-amber-100">
            {row.lastRefusal.message}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <Button
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs"
              disabled={busy !== null}
              onClick={() => void retry(row)}
            >
              {busy === row.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Retry save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
              disabled={busy !== null}
              onClick={() => setDiscardTarget(row)}
            >
              Discard
            </Button>
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={discardTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
        title="Discard this capture?"
        description="It never became a Source, so discarding it removes it for good. The web page itself is not affected."
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => {
          const target = discardTarget;
          setDiscardTarget(null);
          if (target) void discardUnsavedCapture(target.id).then(listUnsavedCaptures).then(setRows);
        }}
      />
    </div>
  );
}
