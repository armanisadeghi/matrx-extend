import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

type NodeKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';

/** Children rendered per container node before the "show more" expander. */
const CHILD_PAGE_SIZE = 100;

const kindOf = (v: unknown): NodeKind => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as NodeKind;
};

const previewValue = (v: unknown): string => {
  const k = kindOf(v);
  if (k === 'string') return JSON.stringify(v);
  if (k === 'array') return `[ ${(v as unknown[]).length} ]`;
  if (k === 'object') return `{ ${Object.keys(v as object).length} }`;
  if (k === 'null') return 'null';
  return String(v);
};

interface JsonTreeProps {
  data: unknown;
  /** Called with the dot-path the user clicked (empty string for root). */
  onSelectPath?: (path: string) => void;
  /** Highlight this path with a ring. */
  selectedPath?: string;
  /** Initial expand depth. */
  defaultDepth?: number;
}

export function JsonTree({
  data,
  onSelectPath,
  selectedPath,
  defaultDepth = 1,
}: JsonTreeProps) {
  return (
    <div className="rounded-xl bg-secondary/40 p-2 font-mono text-[11px]">
      <Node
        value={data}
        path=""
        depth={0}
        defaultDepth={defaultDepth}
        onSelectPath={onSelectPath}
        selectedPath={selectedPath}
      />
    </div>
  );
}

function Node({
  value,
  path,
  depth,
  defaultDepth,
  onSelectPath,
  selectedPath,
}: {
  value: unknown;
  path: string;
  depth: number;
  defaultDepth: number;
  onSelectPath?: (path: string) => void;
  selectedPath?: string;
}) {
  const [open, setOpen] = useState(depth < defaultDepth);
  const [childLimit, setChildLimit] = useState(CHILD_PAGE_SIZE);
  const kind = kindOf(value);
  const isContainer = kind === 'object' || kind === 'array';
  const selected = selectedPath !== undefined && selectedPath === path;

  if (!isContainer) {
    return (
      <button
        type="button"
        onClick={() => onSelectPath?.(path)}
        className={cn(
          'flex w-full items-baseline gap-2 rounded px-1 py-px text-left hover:bg-secondary/70',
          selected && 'ring-1 ring-primary/60 bg-primary/10',
        )}
      >
        <span className="text-foreground/50">{path || '(root)'}</span>
        <span
          className={cn(
            kind === 'string' && 'text-emerald-700 dark:text-emerald-400',
            kind === 'number' && 'text-blue-700 dark:text-blue-400',
            kind === 'boolean' && 'text-purple-700 dark:text-purple-400',
            kind === 'null' && 'text-muted-foreground',
          )}
        >
          {previewValue(value)}
        </span>
      </button>
    );
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  // Cap rendered children per node: multi-MB __NEXT_DATA__ dumps can have
  // thousands of siblings, and rendering them all janks the panel. The
  // "show more" expander reveals the rest in chunks.
  const visibleEntries = entries.slice(0, childLimit);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => onSelectPath?.(path)}
          className={cn(
            'flex flex-1 items-baseline gap-2 rounded px-1 py-px text-left hover:bg-secondary/70',
            selected && 'ring-1 ring-primary/60 bg-primary/10',
          )}
        >
          <span className="text-foreground/50">{path || '(root)'}</span>
          <span className="text-muted-foreground">{previewValue(value)}</span>
        </button>
      </div>
      {open && (
        <div className="ml-3 border-l border-border/60 pl-2">
          {visibleEntries.map(([key, child]) => {
            const childPath = path ? `${path}.${key}` : key;
            return (
              <Node
                key={childPath}
                value={child}
                path={childPath}
                depth={depth + 1}
                defaultDepth={defaultDepth}
                onSelectPath={onSelectPath}
                selectedPath={selectedPath}
              />
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setChildLimit((n) => n + CHILD_PAGE_SIZE)}
              className="rounded px-1 py-px text-left text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
            >
              + {Math.min(hiddenCount, CHILD_PAGE_SIZE)} more of {hiddenCount} hidden…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
