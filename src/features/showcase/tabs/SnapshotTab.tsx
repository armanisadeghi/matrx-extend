import { Button } from '@/components/ui/button';
import { useExtraction } from '@/hooks/use-extraction';
import { Camera, Loader2 } from 'lucide-react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

export function SnapshotTab({ active = true }: { active?: boolean }) {
  const { detection, rows, running, error, run } = useExtraction('og_meta', {
    autoDetect: active,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Snapshot
          </div>
          <div className="text-xs text-muted-foreground">
            One-shot grab of every metadata signal: title, description, OG tags, Twitter card,
            JSON-LD, canonical URL, language. Ideal for news articles and blog posts.
          </div>
        </div>

        {detection && (
          <div className="rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            {detection.summary}
          </div>
        )}

        <Button onClick={() => void run({})} disabled={running} className="w-full rounded-full">
          {running ? <Loader2 className="animate-spin" /> : <Camera />}
          {running ? 'Capturing…' : 'Capture snapshot'}
        </Button>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {rows && <ResultPreview rows={rows} />}

        {rows && rows.length > 0 && (
          <div className="flex justify-end">
            <SaveAsPattern kind="og_meta" config={{}} rows={rows} defaultName="Page snapshot" />
          </div>
        )}
      </div>
    </div>
  );
}
