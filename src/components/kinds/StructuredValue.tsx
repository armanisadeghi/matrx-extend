/**
 * THE FLOOR — render ANY JSON value as something a human reads.
 *
 * This is the `renderValue` seam of `@ai-matrx/content-ir-react`. The package
 * refuses to bundle it because rendering a value WELL means prose through the
 * host's markdown renderer — host property, and in a side panel a
 * panel-calibrated one.
 *
 * 🚨 It is deliberately NOT a JSON tree. A tree is a developer artifact, and
 * our reader is a non-technical Subject Matter Expert; the R6 ruling that
 * created this seam exists because a real Study Pack run showed 19 of 23 steps
 * as raw JSON. Keys become headings, prose renders as prose, lists render as
 * lists, and the raw object stays reachable behind a collapsed escape hatch —
 * never as the first thing anyone sees.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

/** The discriminator is IDENTITY, not a data field — shown as a label, never as a row. */
const KIND_KEY = '__kind';

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ScalarValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    // Long-form strings are the common case for AI output and are markdown far
    // more often than not; short ones cost nothing to route the same way.
    return <Markdown content={value} density="compact" />;
  }
  if (value === null || value === undefined) {
    return <span className="text-[11px] italic text-muted-foreground">none</span>;
  }
  return <span className="text-[12px]">{String(value)}</span>;
}

function ValueBody({ value, depth }: { value: unknown; depth: number }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-[11px] italic text-muted-foreground">empty</span>;
    }
    return (
      <ul className="space-y-1.5">
        {value.map((entry, i) => (
          <li key={i} className={cn(isPlainObject(entry) && 'rounded border border-border px-2 py-1.5')}>
            <ValueBody value={entry} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== KIND_KEY);
    if (entries.length === 0) {
      return <span className="text-[11px] italic text-muted-foreground">empty</span>;
    }
    return (
      <div className="space-y-1.5">
        {entries.map(([key, entry]) => (
          <div key={key}>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {humanize(key)}
            </div>
            <div className="mt-0.5">
              <ValueBody value={entry} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <ScalarValue value={value} />;
}

export interface StructuredValueProps {
  value: unknown;
  /** The kind slug this value claims, when known. An honesty line — never a renderer choice. */
  kind?: string;
  /** Why this shape has no custom view, in human words. */
  note?: string;
  /** Show the "what this is / raw data" footer. Default true. */
  footer?: boolean;
}

export function StructuredValue({ value, kind, note, footer = true }: StructuredValueProps) {
  const [rawOpen, setRawOpen] = useState(false);

  return (
    <div className="space-y-2">
      <ValueBody value={value} depth={0} />

      {footer && (
        <div className="space-y-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          {note && <p>{note}</p>}
          <div className="flex items-center gap-2">
            {kind && <span className="font-mono">{kind}</span>}
            <button
              type="button"
              onClick={() => setRawOpen((open) => !open)}
              className="flex items-center gap-0.5 hover:text-foreground"
            >
              <ChevronRight
                className={cn('h-3 w-3 transition-transform', rawOpen && 'rotate-90')}
              />
              Raw data
            </button>
          </div>
          {rawOpen && (
            <pre className="max-h-64 overflow-auto rounded bg-secondary/40 p-2 font-mono text-[10px] leading-snug">
              {JSON.stringify(value, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
