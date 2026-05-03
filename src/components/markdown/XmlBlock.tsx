/**
 * Dispatches XML-style blocks (`<thinking>…</thinking>`, `<artifact id="…">…`,
 * etc.) to a registered renderer. When no match is registered we render a
 * collapsible default that shows the tag name + raw inner content — useful for
 * debugging unfamiliar tags an agent emitted.
 */

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { type MarkdownRegistry, lookupXml } from './registry';

export interface XmlBlockProps {
  tag: string;
  attrs: Record<string, string>;
  inner: string;
  complete: boolean;
  registry?: MarkdownRegistry;
}

export function XmlBlock({ tag, attrs, inner, complete, registry }: XmlBlockProps) {
  const Component = lookupXml(registry, tag);
  if (Component) {
    return <Component tag={tag} attrs={attrs} inner={inner} complete={complete} />;
  }
  return <DefaultXmlBlock tag={tag} attrs={attrs} inner={inner} complete={complete} />;
}

function DefaultXmlBlock({
  tag,
  attrs,
  inner,
  complete,
}: {
  tag: string;
  attrs: Record<string, string>;
  inner: string;
  complete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const attrSummary = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-dashed border-border/70 bg-secondary/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:bg-secondary/60"
      >
        <ChevronRight className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="font-mono">
          &lt;{tag}
          {attrSummary ? ` ${attrSummary}` : ''}&gt;
        </span>
        {!complete && <span className="ml-auto text-[10px] uppercase">streaming…</span>}
      </button>
      {open && (
        <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border/60 bg-secondary/40 px-3 py-2 font-mono text-[11px] leading-snug text-foreground">
          {inner}
        </pre>
      )}
    </div>
  );
}
