import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveTab } from '@/hooks/use-active-tab';
import { findFirstMatch } from '@/lib/data-pattern/matcher';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type ExtractionPattern,
  fetchPatternsForDomain,
  savePattern,
} from '@/lib/supabase/queries';
import { on } from '@/lib/messaging/native';
import { Crosshair, Loader2, Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

export function DataView() {
  const tab = useActiveTab();
  const [patterns, setPatterns] = useState<ExtractionPattern[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickedFields, setPickedFields] = useState<{ name: string; selector: string }[]>([]);
  const [patternName, setPatternName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

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
    const offResult = on<{ fields?: { name: string; selector: string }[] }, { ack: true }>(
      CHANNELS.DATA_PICKER_RESULT,
      (payload) => {
        setPicking(false);
        setPickedFields(payload.fields ?? []);
        return { ack: true };
      },
    );
    const offExit = on<unknown, { ack: true }>(CHANNELS.DATA_PICKER_EXIT, () => {
      setPicking(false);
      return { ack: true };
    });
    return () => {
      offResult();
      offExit();
    };
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
    setSaving(true);
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
    setSaving(false);
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
  const hasFields = pickedFields.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Structured data</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">{host || 'no host'}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 px-3 pb-3">
          {matched && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5">
              <div className="min-w-0 text-xs">
                <div className="truncate font-medium text-emerald-700 dark:text-emerald-300">
                  {matched.name}
                </div>
                <div className="text-emerald-700/70 dark:text-emerald-300/70">
                  Matches this URL
                </div>
              </div>
              <Button
                size="sm"
                className="h-7 shrink-0 rounded-full px-3 text-xs"
                onClick={() => void runPattern(matched)}
                disabled={running}
              >
                {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Extract
              </Button>
            </div>
          )}

          {hasFields && (
            <Section label={`${pickedFields.length} field${pickedFields.length === 1 ? '' : 's'} selected`}>
              <div className="space-y-1">
                {pickedFields.map((f, i) => (
                  <div
                    key={`${f.selector}-${i}`}
                    className="truncate rounded-lg bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="text-muted-foreground">{f.name}:</span> {f.selector}
                  </div>
                ))}
              </div>
              <Input
                value={patternName}
                onChange={(e) => setPatternName(e.target.value)}
                placeholder="Pattern name…"
                className="rounded-full border-0 bg-secondary/40 focus-visible:ring-1"
              />
            </Section>
          )}

          {patterns && patterns.length > 0 && (
            <Section label={`Saved for ${host}`}>
              <div className="space-y-1">
                {patterns.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2"
                  >
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.fields.length} field{p.fields.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      onClick={() => void runPattern(p)}
                    >
                      <Play className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {rows && (
            <Section label={`Extracted rows (${rows.length})`}>
              <pre className="max-h-[320px] overflow-auto whitespace-pre rounded-xl bg-secondary/40 p-3 text-[11px]">
                {JSON.stringify(rows, null, 2)}
              </pre>
            </Section>
          )}

          {!matched && !hasFields && !patterns?.length && (
            <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
              Pick fields on this page to build a saveable extraction pattern.
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-3 pb-3 pt-1">
        {hasFields ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setPickedFields([])}
              className="rounded-full"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSavePattern()}
              disabled={saving}
              className="flex-1 rounded-full"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save pattern
            </Button>
          </>
        ) : (
          <Button
            onClick={() => void enterPicker()}
            disabled={picking || !tab.id}
            className="w-full rounded-full"
          >
            {picking ? <Loader2 className="animate-spin" /> : <Crosshair />}
            {picking ? 'Picking on page…' : 'Pick fields on this page'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
