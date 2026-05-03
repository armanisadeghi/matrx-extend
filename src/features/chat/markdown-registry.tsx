/**
 * Custom renderers for the chat surface — plugged into <Markdown registry={...}>.
 *
 * Add new entries here:
 *   - xml:  custom <tag> components from the agent (e.g. <thinking>, <plan>).
 *   - code: custom fence languages (e.g. ```mermaid, ```dot).
 *   - json: routed by the FIRST key of a ```json payload, e.g. a payload that
 *           starts with {"chart_data": …} renders the chart component.
 *
 * Keep entries small and focused. The renderer dispatches by exact key (case
 * insensitive). Anything not registered falls back to the default rendering.
 */

import type { MarkdownRegistry, XmlBlockRendererProps } from '@/components/markdown';
import { MarkdownView } from '@/components/MarkdownView';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ShimmerText } from './BreathingOrb';

/**
 * Renders <thinking> / <reasoning> tags. Default is a single-line "Reasoning…"
 * with a left-to-right shimmer while the model is still streaming the inner
 * content. Click to expand and read the raw thoughts.
 */
function ReasoningBlock({ tag, inner, complete }: XmlBlockRendererProps) {
  const [open, setOpen] = useState(false);
  const label = tag.toLowerCase() === 'reasoning' ? 'Reasoning' : 'Thinking';
  const text = inner.trim();
  const hasContent = text.length > 0;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasContent}
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-xs hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          } ${hasContent ? 'opacity-100' : 'opacity-0'}`}
        />
        {complete ? (
          <span className="font-medium text-muted-foreground">{label}</span>
        ) : (
          <ShimmerText className="font-medium">{label}…</ShimmerText>
        )}
      </button>
      {open && hasContent && (
        <div className="mt-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground">
          <MarkdownView content={text} density="compact" />
        </div>
      )}
    </div>
  );
}

export const chatMarkdownRegistry: MarkdownRegistry = {
  xml: {
    thinking: ReasoningBlock,
    reasoning: ReasoningBlock,
    reflection: ReasoningBlock,
  },
  code: {},
  json: {},
};
