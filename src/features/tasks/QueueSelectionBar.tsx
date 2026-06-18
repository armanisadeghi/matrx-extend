/**
 * Batch action bar for the Scrape queue — appears when ≥1 row is selected.
 * Shows the count, a select-all-filtered toggle, a bulk Capture, a bulk Resolve
 * dropdown (every verdict, incl. the honest `ignored` / `content_mismatch`), and
 * live progress while a batch runs. Mirrors the Gmail/Linear selection pattern.
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { VERDICT_OPTIONS } from '@/features/tasks/verdicts';
import type { UserVerdict } from '@/lib/api/routes/research';
import { CheckSquare, ChevronDown, Loader2, PlayCircle, Square, X } from 'lucide-react';
import { useState } from 'react';

export interface BatchProgress {
  done: number;
  total: number;
  label: string;
}

export function QueueSelectionBar({
  selectedCount,
  filteredCount,
  allFilteredSelected,
  capturableCount,
  busy,
  progress,
  onToggleSelectAll,
  onClear,
  onCapture,
  onVerdict,
}: {
  selectedCount: number;
  filteredCount: number;
  allFilteredSelected: boolean;
  /** How many of the selected items can actually be captured (not L4 paste). */
  capturableCount: number;
  busy: boolean;
  progress: BatchProgress | null;
  onToggleSelectAll: () => void;
  onClear: () => void;
  onCapture: () => void;
  onVerdict: (verdict: UserVerdict) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="shrink-0 border-primary/30 border-b bg-primary/5 px-3 py-2">
      {progress ? (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span className="font-medium">{progress.label}</span>
          <span className="text-muted-foreground">
            {progress.done} / {progress.total}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleSelectAll}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            title={allFilteredSelected ? 'Deselect all' : `Select all ${filteredCount} filtered`}
          >
            {allFilteredSelected ? (
              <CheckSquare className="size-3.5" />
            ) : (
              <Square className="size-3.5" />
            )}
            {selectedCount} selected
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-xs"
              onClick={onCapture}
              disabled={busy || capturableCount === 0}
              title={
                capturableCount === 0
                  ? 'None of the selected sources can be auto-captured (paste-only / sign-in)'
                  : `Capture ${capturableCount} selected`
              }
            >
              <PlayCircle className="size-3.5" /> Capture
              {capturableCount > 0 && capturableCount !== selectedCount
                ? ` (${capturableCount})`
                : ''}
            </Button>

            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs"
                  disabled={busy}
                  title="Resolve the selected sources"
                >
                  Resolve <ChevronDown className="size-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-1">
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Apply to {selectedCount} selected source{selectedCount === 1 ? '' : 's'}:
                </div>
                {VERDICT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.verdict}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onVerdict(opt.verdict);
                      }}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{opt.label}</div>
                        <div className="text-[11px] text-muted-foreground">{opt.description}</div>
                      </div>
                    </button>
                  );
                })}
              </PopoverContent>
            </Popover>

            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              onClick={onClear}
              disabled={busy}
              title="Clear selection"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
