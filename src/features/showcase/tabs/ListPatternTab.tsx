import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveTab } from '@/hooks/use-active-tab';
import { runMode } from '@/lib/data-pattern/run-pattern';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { Crosshair, Loader2, PlayCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

interface FieldPath {
  name: string;
  rel_selector: string;
  attr?: string;
}

interface ListPickerResult {
  list_root: string;
  item_selector: string;
  field_paths: { name: string; rel_selector: string }[];
}

export function ListPatternTab() {
  const tab = useActiveTab();
  const [picking, setPicking] = useState(false);
  const [config, setConfig] = useState<ListPickerResult | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offResult = on<ListPickerResult, { ack: true }>(
      CHANNELS.LIST_PICKER_RESULT,
      (payload) => {
        setPicking(false);
        if (payload?.list_root && payload.item_selector) {
          setConfig(payload);
          setRows(null);
          setError(null);
        }
        return { ack: true };
      },
    );
    const offExit = on<unknown, { ack: true }>(CHANNELS.LIST_PICKER_EXIT, () => {
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
    setError(null);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/list-picker.js'],
      });
    } catch (err) {
      setPicking(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRun = async () => {
    if (!tab.id || !config) return;
    setRunning(true);
    setError(null);
    try {
      const data = await runMode('list_pattern', tab.id, config);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const updateFieldName = (i: number, name: string) => {
    if (!config) return;
    setConfig({
      ...config,
      field_paths: config.field_paths.map((f, idx) => (idx === i ? { ...f, name } : f)),
    });
  };

  const removeField = (i: number) => {
    if (!config) return;
    setConfig({
      ...config,
      field_paths: config.field_paths.filter((_, idx) => idx !== i),
    });
  };

  const fields: FieldPath[] = config?.field_paths ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            List Pattern
          </div>
          <div className="text-xs text-muted-foreground">
            Click one example item; we'll find every similar sibling automatically. Then click
            each field inside it. Best for repeating-card pages like events, products, listings.
          </div>
        </div>

        {!config ? (
          <Button
            onClick={() => void enterPicker()}
            disabled={picking || !tab.id}
            className="w-full rounded-full"
          >
            {picking ? <Loader2 className="animate-spin" /> : <Crosshair />}
            {picking ? 'Picking on page…' : 'Pick an example item'}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="rounded-xl bg-secondary/40 px-3 py-2 font-mono text-[11px]">
              <div className="text-muted-foreground">
                <span className="opacity-70">root:</span> {config.list_root}
              </div>
              <div className="text-muted-foreground">
                <span className="opacity-70">item:</span> {config.item_selector}
              </div>
            </div>

            {fields.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {fields.length} field{fields.length === 1 ? '' : 's'}
                </div>
                {fields.map((f, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows reorder by user.
                    key={i}
                    className="flex items-center gap-1.5"
                  >
                    <Input
                      value={f.name}
                      onChange={(e) => updateFieldName(i, e.target.value)}
                      placeholder="field_name"
                      className="h-7 w-28 rounded-full bg-secondary/40 text-[11px]"
                    />
                    <code className="flex-1 truncate rounded-full bg-secondary/40 px-3 py-1.5 text-[10px]">
                      {f.rel_selector}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeField(i)}
                      className="size-7 shrink-0"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setConfig(null);
                  setRows(null);
                }}
                className="rounded-full"
              >
                Restart
              </Button>
              <Button
                onClick={() => void enterPicker()}
                disabled={picking}
                variant="secondary"
                className="rounded-full"
              >
                <Crosshair />
                Pick more fields
              </Button>
              <Button
                onClick={() => void handleRun()}
                disabled={running || fields.length === 0}
                className="flex-1 rounded-full"
              >
                {running ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                {running ? 'Extracting…' : 'Extract'}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {rows && <ResultPreview rows={rows} />}

        {rows && rows.length > 0 && config && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="list_pattern"
              config={config}
              rows={rows}
              defaultName={`List on ${(() => {
                try {
                  return tab.url ? new URL(tab.url).host : 'page';
                } catch {
                  return 'page';
                }
              })()}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
