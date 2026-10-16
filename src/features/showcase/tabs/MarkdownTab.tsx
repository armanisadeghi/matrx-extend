import { CopyButton } from '@/components/CopyMenu';
import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import { runMode } from '@/lib/data-pattern/run-pattern';
import { Button } from '@ai-matrx/design-system';
import { formatCount } from '@ai-matrx/kit/format';
import { FileText, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

interface MarkdownResult {
  source_url: string;
  chars: number;
  markdown: string;
}

/**
 * Markdown capture: when a page advertises (or a sibling URL serves) a clean,
 * LLM-ready Markdown rendering, fetch it and show it — no selectors, no table
 * fiddling. The fetch runs extension-side (host permissions bypass CORS).
 */
export function MarkdownTab() {
  const tab = useActiveTab();
  const pageKey = tab.pageKey ?? '';
  const seqRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MarkdownResult | null>(null);
  const [resultPageKey, setResultPageKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMarkdown = async () => {
    if (!tab.id || !tab.documentId || !tab.pageKey) return;
    const seq = ++seqRef.current;
    const pageAtRun = pageKey;
    setRunning(true);
    setError(null);
    setResult(null);
    setResultPageKey(null);
    try {
      const rows = (await runMode('markdown', tab.id, {}, tab.documentId)) as unknown as
        | MarkdownResult[]
        | undefined;
      if (seq !== seqRef.current || !isCurrentPageIdentity(pageAtRun)) return;
      const first = rows?.[0];
      if (!first || !first.markdown) {
        setError('No Markdown version found for this page.');
        return;
      }
      setResult(first);
      setResultPageKey(pageAtRun);
    } catch (err) {
      if (seq === seqRef.current && isCurrentPageIdentity(pageAtRun))
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === seqRef.current && isCurrentPageIdentity(pageAtRun)) setRunning(false);
    }
  };

  const show = result && resultPageKey === pageKey;

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Markdown
          </div>
          <div className="text-xs text-muted-foreground">
            Fetch this page's clean, LLM-ready Markdown when the site offers one — a declared
            <code className="mx-1 rounded bg-secondary/60 px-1">text/markdown</code> link, a sibling
            <code className="mx-1 rounded bg-secondary/60 px-1">.md</code>, or
            <code className="mx-1 rounded bg-secondary/60 px-1">llms.txt</code>.
          </div>
        </div>

        <Button
          onClick={() => void fetchMarkdown()}
          disabled={running || !tab.pageKey}
          className="w-full rounded-full"
        >
          {running ? <Loader2 className="animate-spin" /> : <FileText />}
          {running ? 'Fetching…' : 'Fetch Markdown'}
        </Button>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {show && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-[11px] text-muted-foreground">
                <span className="font-medium">{formatCount(result.chars)}</span> chars ·{' '}
                <span className="break-all">{result.source_url}</span>
              </div>
              <CopyButton text={() => result.markdown} size="xs" title="Copy Markdown" />
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed">
              {result.markdown.slice(0, 20000)}
              {result.markdown.length > 20000 &&
                '\n…(truncated for preview — Copy gets the full doc)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
