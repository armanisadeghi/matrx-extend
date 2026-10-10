import type { AttachTarget } from '@/lib/api/routes/sources';
import { getAssociationsStore } from '@/lib/sources/associations-store';
import {
  SAVE_TARGET_TOKENS,
  type StagedTarget,
  buildAttachTargets,
  readRememberedLibrary,
  writeRememberedLibrary,
} from '@/lib/sources/save-source-logic';
import { mediaDb } from '@/lib/supabase/schemas';
import { useAuthStore } from '@/state/auth';
import { pushNotice } from '@/state/notices';
import type { EntityTypeToken } from '@ai-matrx/associations';
import {
  AssociationsProvider,
  useAssociationCandidates,
  useAssociationsStore,
  useUniversalEntitySearch,
} from '@ai-matrx/associations/react';
import { Button } from '@ai-matrx/design-system';
import { Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface LibraryOption {
  id: string;
  name: string;
  adapter: string;
}

const placeLabels: Record<(typeof SAVE_TARGET_TOKENS)[number], string> = {
  project: 'Projects',
  task: 'Tasks',
  scope: 'Scopes',
  research_topic: 'Research topics',
  fc_set: 'Flashcard decks',
  pc_episode: 'Podcast episodes',
  war_room: 'War rooms',
  data_store: 'Data stores',
};

function placeLabel(token: EntityTypeToken): string {
  return token in placeLabels ? placeLabels[token as keyof typeof placeLabels] : token;
}

function PlaceResults({
  placeType,
  organizationId,
  staged,
  setStaged,
}: {
  placeType: EntityTypeToken | 'all';
  organizationId: string;
  staged: StagedTarget[];
  setStaged: React.Dispatch<React.SetStateAction<StagedTarget[]>>;
}) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const associations = useAssociationsStore();
  const entityInfo = associations.registry.getEntityInfo(
    placeType === 'all' ? 'project' : placeType,
  );
  const canCreate =
    placeType !== 'all' && entityInfo.titleColumn !== null && entityInfo.listCandidates === null;
  const all = useUniversalEntitySearch({
    query: search,
    tokens: [...SAVE_TARGET_TOKENS] as EntityTypeToken[],
    enabled: placeType === 'all',
    emptyQueryMode: 'candidates',
  });
  const one = useAssociationCandidates({
    token: placeType === 'all' ? 'project' : placeType,
    enabled: placeType !== 'all',
    ...(search.trim() && { search: search.trim() }),
  });
  const candidates =
    placeType === 'all'
      ? all.results
      : one.candidates.map((candidate) => ({ ...candidate, token: placeType }));
  const loading = placeType === 'all' ? all.loading : one.loading;
  const error = placeType === 'all' ? all.error : one.error;

  const createPlace = async () => {
    const title = createName.trim();
    if (!title || !canCreate || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const result = await associations.entityRows.createEntityRow(placeType, {
        title,
        orgId: organizationId,
      });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setStaged((prev) =>
        prev.some((item) => item.token === placeType && item.id === result.data.id)
          ? prev
          : [...prev, { token: placeType, id: result.data.id, label: result.data.title }],
      );
      setCreating(false);
      setCreateName('');
      one.reload();
    } catch {
      setCreateError(`Could not create ${entityInfo.label.toLowerCase()}.`);
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <section aria-label="Place results" className="min-h-0 rounded-md border border-border">
      <input
        aria-label={placeType === 'all' ? 'Search all places' : `Search ${placeLabel(placeType)}`}
        placeholder={placeType === 'all' ? 'Search all places' : `Search ${placeLabel(placeType)}`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-8 w-full border-b border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
      />
      <div
        className="h-40 overflow-y-auto overscroll-contain"
        onKeyDown={(event) => {
          if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
          event.preventDefault();
          event.currentTarget.scrollTop +=
            event.currentTarget.clientHeight * (event.key === 'PageDown' ? 1 : -1);
        }}
      >
        {error ? (
          <div className="px-2 py-2 text-red-600 dark:text-red-400">Could not load places.</div>
        ) : candidates.length === 0 ? (
          <div className="px-2 py-2 text-muted-foreground">
            {loading ? 'Loading…' : 'No places found.'}
          </div>
        ) : (
          <ul>
            {candidates.map((candidate) => {
              const selected = staged.some(
                (item) => item.token === candidate.token && item.id === candidate.id,
              );
              return (
                <li key={`${candidate.token}:${candidate.id}`}>
                  <button
                    type="button"
                    aria-label={candidate.title}
                    aria-pressed={selected}
                    title={candidate.title}
                    onClick={() =>
                      setStaged((prev) =>
                        selected
                          ? prev.filter(
                              (item) =>
                                !(item.token === candidate.token && item.id === candidate.id),
                            )
                          : [
                              ...prev,
                              {
                                token: candidate.token,
                                id: candidate.id,
                                label: candidate.title,
                              },
                            ],
                      )
                    }
                    className="flex h-8 w-full items-center gap-2 border-b border-border/50 px-2 text-left text-xs last:border-0 hover:bg-accent focus-visible:bg-accent aria-pressed:bg-accent/70"
                  >
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                    {placeType === 'all' && (
                      <span className="shrink-0 text-muted-foreground">
                        {placeLabel(candidate.token)}
                      </span>
                    )}
                    {selected && <span className="shrink-0 font-medium">Selected</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {canCreate &&
        (creating ? (
          <div className="flex items-center gap-1 border-t border-border p-1">
            <input
              aria-label={`New ${entityInfo.label} name`}
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createPlace();
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setCreating(false);
                }
              }}
              disabled={createBusy}
              className="h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
            />
            <button
              type="button"
              disabled={createBusy || !createName.trim()}
              onClick={() => void createPlace()}
              className="px-2 font-medium text-primary disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              disabled={createBusy}
              onClick={() => setCreating(false)}
              className="px-2 text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreateName(search.trim());
              setCreateError(null);
              setCreating(true);
            }}
            className="h-8 w-full border-t border-border px-2 text-left text-xs text-primary hover:bg-accent"
          >
            Create new {entityInfo.label.toLowerCase()}
          </button>
        ))}
      {createError && <div className="px-2 pb-1 text-xs text-red-600">{createError}</div>}
    </section>
  );
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The choices stay local until one landing request saves the name and places together. */
export function SaveSourceForm({
  initialName,
  sourceUrl,
  organizationId,
  saving,
  error,
  onSave,
  onClose,
}: {
  initialName: string;
  sourceUrl: string;
  organizationId: string | null;
  saving: boolean;
  error?: string | null;
  onSave: (name: string, attachTo: AttachTarget[]) => void;
  onClose: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [name, setName] = useState(initialName);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [showPlaces, setShowPlaces] = useState(false);
  const [placeType, setPlaceType] = useState<EntityTypeToken | 'all' | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [staged, setStaged] = useState<StagedTarget[]>([]);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [libraries, setLibraries] = useState<LibraryOption[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const store = useMemo(
    () => (showPlaces && placeType && organizationId ? getAssociationsStore() : null),
    [showPlaces, placeType, organizationId],
  );

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    nameRef.current?.focus();
    return () => {
      dialogRef.current?.close();
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!showLibrary || !userId) return;
    let cancelled = false;
    setLibraryId(readRememberedLibrary(localStore(), userId));
    void mediaDb()
      .from('source_library')
      .select('id,name,adapter')
      .eq('created_by', userId)
      .is('deleted_at', null)
      .order('name')
      .limit(200)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setLibraryError('Libraries could not be loaded.');
        else
          setLibraries(
            ((data ?? []) as LibraryOption[])
              .slice()
              .sort(
                (a, b) => Number(b.adapter === 'web_capture') - Number(a.adapter === 'web_capture'),
              ),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [showLibrary, userId]);

  const attachTo = buildAttachTargets(staged, libraryId);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Save Source"
      data-testid="save-source-form"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((control) => {
          if (control.getAttribute('aria-hidden') === 'true') return false;
          for (
            let ancestor: HTMLElement | null = control;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            if (ancestor.hidden) return false;
            const style = window.getComputedStyle(ancestor);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (ancestor === dialog) break;
          }
          return true;
        });
        if (controls.length === 0) return;
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (current < 0 ? controls.length : current) - 1
          : (current + 1) % controls.length;
        controls[(next + controls.length) % controls.length]?.focus();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="fixed inset-x-2 bottom-2 top-auto mx-auto max-h-[85vh] w-[calc(100%-1rem)] space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-xl backdrop:bg-black/20"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Save Source</span>
        <button
          type="button"
          aria-label="Close Save Source"
          onClick={onClose}
          disabled={saving}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <label className="block space-y-1">
        <span className="font-medium text-muted-foreground">Name</span>
        <input
          ref={nameRef}
          aria-label="Source name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <div className="space-y-1">
        <span className="font-medium text-muted-foreground">URL</span>
        <div className="truncate rounded-md bg-muted/40 px-2 py-1.5 text-xs" title={sourceUrl}>
          {sourceUrl}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!showPlaces && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs"
            onClick={() => setShowPlaces(true)}
            disabled={!organizationId}
          >
            Choose a place
          </Button>
        )}
        {!showLibrary && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs"
            onClick={() => setShowLibrary(true)}
          >
            Add to Library
          </Button>
        )}
      </div>
      {staged.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {staged.map((target) => (
            <li
              key={`${target.token}:${target.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5"
            >
              <span className="max-w-40 truncate">{target.label}</span>
              <button
                type="button"
                aria-label={`Remove ${target.label}`}
                onClick={() =>
                  setStaged((prev) =>
                    prev.filter((item) => !(item.token === target.token && item.id === target.id)),
                  )
                }
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {showPlaces && (
        <div className="space-y-1">
          <span className="text-muted-foreground">Place type</span>
          <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
            {SAVE_TARGET_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                aria-pressed={placeType === token}
                onClick={() => setPlaceType(token)}
                className="rounded-full border border-border px-2 py-0.5 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {placeLabels[token]}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={placeType === 'all'}
              onClick={() => setPlaceType('all')}
              className="rounded-full border border-border px-2 py-0.5 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              Search all
            </button>
          </div>
        </div>
      )}
      {showPlaces && placeType && organizationId && store && (
        <AssociationsProvider
          store={store}
          notifier={{
            success: () => undefined,
            error: (message, options) =>
              pushNotice({
                tone: 'error',
                title: 'Place search',
                message: options?.description ? `${message} ${options.description}` : message,
              }),
          }}
        >
          <PlaceResults
            key={placeType}
            placeType={placeType}
            organizationId={organizationId}
            staged={staged}
            setStaged={setStaged}
          />
        </AssociationsProvider>
      )}
      {showLibrary && (
        <label className="block space-y-1">
          <span className="font-medium text-muted-foreground">Library</span>
          {libraryError && <span className="block text-red-600">{libraryError}</span>}
          <select
            aria-label="Library"
            value={libraryId ?? ''}
            onChange={(event) => {
              const next = event.target.value || null;
              setLibraryId(next);
              writeRememberedLibrary(localStore(), userId, next);
            }}
            className="h-8 w-full rounded-md border border-border bg-background px-2"
          >
            <option value="">No Library</option>
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <Button
        type="button"
        size="sm"
        disabled={saving}
        className="sticky bottom-0 z-10 h-8 w-full rounded-full"
        onClick={() => onSave(name.trim() || initialName, attachTo)}
      >
        {saving && <Loader2 className="animate-spin" />}Save Source
      </Button>
    </dialog>
  );
}
