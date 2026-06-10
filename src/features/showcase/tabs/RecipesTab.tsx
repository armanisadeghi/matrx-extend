import { Button } from '@/components/ui/button';
import { useActiveTab } from '@/hooks/use-active-tab';
import { type ExtractionSource, sourceFromUrl } from '@/hooks/use-extraction';
import { RECIPES, type Recipe, recipesForUrl } from '@/lib/data-pattern/recipes';
import { runMode } from '@/lib/data-pattern/run-pattern';
import { cn } from '@/lib/utils';
import { Loader2, PlayCircle, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

export function RecipesTab() {
  const tab = useActiveTab();
  const [showAll, setShowAll] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [activeRecipe, setActiveRecipe] = useState<Recipe | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ExtractionSource | null>(null);

  const matching = useMemo(() => recipesForUrl(tab.url ?? ''), [tab.url]);
  const visible = showAll ? RECIPES : matching;

  // Rows from the previous page must not display (or save) under the new one.
  useEffect(() => {
    setRows(null);
    setActiveRecipe(null);
    setError(null);
    setSource(null);
  }, [tab.url]);

  const handleRun = async (recipe: Recipe) => {
    if (!tab.id) return;
    setRunning(recipe.id);
    setActiveRecipe(recipe);
    setError(null);
    setRows(null);
    const sourceAtRun = sourceFromUrl(tab.url);
    try {
      const data = await runMode(recipe.kind, tab.id, recipe.config);
      setRows(data);
      setSource(sourceAtRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recipes
          </div>
          <div className="text-xs text-muted-foreground">
            Pre-built configs for popular sites. One-click extract on supported pages.
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {matching.length > 0
              ? `${matching.length} recipe${matching.length === 1 ? '' : 's'} match this URL`
              : 'No recipes match this URL'}
          </span>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-medium text-primary hover:underline"
          >
            {showAll ? 'Show matching' : 'Show all'}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="grid place-items-center rounded-xl bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
            Try one of the supported sites: LinkedIn, Indeed, Yelp, Amazon, Eventbrite, Hacker News,
            recipe sites.
          </div>
        ) : (
          <div className="space-y-1.5">
            {visible.map((r) => (
              <div
                key={r.id}
                className={cn(
                  'rounded-xl bg-secondary/40 px-3 py-2',
                  matching.find((m) => m.id === r.id) && 'ring-1 ring-violet-500/40',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{r.label}</span>
                      <span className="rounded-full bg-secondary px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                        {r.kind.replace('_', ' ')}
                      </span>
                      {r.yieldsRows && (
                        <span className="rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] font-medium text-violet-700 dark:text-violet-400">
                          rows
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{r.description}</div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
                      {r.hosts.join(', ')}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleRun(r)}
                    disabled={running === r.id || !tab.id}
                    className="size-7 shrink-0"
                    title="Apply recipe"
                  >
                    {running === r.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {activeRecipe && rows && (
          <>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Sparkles className="mr-1 inline size-3" />
              Result · {activeRecipe.label}
            </div>
            <ResultPreview rows={rows} emptyHint="Recipe ran but returned no rows." />
            {rows.length > 0 && (
              <div className="flex justify-end">
                <SaveAsPattern
                  kind={activeRecipe.kind}
                  config={activeRecipe.config}
                  rows={rows}
                  source={source}
                  defaultName={activeRecipe.label}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
