import { JsonTree } from '@/components/ui/json-tree';
import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import { useExtraction } from '@/hooks/use-extraction';
import { type FrameworkSource, readFrameworkSources } from '@/lib/data-pattern/framework-sources';
import { formatJsonKeyPath } from '@/lib/data-pattern/json-key-path';
import { Button } from '@ai-matrx/design-system';
import { Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

export function FrameworkTab({ active = true }: { active?: boolean }) {
  const tab = useActiveTab();
  const { detection, rows, running, error, source, previewConfig, run } = useExtraction(
    'next_data',
    {
      autoDetect: active,
    },
  );
  const [sources, setSources] = useState<FrameworkSource[]>([]);
  const [sourcesPageKey, setSourcesPageKey] = useState<string | null>(null);
  const dumpSeq = useRef(0);
  const pageKey = tab.pageKey ?? '';
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [keyPath, setKeyPath] = useState<string[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [dumpError, setDumpError] = useState<string | null>(null);

  // The dumped framework state belongs to one page. If the new page has no
  // framework data, the dump effect below won't fire — clear explicitly so
  // page A's tree never renders under page B.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab.id/tab.url are the invalidation keys.
  useEffect(() => {
    dumpSeq.current += 1;
    setSources([]);
    setSourcesPageKey(null);
    setActiveSource(null);
    setKeyPath([]);
    setLoadingTree(false);
    setDumpError(null);
  }, [pageKey]);

  const dump = useCallback(async () => {
    if (!tab.id || !tab.documentId || !tab.pageKey) return;
    const seq = ++dumpSeq.current;
    const pageKeyAtDump = pageKey;
    setLoadingTree(true);
    setDumpError(null);
    try {
      const fetched = await readFrameworkSources(tab.id, tab.documentId);
      if (seq !== dumpSeq.current || !isCurrentPageIdentity(pageKeyAtDump)) return;
      setSources(fetched);
      setSourcesPageKey(pageKeyAtDump);
      const first = fetched.find((candidate) => !candidate.error) ?? fetched[0];
      if (first && !activeSource) setActiveSource(first.source);
    } catch (err) {
      // Previously try/finally with NO catch — restricted pages stopped the
      // spinner with zero feedback (audit P1-5).
      if (seq === dumpSeq.current && isCurrentPageIdentity(pageKeyAtDump)) setDumpError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === dumpSeq.current && isCurrentPageIdentity(pageKeyAtDump)) setLoadingTree(false);
    }
  }, [tab.id, tab.documentId, pageKey, activeSource]);

  useEffect(() => {
    if (detection?.available) void dump();
  }, [detection?.available, dump]);

  const visibleSources = sourcesPageKey === pageKey ? sources : [];
  const selectedSource = visibleSources.find((s) => s.source === activeSource);
  const activeData = selectedSource?.data;
  const previewKeyPath = (previewConfig as { key_path?: unknown } | null)?.key_path;

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Framework
          </div>
          <div className="text-xs text-muted-foreground">
            Reads embedded JSON from Next.js, Nuxt, or Apollo. Click a node in the tree to pick a
            key path, then extract. Often beats CSS selectors on hostile UIs.
          </div>
        </div>

        <div className="rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          {detection ? detection.summary : 'Detecting…'}
        </div>

        {dumpError && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Could not read framework data: {dumpError}
          </div>
        )}

        {selectedSource?.error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {selectedSource.error}
          </div>
        )}

        {visibleSources.length > 1 && (
          <div className="flex gap-1">
            {visibleSources.map((s) => (
              <button
                key={s.source}
                type="button"
                onClick={() => setActiveSource(s.source)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  activeSource === s.source
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70'
                }`}
              >
                {s.source}
              </button>
            ))}
          </div>
        )}

        {detection?.available && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <code className="flex-1 truncate rounded-full bg-secondary/40 px-3 py-1.5 text-[11px]">
                {formatJsonKeyPath(keyPath) || '(root)'}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void dump()}
                disabled={loadingTree || !tab.pageKey}
                title="Reload tree"
                className="size-7 shrink-0"
              >
                {loadingTree ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </div>
            {activeData !== undefined && (
              <JsonTree
                data={activeData}
                onSelectPath={setKeyPath}
                selectedPath={keyPath}
                defaultDepth={2}
              />
            )}
          </div>
        )}

        <Button
          onClick={() => void run({ key_path: keyPath, source: activeSource ?? undefined })}
          disabled={running || !detection?.available || !tab.pageKey}
          className="w-full rounded-full"
        >
          {running ? <Loader2 className="animate-spin" /> : <PlayCircle />}
          {running ? 'Extracting…' : 'Extract from key path'}
        </Button>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {rows && <ResultPreview rows={rows} source={source} />}

        {rows && rows.length > 0 && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="next_data"
              config={previewConfig}
              rows={rows}
              source={source}
              defaultName={`Framework: ${Array.isArray(previewKeyPath) ? formatJsonKeyPath(previewKeyPath) || '(root)' : typeof previewKeyPath === 'string' && previewKeyPath ? previewKeyPath : '(root)'}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
