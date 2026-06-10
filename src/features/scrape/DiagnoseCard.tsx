/**
 * DiagnoseCard — sidepanel surface for the diagnose picker result.
 *
 * Shown above the Scrape-tab content whenever
 * `useScrapeStore.diagnose.lastResult` is non-null. The card surfaces:
 *   - mode chip (Missing / Unwanted)
 *   - selector chain (collapsed by default; expand on click)
 *   - leaf HTML preview
 *   - free-text note
 *   - CopyMenu with the `For AI agent` flavor + a raw `Markdown` flavor
 *
 * Output formatting lives in `diagnose-bundle.ts` (`formatDiagnoseBundle`).
 * Keep this component thin — it's a view, not a brain.
 */

import { CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { formatDiagnoseBundle } from '@/lib/scrape/diagnose-bundle';
import { cn } from '@/lib/utils';
import { useScrapeStore } from '@/state/scrape';
import { ChevronDown, ChevronRight, Crosshair, X } from 'lucide-react';
import { useState } from 'react';

export function DiagnoseCard() {
  const result = useScrapeStore((s) => s.diagnose.lastResult);
  const draftNote = useScrapeStore((s) => s.diagnose.draftNote);
  const setDraftNote = useScrapeStore((s) => s.setDiagnoseDraftNote);
  const clearDiagnose = useScrapeStore((s) => s.clearDiagnose);
  const current = useScrapeStore((s) => s.current);
  const [showSelectors, setShowSelectors] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  if (!result) return null;

  const modeLabel = result.mode === 'missing' ? 'Missing element' : 'Unwanted element';
  const modeTone =
    result.mode === 'missing'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : 'bg-red-500/15 text-red-700 dark:text-red-300';

  const placeholder =
    result.mode === 'missing'
      ? 'Why should this be in the scrape? (e.g. "this date is missing from the article")'
      : 'Why shouldn\'t this be in the scrape? (e.g. "this navigation chrome is showing up as article content")';

  const buildBundle = () =>
    formatDiagnoseBundle({
      result,
      userNote: draftNote,
      scrapeMarkdown: current?.article.content_markdown ?? null,
      extractor: current?.article.extractor ?? null,
      scrapeMode: null,
      capturedAt: result.capturedAt,
    });

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <Crosshair className="size-3.5 shrink-0 text-primary" />
        <span className="text-xs font-medium">Diagnose</span>
        <span
          className={cn(
            'rounded-full px-2 py-px text-[10px] font-medium uppercase tracking-wider',
            modeTone,
          )}
        >
          {modeLabel}
        </span>
        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
          {`<${result.leafTag}>`}
          {result.leafTextPreview && (
            <span className="ml-1 text-muted-foreground/70">— {result.leafTextPreview}</span>
          )}
        </span>
        <button
          type="button"
          onClick={clearDiagnose}
          className="ml-1 size-5 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Dismiss"
        >
          <X className="m-auto size-3" />
        </button>
      </div>

      <textarea
        value={draftNote}
        onChange={(e) => setDraftNote(e.target.value)}
        placeholder={placeholder}
        className="min-h-[60px] w-full resize-y rounded-lg border bg-background p-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div className="flex items-center gap-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setShowSelectors((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {showSelectors ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Selectors ({result.selectorChain.length})
        </button>
        <button
          type="button"
          onClick={() => setShowHtml((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {showHtml ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          HTML
        </button>
        {result.siblingCount > 0 && (
          <span className="rounded-full bg-secondary/60 px-1.5 py-0 text-[10px] text-muted-foreground">
            {result.siblingCount} similar siblings
          </span>
        )}
        <div className="ml-auto">
          <CopyMenu
            title="Copy diagnose bundle"
            label="Copy for AI"
            size="sm"
            options={[
              {
                label: 'For AI agent',
                description: 'Pre-formatted with page + selector + HTML context',
                ai: true,
                getContent: buildBundle,
              },
              {
                label: 'Selectors only',
                description: 'Plain selector chain, one per line',
                getContent: () => result.selectorChain.map((s, i) => `L${i}: ${s}`).join('\n'),
              },
              {
                label: 'Leaf HTML only',
                description: "Just the picked element's outerHTML",
                getContent: () => result.leafHtml,
              },
            ]}
          />
        </div>
      </div>

      {showSelectors && (
        <div className="space-y-0.5 rounded-lg bg-secondary/40 p-2">
          {result.selectorChain.map((s, i) => (
            <div
              key={`${i}-${s}`}
              className="truncate font-mono text-[10px] leading-relaxed text-foreground/80"
              title={s}
            >
              <span className="mr-1.5 text-muted-foreground">L{i}:</span>
              {s}
            </div>
          ))}
        </div>
      )}

      {showHtml && (
        <pre className="max-h-[200px] overflow-auto rounded-lg bg-secondary/40 p-2 text-[10px] leading-relaxed whitespace-pre-wrap">
          {result.leafHtml}
        </pre>
      )}
    </div>
  );
}

export function DiagnoseLauncher({ onLaunch }: { onLaunch: () => void }) {
  const setMode = useScrapeStore((s) => s.setDiagnoseMode);
  const mode = useScrapeStore((s) => s.diagnose.mode);
  const picking = useScrapeStore((s) => s.diagnose.picking);

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
      <button
        type="button"
        onClick={() => setMode('missing')}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          mode === 'missing'
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        title="Pick an element that should be in the scrape but isn't"
      >
        Missing
      </button>
      <button
        type="button"
        onClick={() => setMode('unwanted')}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          mode === 'unwanted'
            ? 'bg-red-500/15 text-red-700 dark:text-red-300'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        title="Pick an element that's in the scrape but shouldn't be"
      >
        Unwanted
      </button>
      <Button
        size="sm"
        variant="secondary"
        disabled={picking}
        onClick={onLaunch}
        className="h-7 gap-1 rounded-md px-2 text-[11px]"
      >
        <Crosshair className="size-3" />
        {picking ? 'Picking…' : 'Pick on page'}
      </Button>
    </div>
  );
}
