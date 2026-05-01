import { CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { rowsToTsv, stringifyJson, wrapJsonForAgent } from '@/lib/clipboard/copy';
import { cn } from '@/lib/utils';
import { Braces, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';

type View = 'table' | 'json';

interface ResultPreviewProps {
  rows: Record<string, unknown>[];
  emptyHint?: string;
  maxHeight?: number;
  /** Source URL/title for AI-wrapped copy. Optional. */
  source?: { url?: string | null; title?: string | null };
  /** Mode/recipe label for AI-wrapped copy. Optional. */
  description?: string;
}

/**
 * Shared result preview used by every Showcase sub-tab. Toggles between a
 * table view (good for tabular extraction like Mode D, list pattern) and a
 * raw-JSON view (good for nested objects like JSON-LD or framework data).
 */
export function ResultPreview({
  rows,
  emptyHint,
  maxHeight = 320,
  source,
  description = 'extracted rows from a webpage',
}: ResultPreviewProps) {
  const [view, setView] = useState<View>('table');

  const copyOptions = useMemo(
    () => [
      {
        label: 'Copy JSON',
        description: 'Pretty-printed JSON of all rows.',
        getContent: () => stringifyJson(rows),
      },
      {
        label: 'Copy TSV',
        description: 'Tab-separated, ready to paste into a spreadsheet.',
        getContent: () => rowsToTsv(rows),
      },
      {
        label: 'Copy for AI',
        description: 'JSON wrapped with source URL + a one-line preamble for chat.',
        ai: true,
        getContent: () =>
          wrapJsonForAgent(rows, {
            description,
            source: source ?? {},
            meta: { row_count: rows.length },
          }),
      },
    ],
    [rows, source, description],
  );

  if (rows.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyHint ?? 'No rows extracted.'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {rows.length} row{rows.length === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-1">
          <CopyMenu options={copyOptions} title="Copy" size="sm" />
          <ViewToggle active={view === 'table'} onClick={() => setView('table')}>
            <Table2 className="size-3" /> Table
          </ViewToggle>
          <ViewToggle active={view === 'json'} onClick={() => setView('json')}>
            <Braces className="size-3" /> JSON
          </ViewToggle>
        </div>
      </div>
      {view === 'table' ? (
        <TableView rows={rows} maxHeight={maxHeight} />
      ) : (
        <pre
          className="overflow-auto whitespace-pre rounded-xl bg-secondary/40 p-3 text-[11px]"
          style={{ maxHeight }}
        >
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn(
        'h-6 gap-1 rounded-md px-2 text-[10px] uppercase tracking-wider',
        active && 'bg-secondary text-foreground',
      )}
    >
      {children}
    </Button>
  );
}

function TableView({ rows, maxHeight }: { rows: Record<string, unknown>[]; maxHeight: number }) {
  const cols = Array.from(
    rows.reduce((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k);
      return acc;
    }, new Set<string>()),
  );

  const renderCell = (v: unknown): string => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };

  return (
    <div className="overflow-auto rounded-xl bg-secondary/40 text-[11px]" style={{ maxHeight }}>
      <table className="w-full">
        <thead className="sticky top-0 bg-secondary/90 backdrop-blur">
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-border/40 px-2 py-1.5 text-left font-medium text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: render-only preview, rows don't reorder.
            <tr key={i} className="border-b border-border/20 last:border-0">
              {cols.map((c) => (
                <td key={c} className="max-w-[200px] truncate px-2 py-1 align-top">
                  {renderCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && (
        <div className="px-2 py-1.5 text-center text-muted-foreground">
          Showing first 200 of {rows.length} rows
        </div>
      )}
    </div>
  );
}
