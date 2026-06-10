import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useExtraction } from '@/hooks/use-extraction';
import { Loader2, PlayCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

export function JsonLdTab({ active = true }: { active?: boolean }) {
  const [filter, setFilter] = useState('');
  const { detection, rows, running, error, source, run } = useExtraction('json_ld', {
    autoDetect: active,
  });

  const types = useMemo(() => {
    const meta = detection?.meta as { types?: Record<string, number> } | undefined;
    return meta?.types ?? {};
  }, [detection]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            JSON-LD
          </div>
          <div className="text-xs text-muted-foreground">
            Reads <code className="rounded bg-secondary/60 px-1">application/ld+json</code> blocks
            already on the page. Highest-leverage mode for events, products, recipes, articles.
          </div>
        </div>

        <div className="rounded-xl bg-secondary/40 px-3 py-2 text-xs">
          <div className="text-muted-foreground">
            {detection ? detection.summary : 'Detecting…'}
          </div>
          {Object.keys(types).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {Object.entries(types).map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilter(t)}
                  className="rounded-full bg-background/60 px-2 py-px text-[10px] font-medium hover:bg-background"
                >
                  {t} <span className="text-muted-foreground">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by @type (e.g. Event)"
            className="h-9 rounded-full border-0 bg-secondary/40 text-xs focus-visible:ring-1"
          />
          <Button
            onClick={() => void run(filter ? { ld_type: filter } : {})}
            disabled={running || !detection?.available}
            className="h-9 rounded-full"
          >
            {running ? <Loader2 className="animate-spin" /> : <PlayCircle />}
            Extract
          </Button>
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {rows && <ResultPreview rows={rows} emptyHint="No matching JSON-LD blocks." />}

        {rows && rows.length > 0 && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="json_ld"
              config={filter ? { ld_type: filter } : {}}
              rows={rows}
              source={source}
              defaultName={filter ? `${filter} from JSON-LD` : 'JSON-LD blocks'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
