/**
 * Reusable markdown renderer with typography calibrated for the side panel.
 *
 * Why we don't use `prose` (Tailwind Typography):
 *   The plugin isn't installed and we don't want to ship its full type-scale,
 *   which is calibrated for blog posts in a wide column. A 360px side panel
 *   needs tighter sizing. So we override every element on `react-markdown`
 *   with explicit Tailwind classes — predictable, dependency-free, themeable.
 *
 * Use this anywhere markdown is displayed: scrape Article tab, future SEO
 * markdown views, agent replies (gradual migration), saved capture viewer, etc.
 */

import { cn } from '@/lib/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownViewProps {
  content: string;
  /**
   * 'comfortable' (default): dense for the side panel.
   * 'compact': tighter, for inline previews.
   */
  density?: 'comfortable' | 'compact';
  className?: string;
}

const COMPONENTS: Components = {
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
    <ul className="my-2 ml-5 list-disc space-y-0.5 text-sm marker:text-muted-foreground" {...props} />
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
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img className="my-2 max-w-full rounded-lg" alt={alt ?? ''} loading="lazy" {...props} />
  ),
  code: ({ node: _n, className, children, ...props }) => {
    const isBlock = /language-/.test(className ?? '');
    if (isBlock) {
      return (
        <code className={cn('font-mono text-[12px]', className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded-md bg-secondary px-1 py-0.5 font-mono text-[11px] text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node: _n, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-xl bg-secondary/60 p-3 text-[12px] leading-snug"
      {...props}
    />
  ),
  table: ({ node: _n, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => <thead className="border-b border-border" {...props} />,
  th: ({ node: _n, ...props }) => (
    <th className="px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: ({ node: _n, ...props }) => (
    <td className="border-b border-border/40 px-2 py-1 align-top" {...props} />
  ),
  strong: ({ node: _n, ...props }) => <strong className="font-semibold" {...props} />,
  em: ({ node: _n, ...props }) => <em className="italic" {...props} />,
};

export function MarkdownView({ content, density = 'comfortable', className }: MarkdownViewProps) {
  return (
    <div
      className={cn(
        'text-foreground',
        density === 'compact' && '[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:mt-2 [&_h2]:mt-2',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
