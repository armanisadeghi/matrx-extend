import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useActiveTab } from '@/hooks/use-active-tab';
import { findFirstMatch } from '@/lib/data-pattern/matcher';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type ExtractionPattern,
  fetchPatternsForDomain,
  savePattern,
} from '@/lib/supabase/queries';
import { Crosshair, Database, Loader2, Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { onMessage } from 'webext-bridge/window';

export function DataView() {
  const tab = useActiveTab();
  const [patterns, setPatterns] = useState<ExtractionPattern[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickedFields, setPickedFields] = useState<{ name: string; selector: string }[]>([]);
  const [patternName, setPatternName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);

  const host = (() => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    void (async () => {
      const p = await fetchPatternsForDomain(host);
      if (!cancelled) setPatterns(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [host]);

  useEffect(() => {
    onMessage(CHANNELS.DATA_PICKER_RESULT, ({ data }) => {
      const payload = data as { fields?: { name: string; selector: string }[] };
      setPicking(false);
      setPickedFields(payload.fields ?? []);
      return { ack: true };
    });
    onMessage(CHANNELS.DATA_PICKER_EXIT, () => {
      setPicking(false);
      return { ack: true };
    });
  }, []);

  const enterPicker = async () => {
    if (!tab.id) return;
    setPicking(true);
    setPickedFields([]);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/data-picker.js'],
      });
    } catch (err) {
      setPicking(false);
      console.warn('[matrx-extend] picker injection failed', err);
    }
  };

  const handleSavePattern = async () => {
    if (!host || pickedFields.length === 0) return;
    const r = await savePattern({
      name: patternName || `${host} pattern`,
      domain: host,
      route_pattern: tab.url ? new URL(tab.url).pathname : null,
      list_root_selector: null,
      fields: pickedFields.map((f) => ({
        name: f.name,
        selector: f.selector,
        is_list: false,
      })),
    });
    if (r) {
      setPatternName('');
      setPickedFields([]);
      const refreshed = await fetchPatternsForDomain(host);
      setPatterns(refreshed);
    }
  };

  const runPattern = async (pattern: ExtractionPattern) => {
    if (!tab.id) return;
    setRunning(true);
    try {
      const fieldsArg = pattern.fields.map((f) => ({ name: f.name, selector: f.selector }));
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (fields: { name: string; selector: string }[], listRoot: string | null) => {
          const root: (Element | Document)[] = listRoot
            ? Array.from(document.querySelectorAll(listRoot))
            : [document];
          return root.map((scope) => {
            const out: Record<string, string | null> = {};
            for (const f of fields) {
              const el = (scope as Element | Document).querySelector(f.selector);
              out[f.name] = el
                ? ((el as HTMLElement).innerText ?? el.textContent ?? '').trim()
                : null;
            }
            return out;
          });
        },
        args: [fieldsArg, pattern.list_root_selector],
      });
      const data = (result?.[0]?.result ?? []) as Record<string, unknown>[];
      setRows(data);
    } catch (err) {
      console.warn('[matrx-extend] pattern run failed', err);
    } finally {
      setRunning(false);
    }
  };

  const matched = patterns ? findFirstMatch(tab.url ?? '', patterns) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Structured data</span>
          <Badge variant="secondary" className="ml-auto">
            {host || 'no host'}
          </Badge>
        </div>
        {matched && (
          <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
            <div className="text-xs">
              <div className="font-medium text-emerald-700 dark:text-emerald-300">
                {matched.name}
              </div>
              <div className="text-emerald-700/70 dark:text-emerald-300/70">
                Saved pattern matches this URL
              </div>
            </div>
            <Button size="sm" onClick={() => void runPattern(matched)} disabled={running}>
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              Extract
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Crosshair className="size-4" /> Build new pattern
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                onClick={() => void enterPicker()}
                disabled={picking || !tab.id}
                className="w-full"
              >
                {picking ? <Loader2 className="animate-spin" /> : <Crosshair />}
                {picking ? 'Picking on page…' : 'Pick fields on this page'}
              </Button>
              {pickedFields.length > 0 && (
                <>
                  <div className="text-xs text-muted-foreground">
                    {pickedFields.length} field(s) selected
                  </div>
                  <div className="space-y-1">
                    {pickedFields.map((f, i) => (
                      <div
                        key={`${f.selector}-${i}`}
                        className="rounded border bg-muted/30 px-2 py-1 text-[11px] font-mono truncate"
                      >
                        <span className="text-muted-foreground">{f.name}:</span> {f.selector}
                      </div>
                    ))}
                  </div>
                  <Input
                    value={patternName}
                    onChange={(e) => setPatternName(e.target.value)}
                    placeholder="Pattern name…"
                  />
                  <Button
                    onClick={() => void handleSavePattern()}
                    className="w-full"
                    variant="secondary"
                  >
                    <Save /> Save pattern
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {patterns && patterns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Saved patterns for {host}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {patterns.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded border p-2">
                    <div className="text-xs">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-muted-foreground">{p.fields.length} fields</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void runPattern(p)}>
                      <Play />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {rows && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Extracted rows ({rows.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-[11px] overflow-x-auto whitespace-pre">
                  {JSON.stringify(rows, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
