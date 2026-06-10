import { Button } from '@/components/ui/button';
import { JsonTree } from '@/components/ui/json-tree';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useExtraction } from '@/hooks/use-extraction';
import { Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

type ParsedSource = { source: string; data: unknown };

export function FrameworkTab({ active = true }: { active?: boolean }) {
  const tab = useActiveTab();
  const { detection, rows, running, error, source, run } = useExtraction('next_data', {
    autoDetect: active,
  });
  const [sources, setSources] = useState<ParsedSource[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [keyPath, setKeyPath] = useState('');
  const [loadingTree, setLoadingTree] = useState(false);

  // The dumped framework state belongs to one page. If the new page has no
  // framework data, the dump effect below won't fire — clear explicitly so
  // page A's tree never renders under page B.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab.id/tab.url are the invalidation keys.
  useEffect(() => {
    setSources([]);
    setActiveSource(null);
    setKeyPath('');
  }, [tab.id, tab.url]);

  const dump = useCallback(async () => {
    if (!tab.id) return;
    setLoadingTree(true);
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const out: { source: string; data: unknown }[] = [];
          const tryParse = (id: string, node: Element | null) => {
            if (!node?.textContent) return;
            try {
              out.push({ source: id, data: JSON.parse(node.textContent) });
            } catch {
              // skip
            }
          };
          tryParse('__NEXT_DATA__', document.getElementById('__NEXT_DATA__'));
          tryParse('__NUXT_DATA__', document.getElementById('__NUXT_DATA__'));
          tryParse('apollo', document.getElementById('__APOLLO_STATE__'));

          // LinkedIn bpr-guid hydration blocks
          const bprBlocks = Array.from(
            document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]'),
          );
          if (bprBlocks.length > 0) {
            const aggregated: Record<string, unknown> = {};
            let included: unknown[] = [];
            for (const b of bprBlocks) {
              try {
                const p = JSON.parse(b.textContent ?? '') as Record<string, unknown>;
                aggregated[b.id] = p;
                if (Array.isArray(p.included)) included = included.concat(p.included);
              } catch {
                // skip
              }
            }
            if (Object.keys(aggregated).length > 0) {
              out.push({ source: 'bpr-guid', data: { blocks: aggregated, included } });
            }
          }

          // Inline window.* state (Indeed _initialData, Redux preloaded, etc.).
          // Paren-balanced scan + JSON.parse with safe-eval fallback for sites
          // that ship JS object literals (unquoted keys).
          const WINDOW_NAMES = [
            '_initialData',
            '__INITIAL_STATE__',
            '__INITIAL_DATA__',
            '__PRELOADED_STATE__',
            '__APP_STATE__',
            '__REDUX_STATE__',
            '__APOLLO_STATE__',
            '__SERVER_STATE__',
          ];
          const inlineScripts = Array.from(
            document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
          );
          const extractWindow = (name: string): unknown | undefined => {
            const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const lhsRe = new RegExp(
              `(?:window\\.|self\\.|var\\s+|let\\s+|const\\s+)?${escName}\\s*=\\s*`,
              'g',
            );
            for (const s of inlineScripts) {
              const txt = s.textContent ?? '';
              if (!txt.includes(name)) continue;
              lhsRe.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = lhsRe.exec(txt))) {
                const start = m.index + m[0].length;
                const opener = txt[start];
                if (opener !== '{' && opener !== '[') continue;
                let i = start;
                let depth = 0;
                let inStr: string | null = null;
                while (i < txt.length) {
                  const ch = txt[i];
                  if (inStr) {
                    if (ch === '\\') {
                      i += 2;
                      continue;
                    }
                    if (ch === inStr) inStr = null;
                    i++;
                    continue;
                  }
                  if (ch === '"' || ch === "'" || ch === '`') {
                    inStr = ch;
                    i++;
                    continue;
                  }
                  if (ch === '{' || ch === '[') depth++;
                  else if (ch === '}' || ch === ']') {
                    depth--;
                    if (depth === 0) {
                      i++;
                      break;
                    }
                  }
                  i++;
                }
                if (depth !== 0) continue;
                const blob = txt.slice(start, i);
                try {
                  return JSON.parse(blob);
                } catch {
                  // fall through
                }
                if (
                  /\b(?:function\s*[(*]|=>|eval\s*\(|new\s+Function|XMLHttpRequest|fetch\s*\()/.test(
                    blob,
                  )
                ) {
                  continue;
                }
                if (blob.length > 5_000_000) continue;
                try {
                  return new Function(`"use strict";return (${blob});`)();
                } catch {
                  // try next match
                }
              }
            }
            return undefined;
          };
          for (const name of WINDOW_NAMES) {
            if (name === '__APOLLO_STATE__' && out.some((o) => o.source === 'apollo')) continue;
            const data = extractWindow(name);
            if (data !== undefined) out.push({ source: `window.${name}`, data });
          }

          return out;
        },
      });
      const fetched = (result?.[0]?.result ?? []) as ParsedSource[];
      setSources(fetched);
      const first = fetched[0];
      if (first && !activeSource) setActiveSource(first.source);
    } finally {
      setLoadingTree(false);
    }
  }, [tab.id, activeSource]);

  useEffect(() => {
    if (detection?.available) void dump();
  }, [detection?.available, dump]);

  const activeData = sources.find((s) => s.source === activeSource)?.data;

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

        {sources.length > 1 && (
          <div className="flex gap-1">
            {sources.map((s) => (
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
                {keyPath || '(root)'}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void dump()}
                disabled={loadingTree}
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
          disabled={running || !detection?.available}
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

        {rows && <ResultPreview rows={rows} />}

        {rows && rows.length > 0 && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="next_data"
              config={{ key_path: keyPath, source: activeSource ?? undefined }}
              rows={rows}
              source={source}
              defaultName={`Framework: ${keyPath || '(root)'}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
