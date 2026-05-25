/**
 * Top-level chat / agent markdown renderer.
 *
 * Splits incoming content into markdown / xml / code segments, then dispatches
 * each segment:
 *   - markdown → react-markdown with the typography presets we calibrated for
 *     the side panel (see MarkdownView.tsx — same Components map, deduped here).
 *   - xml      → XmlBlock with optional registry override per tag name.
 *   - code     → CodeBlock with optional registry override per language; for
 *                ```json blocks, a second-level dispatch by first JSON key.
 *
 * Pass a `registry` to plug in custom renderers without touching this file.
 *
 * Streaming: safe to call on every chunk. Open code/XML blocks at the tail of
 * `content` are surfaced with `complete: false` so partial state can render.
 */

import { cn } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { XmlBlock } from './XmlBlock';
import { type Block, parseBlocks } from './block-parser';
import type { MarkdownRegistry } from './registry';

export type { MarkdownRegistry } from './registry';
export type {
  XmlBlockRendererProps,
  CodeBlockRendererProps,
  JsonBlockRendererProps,
} from './registry';

export interface MarkdownProps {
  content: string;
  /** Optional custom renderer registry (xml tags / code langs / json first-keys). */
  registry?: MarkdownRegistry;
  /** Pass-through className applied to the wrapper. */
  className?: string;
  density?: 'comfortable' | 'compact';
}

export function Markdown({ content, registry, className, density = 'comfortable' }: MarkdownProps) {
  // Only tags with a registered renderer are pulled out as xml blocks. Bare
  // angle-bracket tokens in prose/JSON (`<ctx>`, `<T>`, …) stay literal text.
  const knownXmlTags = registry?.xml
    ? new Set(Object.keys(registry.xml).map((k) => k.toLowerCase()))
    : undefined;
  const blocks = parseBlocks(content, knownXmlTags);

  return (
    <div
      className={cn(
        'min-w-0 text-foreground [overflow-wrap:anywhere]',
        density === 'compact' && '[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:mt-2 [&_h2]:mt-2',
        className,
      )}
    >
      {blocks.map((block, i) => (
        <BlockRenderer key={`${i}:${blockKey(block)}`} block={block} registry={registry} />
      ))}
    </div>
  );
}

function blockKey(block: Block): string {
  if (block.kind === 'markdown') return `md:${block.text.length}`;
  if (block.kind === 'xml') return `xml:${block.tag}:${block.inner.length}`;
  return `code:${block.lang}:${block.code.length}`;
}

function BlockRenderer({
  block,
  registry,
}: {
  block: Block;
  registry?: MarkdownRegistry;
}) {
  if (block.kind === 'markdown') {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {block.text}
      </ReactMarkdown>
    );
  }
  if (block.kind === 'xml') {
    return (
      <XmlBlock
        tag={block.tag}
        attrs={block.attrs}
        inner={block.inner}
        complete={block.complete}
        registry={registry}
      />
    );
  }
  return (
    <CodeBlock lang={block.lang} code={block.code} complete={block.complete} registry={registry} />
  );
}

// Typography map — mirrors MarkdownView.tsx but without `pre`/`code` overrides
// (the parser pulls fenced code into its own dispatched block before the
// markdown ever reaches react-markdown).
const MD_COMPONENTS: Components = {
  h1: ({ node: _n, ...props }) => (
    <h1 className="mt-4 mb-2 text-base font-semibold leading-tight first:mt-0" {...props} />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2
      className="mt-4 mb-1.5 text-[15px] font-semibold leading-tight first:mt-0 border-b border-border/50 pb-1"
      {...props}
    />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3 className="mt-3 mb-1 text-sm font-semibold leading-snug first:mt-0" {...props} />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4 className="mt-2.5 mb-1 text-sm font-medium leading-snug first:mt-0" {...props} />
  ),
  h5: ({ node: _n, ...props }) => (
    <h5
      className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0"
      {...props}
    />
  ),
  h6: ({ node: _n, ...props }) => (
    <h6
      className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0"
      {...props}
    />
  ),
  p: ({ node: _n, ...props }) => (
    <p className="my-2 text-sm leading-relaxed first:mt-0 last:mb-0" {...props} />
  ),
  ul: ({ node: _n, ...props }) => (
    <ul
      className="my-2 ml-5 list-disc space-y-0.5 text-sm marker:text-muted-foreground"
      {...props}
    />
  ),
  ol: ({ node: _n, ...props }) => (
    <ol
      className="my-2 ml-5 list-decimal space-y-0.5 text-sm marker:text-muted-foreground"
      {...props}
    />
  ),
  li: ({ node: _n, ...props }) => <li className="leading-relaxed" {...props} />,
  blockquote: ({ node: _n, ...props }) => (
    <blockquote
      className="my-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground"
      {...props}
    />
  ),
  hr: ({ node: _n, ...props }) => <hr className="my-4 border-border/60" {...props} />,
  a: ({ node: _n, ...props }) => (
    <a
      className="break-words font-medium text-sky-600 underline underline-offset-2 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  img: ({ node: _n, alt, ...props }) => (
    // biome-ignore lint/a11y/useAltText: alt is forwarded
    <img className="my-2 max-w-full rounded-lg" alt={alt ?? ''} loading="lazy" {...props} />
  ),
  // Inline code only — fenced code is intercepted by the block parser.
  code: ({ node: _n, className, children, ...props }) => (
    <code
      className={cn(
        'rounded-md bg-secondary px-1 py-0.5 font-mono text-[11px] text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
  table: ({ node: _n, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => <thead className="border-b border-border" {...props} />,
  th: ({ node: _n, ...props }) => <th className="px-2 py-1 text-left font-semibold" {...props} />,
  td: ({ node: _n, ...props }) => (
    <td className="border-b border-border/40 px-2 py-1 align-top" {...props} />
  ),
  strong: ({ node: _n, ...props }) => <strong className="font-semibold" {...props} />,
  em: ({ node: _n, ...props }) => <em className="italic" {...props} />,
};
