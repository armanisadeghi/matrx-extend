import { Button } from '@/components/ui/button';
import { useExtraction } from '@/hooks/use-extraction';
import { Loader2, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

export function TablesTab() {
  const [tableIndex, setTableIndex] = useState(0);
  const { detection, rows, running, error, run } = useExtraction('auto_table');

  const tableCount = detection?.count ?? 0;
  const indices = Array.from({ length: tableCount }, (_, i) => i);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Tables
          </div>
          <div className="text-xs text-muted-foreground">
            Detects every <code className="rounded bg-secondary/60 px-1">&lt;table&gt;</code> on the
            page (≥2 rows). Pick which one and extract as JSON.
          </div>
        </div>

        <div className="rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          {detection ? detection.summary : 'Detecting…'}
        </div>

        {indices.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {indices.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setTableIndex(i)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  tableIndex === i
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70'
                }`}
              >
                Table {i}
              </button>
            ))}
          </div>
        )}

        <Button
          onClick={() => void run({ table_index: tableIndex })}
          disabled={running || !detection?.available}
          className="w-full rounded-full"
        >
          {running ? <Loader2 className="animate-spin" /> : <PlayCircle />}
          {running ? 'Extracting…' : `Extract table ${tableIndex}`}
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
              kind="auto_table"
              config={{ table_index: tableIndex }}
              rows={rows}
              defaultName={`Table ${tableIndex}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
