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
  UniversalAssociationPicker,
  attachedKey,
} from '@ai-matrx/associations/react';
import { Button } from '@ai-matrx/design-system';
import { Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface LibraryOption {
  id: string;
  name: string;
  adapter: string;
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
  organizationId,
  saving,
  onSave,
  onClose,
}: {
  initialName: string;
  organizationId: string | null;
  saving: boolean;
  onSave: (name: string, attachTo: AttachTarget[]) => void;
  onClose: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [name, setName] = useState(initialName);
  const nameRef = useRef<HTMLInputElement>(null);
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
    nameRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

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

  const attachedKeys = new Set(staged.map((t) => attachedKey(t.token, t.id)));
  const attachTo = buildAttachTargets(staged, libraryId);
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

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Save Source"
      data-testid="save-source-form"
      className="relative m-0 max-h-[85vh] w-full space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-3 text-xs text-foreground shadow-xl"
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
          <div className="flex h-48 min-h-0 flex-col overflow-hidden rounded-md border border-border">
            <UniversalAssociationPicker
              key={placeType}
              orgId={organizationId}
              tokens={
                placeType === 'all' ? ([...SAVE_TARGET_TOKENS] as EntityTypeToken[]) : [placeType]
              }
              attachedKeys={attachedKeys}
              onAttach={async (token, id, title) => {
                setStaged((prev) =>
                  prev.some((item) => item.token === token && item.id === id)
                    ? prev
                    : [...prev, { token, id, label: title || token }],
                );
                return { ok: true };
              }}
              onDetach={async (token, id) => {
                setStaged((prev) =>
                  prev.filter((item) => !(item.token === token && item.id === id)),
                );
                return { ok: true };
              }}
            />
          </div>
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
