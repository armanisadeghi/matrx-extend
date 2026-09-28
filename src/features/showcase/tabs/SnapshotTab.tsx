import { refreshActiveTabIdentity } from '@/hooks/use-active-tab';
import { useExtraction } from '@/hooks/use-extraction';
import { Button } from '@ai-matrx/design-system';
import { Camera, Loader2 } from 'lucide-react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

export function SnapshotTab({ active = true }: { active?: boolean }) {
  const { tab, detection, rows, running, error, source, previewConfig, run } = useExtraction(
    'og_meta',
    {
      autoDetect: active,
    },
  );

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

        <Button
          onClick={() => void run({})}
          disabled={running || !tab.pageKey}
          className="w-full rounded-full"
        >
          {running ? <Loader2 className="animate-spin" /> : <Camera />}
          {running ? 'Capturing…' : 'Capture snapshot'}
        </Button>

        {!tab.pageKey && (
          <div className="rounded-xl bg-secondary/40 p-3 text-xs">
            {tab.identityError ?? 'Checking this page…'}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void refreshActiveTabIdentity()}
            >
              Retry
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {rows && <ResultPreview rows={rows} source={source} />}

        {rows && rows.length > 0 && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="og_meta"
              config={previewConfig}
              rows={rows}
              source={source}
              defaultName="Page snapshot"
            />
          </div>
        )}
      </div>
    </div>
  );
}
