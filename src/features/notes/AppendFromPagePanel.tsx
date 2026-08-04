/**
 * Append-from-page — popover with append-only insert actions.
 *
 * Each button reads from the active tab and appends a markdown block to the
 * end of the current note via `appendToContent`. Existing content is never
 * modified. The append is atomic: read latest content from the editor's
 * `getContent()` callback, build the new content, persist via `onAppend`.
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  extractPageLinks,
  extractPageMetadata,
  extractPageText,
  extractSelection,
  extractUrlAndTitle,
} from '@/lib/notes/extract';
import { appendToContent } from '@/lib/notes/utils';
import { ChevronDown, FileText, Info, Link2, Link as LinkIcon, Loader2, Quote } from 'lucide-react';
import { useState } from 'react';

type ExtractKind = 'url' | 'selection' | 'pageText' | 'links' | 'metadata';

interface Props {
  /**
   * Latest committed content. Returned at call time so we don't append on top
   * of stale state (e.g. mid-typing changes that haven't been auto-saved yet).
   */
  getCurrentContent: () => string;
  /** Persist the new content. Caller handles auto-save invalidation. */
  onAppend: (next: string) => Promise<void>;
}

const ACTIONS: Array<{
  kind: ExtractKind;
  label: string;
  description: string;
  icon: typeof FileText;
  run: () => Promise<string | null>;
}> = [
  {
    kind: 'url',
    label: 'URL + title',
    description: 'Quote block with the page link.',
    icon: Link2,
    run: extractUrlAndTitle,
  },
  {
    kind: 'selection',
    label: 'Selected text',
    description: 'Whatever you have highlighted, as a quote.',
    icon: Quote,
    run: extractSelection,
  },
  {
    kind: 'pageText',
    label: 'Page text',
    description: 'Readable article body, attribution included.',
    icon: FileText,
    run: () => extractPageText(),
  },
  {
    kind: 'links',
    label: 'Links on page',
    description: 'Bullet list of unique anchor links (capped at 50).',
    icon: LinkIcon,
    run: extractPageLinks,
  },
  {
    kind: 'metadata',
    label: 'Page metadata',
    description: 'Title, author, description, keywords.',
    icon: Info,
    run: extractPageMetadata,
  },
];

export function AppendFromPagePanel({ getCurrentContent, onAppend }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExtractKind | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const runAction = async (kind: ExtractKind) => {
    setBusy(kind);
    setWarning(null);
    try {
      const action = ACTIONS.find((a) => a.kind === kind);
      if (!action) return;
      const block = await action.run();
      if (!block) {
        setWarning(
          kind === 'selection'
            ? 'Nothing selected on the page.'
            : 'No content captured. Make sure a regular page is active.',
        );
        return;
      }
      const next = appendToContent(getCurrentContent(), block);
      await onAppend(next);
      setOpen(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setWarning(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs">
          Append from page
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const running = busy === a.kind;
          return (
            <button
              key={a.kind}
              type="button"
              onClick={() => void runAction(a.kind)}
              disabled={busy !== null}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              {running ? (
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{a.label}</div>
                <div className="text-[11px] text-muted-foreground">{a.description}</div>
              </div>
            </button>
          );
        })}
        {warning && (
          <div className="mt-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            {warning}
          </div>
        )}
        <div className="mt-1 border-t border-border/50 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          Inserts append to the end of the note. Existing content is never overwritten.
        </div>
      </PopoverContent>
    </Popover>
  );
}
