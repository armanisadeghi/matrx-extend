/**
 * "Add this page to a project" — popover button used in the Scrape and
 * Tasks views. Lists the user's research topics, one click adds the
 * current URL as a source.
 *
 * Endpoints:
 *   - GET  /research/topics                       (required)
 *   - POST /research/topics/{id}/sources          (required, idempotent)
 *   - GET  /research/sources/by-url?url={url}     (optional — when present
 *     the popover shows "already in: TopicX" inline hints; when 404 the
 *     button just degrades to a plain picker)
 *
 * Spec for the server team: aidream/docs/EXTENSION_TOPIC_PICKER_API.md
 */

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  type ResearchTopicSummary,
  type SourceUrlMatch,
  addSourceToTopic,
  findSourcesByUrl,
  listTopics,
} from '@/lib/api/routes/research';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, FolderPlus, Loader2, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

interface AddToProjectButtonProps {
  url: string | null;
  title?: string | null;
  /** Compact icon-only trigger when there's no room for a label. */
  variant?: 'inline' | 'icon';
}

export function AddToProjectButton({ url, title, variant = 'inline' }: AddToProjectButtonProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const {
    data: topics,
    error: topicsError,
    isPending: topicsLoading,
  } = useQuery<ResearchTopicSummary[], Error>({
    queryKey: ['research-topics'],
    queryFn: async () => {
      const r = await listTopics();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  // Optional cross-topic lookup. If the endpoint isn't shipped yet (404),
  // we silently swallow the error and the inline "already in" hints don't
  // appear. The picker still works.
  const { data: existingMatches } = useQuery<SourceUrlMatch[], Error>({
    queryKey: ['source-url-matches', url],
    queryFn: async () => {
      if (!url) return [];
      const r = await findSourcesByUrl(url);
      if (!r.ok) {
        // Silent fail — endpoint is optional.
        return [];
      }
      return r.data.matches;
    },
    enabled: open && !!url,
    staleTime: 30_000,
  });

  const matchByTopic = useMemo(() => {
    const m = new Map<string, SourceUrlMatch>();
    for (const x of existingMatches ?? []) m.set(x.topic_id, x);
    return m;
  }, [existingMatches]);

  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = topics ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => t.name.toLowerCase().includes(q));
  }, [topics, filter]);

  const handlePick = async (topic: ResearchTopicSummary) => {
    if (!url) return;
    setError(null);
    setAdding(topic.id);
    const r = await addSourceToTopic(topic.id, {
      url,
      ...(title != null && { title }),
    });
    setAdding(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAdded(topic.id);
    // Invalidate so the queue or topic-pickers anywhere else refresh.
    void queryClient.invalidateQueries({ queryKey: ['source-url-matches', url] });
    void queryClient.invalidateQueries({ queryKey: ['scrape-queue'] });
    setTimeout(() => {
      setOpen(false);
      setAdded(null);
    }, 1200);
  };

  const trigger =
    variant === 'icon' ? (
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        title="Add this page to a project"
        disabled={!url}
      >
        <FolderPlus className="size-3.5" />
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 rounded-full px-2.5 text-xs text-muted-foreground"
        title="Add this page to a research project"
        disabled={!url}
      >
        <Plus className="size-3.5" /> Add to project
      </Button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-2.5 py-2">
          <div className="text-xs font-medium">Add this page to…</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {title || url || 'No active page'}
          </div>
        </div>

        {topicsLoading && (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading projects…
          </div>
        )}

        {topicsError && (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            <div className="font-medium text-destructive">Couldn't load projects</div>
            <div className="mt-0.5 leading-snug">
              The /research/topics endpoint may not be shipped yet. Server-team spec lives in
              aidream/docs/EXTENSION_TOPIC_PICKER_API.md.
            </div>
            <div className="mt-1 font-mono text-[10px] opacity-70">{topicsError.message}</div>
          </div>
        )}

        {!topicsLoading && !topicsError && topics && (
          <>
            {topics.length > 5 && (
              <div className="border-b px-2 py-1.5">
                <div className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2">
                  <Search className="size-3 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search projects"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-6 flex-1 bg-transparent text-xs focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {topics.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                You don't have any research projects yet.
              </div>
            )}

            {filtered.length === 0 && topics.length > 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">No matching projects.</div>
            )}

            <div className="max-h-72 overflow-y-auto p-1">
              {filtered.map((topic) => {
                const alreadyIn = matchByTopic.get(topic.id);
                const isAdding = adding === topic.id;
                const justAdded = added === topic.id;
                const disabled = isAdding || !!alreadyIn;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => handlePick(topic)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                      !disabled && 'hover:bg-accent',
                      disabled && 'cursor-default opacity-70',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{topic.name}</div>
                      {(alreadyIn || topic.source_count != null) && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {alreadyIn
                            ? 'already in this project'
                            : `${topic.source_count} ${topic.source_count === 1 ? 'source' : 'sources'}`}
                        </div>
                      )}
                    </div>
                    {isAdding && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
                    {justAdded && <Check className="size-3.5 shrink-0 text-emerald-500" />}
                    {alreadyIn && !isAdding && !justAdded && (
                      <Check className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {!isAdding && !justAdded && !alreadyIn && (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {error && <div className="border-t px-3 py-2 text-[11px] text-destructive">{error}</div>}
      </PopoverContent>
    </Popover>
  );
}
