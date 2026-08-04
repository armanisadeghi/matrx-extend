/**
 * Admin model picker — searchable list of every active row in `ai_model`
 * (where `is_deprecated = false`). Lives inside the Debug-tab admin flags
 * panel.
 *
 * Writes to `useSettingsStore.modelOverrideId` — the SAME field the
 * user-facing Customize popover writes to. So an admin can either pick
 * from the curated 8-entry preset list (in the chat composer) OR pick any
 * model from the full DB (here). Both routes flow through to
 * `config_overrides.model` on the next chat request.
 *
 * The user's pick is persisted in `chrome.storage.local` (sticky across
 * reloads). Cleared by the "Clear" button or by re-picking "Auto" from the
 * Customize popover.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type AiModel, fetchActiveModels } from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/state/settings';
import { Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export function AdminModelPicker() {
  const overrideId = useSettingsStore((s) => s.modelOverrideId);
  const setOverrideId = useSettingsStore((s) => s.setModelOverrideId);
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // Ref (not state) so flipping in-flight doesn't re-trigger this effect and
  // cancel its own pending fetch via the cleanup path.
  const inFlightRef = useRef(false);

  // Lazy-load on first open. The DB rarely changes; cache for the panel's lifetime.
  useEffect(() => {
    if (!open || models !== null || inFlightRef.current) return;
    inFlightRef.current = true;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await fetchActiveModels();
        if (cancelled) return;
        setModels(list);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message ?? 'Failed to fetch models');
      } finally {
        inFlightRef.current = false;
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, models]);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.common_name.toLowerCase().includes(q));
  }, [models, query]);

  const selected = useMemo(
    () => (overrideId && models ? models.find((m) => m.id === overrideId) : null),
    [overrideId, models],
  );

  return (
    <div>
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] font-medium">config_overrides.model</div>
          <div className="text-[10px] leading-snug text-muted-foreground">
            Override the agent's default model. Pick any active row from `ai_model`. Sent verbatim —
            server resolves UUID → provider endpoint.
          </div>
          {overrideId && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-200/60 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
              {selected?.common_name ?? `${overrideId.slice(0, 8)}…`}
              <button
                type="button"
                onClick={() => setOverrideId(null)}
                className="text-amber-900/60 hover:text-amber-900 dark:text-amber-200/60 dark:hover:text-amber-100"
                title="Clear override"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 text-[11px]"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : overrideId ? 'Change' : 'Pick model'}
        </Button>
      </div>

      {open && (
        <div className="mt-1 rounded-md border bg-background/60 p-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by common name…"
            className="h-7 text-xs"
            autoFocus
          />
          <div className="mt-1.5 max-h-60 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Loading models…
              </div>
            )}
            {error && (
              <div className="px-2 py-3 text-[11px] text-red-600 dark:text-red-400">{error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-muted-foreground">
                {models?.length === 0 ? 'No active models found.' : 'No matches.'}
              </div>
            )}
            {!loading &&
              !error &&
              filtered.map((m) => {
                const active = m.id === overrideId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setOverrideId(m.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors hover:bg-accent',
                      active && 'bg-accent',
                    )}
                  >
                    <span className="truncate">{m.common_name}</span>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {m.id.slice(0, 8)}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
