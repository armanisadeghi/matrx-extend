import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useUserTables } from '@/hooks/use-user-tables';
import {
  type ExtractionPatternField,
  type PatternKind,
  savePattern,
} from '@/lib/supabase/queries';
import { type UserTableDataType, inferSchemaFromRow } from '@/lib/supabase/user-tables';
import { CheckCircle2, Loader2, Save } from 'lucide-react';
import { useMemo, useState } from 'react';

const NEW_TABLE = '__new__';
const NO_TABLE = '__none__';

interface SaveAsPatternProps {
  defaultName?: string;
  kind: PatternKind;
  config: unknown;
  /** Only used when kind === 'manual_css'. */
  fields?: ExtractionPatternField[];
  /** Only used when kind === 'manual_css'. */
  list_root_selector?: string | null;
  /** Preview rows that get appended to the target user_table on save. */
  rows: Record<string, unknown>[];
  disabled?: boolean;
  onSaved?: () => void;
}

export function SaveAsPattern({
  defaultName = '',
  kind,
  config,
  fields,
  list_root_selector,
  rows,
  disabled,
  onSaved,
}: SaveAsPatternProps) {
  const tab = useActiveTab();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [target, setTarget] = useState<string>(NO_TABLE);
  const [newTableName, setNewTableName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { tables, createTable, appendRows } = useUserTables();

  const inferredFields = useMemo(() => {
    const first = rows[0];
    if (!first) return [];
    return inferSchemaFromRow(first);
  }, [rows]);

  const host = useMemo(() => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return '';
    }
  }, [tab.url]);

  const handleSave = async () => {
    if (!host) return;
    setSaving(true);
    setErr(null);
    setSavedSummary(null);

    try {
      let targetTableId: string | null = null;

      if (target === NEW_TABLE) {
        const created = await createTable({
          name: newTableName || name || `${host} extraction`,
          description: `Auto-created from matrx-extend ${kind} pattern.`,
          fields: inferredFields as {
            field_name: string;
            data_type: UserTableDataType;
            field_order: number;
          }[],
        });
        if (!created) {
          setErr('Failed to create user table.');
          setSaving(false);
          return;
        }
        targetTableId = created.id;
      } else if (target !== NO_TABLE) {
        targetTableId = target;
      }

      const saved = await savePattern({
        name: name || `${host} ${kind}`,
        domain: host,
        route_pattern: tab.url ? new URL(tab.url).pathname : null,
        list_root_selector: list_root_selector ?? null,
        fields: fields ?? [],
        kind,
        config,
        target_user_table_id: targetTableId,
      });

      if (!saved) {
        setErr('Failed to save pattern.');
        setSaving(false);
        return;
      }

      let appendedCount = 0;
      if (targetTableId && rows.length > 0) {
        const result = await appendRows(targetTableId, rows);
        appendedCount = result?.inserted ?? 0;
      }

      setSavedSummary(
        targetTableId
          ? `Pattern saved · ${appendedCount} row${appendedCount === 1 ? '' : 's'} appended`
          : 'Pattern saved',
      );
      onSaved?.();
      setTimeout(() => setOpen(false), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const canSave = host && !saving && (rows.length > 0 || kind === 'manual_css');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          disabled={disabled || !host}
          className="rounded-full"
          title={host ? 'Save as pattern' : 'No active page'}
        >
          <Save className="size-3.5" />
          Save pattern
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 p-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Save pattern
          </div>
          <div className="text-xs text-muted-foreground">
            Stored under {host}. Backend can re-run on schedule.
          </div>
        </div>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${host} ${kind}`}
          className="h-8 rounded-full text-xs"
        />

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">Target user table</div>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-8 w-full rounded-full bg-secondary/40 px-3 text-xs outline-none focus-visible:ring-1"
          >
            <option value={NO_TABLE}>(don't append rows now)</option>
            <option value={NEW_TABLE}>+ Create new from these fields…</option>
            {tables?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {target === NEW_TABLE && (
          <div className="space-y-2 rounded-xl bg-secondary/40 p-2">
            <Input
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              placeholder="New table name…"
              className="h-7 rounded-full bg-background text-xs"
            />
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Inferred schema
              </div>
              {inferredFields.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  Run extraction first to infer fields.
                </div>
              ) : (
                <div className="max-h-32 space-y-0.5 overflow-y-auto">
                  {inferredFields.map((f) => (
                    <div key={f.field_name} className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-mono">{f.field_name}</span>
                      <span className="ml-2 shrink-0 text-muted-foreground">{f.data_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {err && (
          <div className="rounded-lg bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {err}
          </div>
        )}

        {savedSummary && (
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3" />
            {savedSummary}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7">
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={!canSave} className="h-7">
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
