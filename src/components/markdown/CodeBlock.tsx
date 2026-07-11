/**
 * Renders a fenced code block. Two responsibilities:
 *
 *  1. If the registry has a matching `code[lang]` renderer, hand the block off
 *     to that custom component.
 *  2. Otherwise, if `lang === 'json'` and the payload starts with an object,
 *     check the JSON registry by first key. Hand off if matched.
 *  3. Otherwise, render Shiki-highlighted code with a header (language label
 *     + copy button).
 *
 * Custom renderers receive parsed data and are expected to handle their own
 * containers / styling — we don't wrap them in our chrome.
 */

import { CopyButton } from '@/components/CopyMenu';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { firstJsonKey } from './block-parser';
import { type MarkdownRegistry, lookupCode, lookupJson } from './registry';
import { highlightToHtml } from './shiki-highlighter';
import { useResolvedTheme } from './use-resolved-theme';

export interface CodeBlockProps {
  lang: string;
  code: string;
  complete: boolean;
  registry?: MarkdownRegistry | undefined;
}

export function CodeBlock({ lang, code, complete, registry }: CodeBlockProps) {
  const customCode = lookupCode(registry, lang);
  if (customCode) {
    const Component = customCode;
    return <Component lang={lang} code={code} complete={complete} />;
  }

  if (lang.toLowerCase() === 'json') {
    const jsonHandoff = tryJsonHandoff(code, complete, registry);
    if (jsonHandoff) return jsonHandoff;
  }

  return <DefaultCodeBlock lang={lang} code={code} />;
}

function tryJsonHandoff(code: string, complete: boolean, registry: MarkdownRegistry | undefined) {
  const key = firstJsonKey(code);
  if (!key) return null;
  const Component = lookupJson(registry, key);
  if (!Component) return null;

  let data: unknown = null;
  try {
    data = JSON.parse(code);
  } catch {
    if (!complete) {
      // Streaming JSON not yet parseable — fall back to default rendering until
      // the closing brace arrives. Avoids a flash of "broken" custom UI.
      return null;
    }
    return null;
  }

  return <Component firstKey={key} data={data} raw={code} complete={complete} />;
}

function DefaultCodeBlock({ lang, code }: { lang: string; code: string }) {
  const theme = useResolvedTheme();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightToHtml(code, lang, theme).then((out) => {
      if (!cancelled) setHtml(out);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang, theme]);

  const label = lang || 'text';

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-border/60 bg-secondary/40">
      <div className="flex items-center justify-between border-b border-border/60 bg-secondary/60 px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono uppercase tracking-wide">{label}</span>
        <CopyButton text={code} title="Copy code" size="xs" />
      </div>
      {html ? (
        <div
          className={cn(
            'overflow-x-auto p-3 text-[12px] leading-snug',
            '[&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0',
          )}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output is sanitized by design.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 text-[12px] leading-snug">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
