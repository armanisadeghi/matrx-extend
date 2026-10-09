/**
 * Optional additional filing, opened explicitly from a Saved Source.
 * The first Save already accepts a name and places through /sources/land.
 * This panel keeps the later add-place path available without reopening the
 * broad picker or reading Libraries until the user chooses either control.
 *
 *   - File it in: any registered place (project, task, scope, research topic,
 *     deck, podcast episode, war room, data store) through the same
 *     canonical one-type candidate body, with universal search on demand.
 *   - Add to a Library (media catalog, optional), remembered per person.
 *
 * The write is `POST /sources/{id}/keep` with `attach_to` (the door's edge
 * labels via `buildAttachTargets`); the notice names every place filed.
 */
import { keepSource } from '@/lib/api/routes/sources';
import { getAssociationsStore } from '@/lib/sources/associations-store';
import {
  SAVE_TARGET_TOKENS,
  type StagedTarget,
  buildAttachTargets,
  filedPlacesWords,
  intelligenceSentence,
  readRememberedLibrary,
  writeRememberedLibrary,
} from '@/lib/sources/save-source-logic';
import { mediaDb } from '@/lib/supabase/schemas';
import { useAuthStore } from '@/state/auth';
import { pushNotice } from '@/state/notices';
import type { EntityTypeToken } from '@ai-matrx/associations';
import {
  AssociationCandidateBody,
  AssociationsProvider,
  UniversalAssociationPicker,
  attachedKey,
} from '@ai-matrx/associations/react';
import { Button } from '@ai-matrx/design-system';
import { FolderPlus, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface LibraryOption {
  id: string;
  name: string;
  adapter: string;
}

function localStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The person's media-catalog Libraries (the ones they made), web-capture first. */
function useMyLibraries(userId: string | null, enabled: boolean) {
  const [libraries, setLibraries] = useState<LibraryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!userId || !enabled) return undefined;
    let cancelled = false;
    void (async () => {
      const { data, error: readError } = await mediaDb()
        .from('source_library')
        .select('id,name,adapter')
        .eq('created_by', userId)
        .is('deleted_at', null)
        .order('name')
        .limit(200);
      if (cancelled) return;
      if (readError) {
        setError('Your Libraries could not be loaded, so none can be chosen right now.');
        return;
      }
      const rows = ((data ?? []) as LibraryOption[]).slice();
      rows.sort(
        (a, b) => Number(b.adapter === 'web_capture') - Number(a.adapter === 'web_capture'),
      );
      setLibraries(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);
  return { libraries, error };
}

const NO_LIBRARY = '';

export function FileSourcePanel({
  processedDocumentId,
  organizationId,
  onClose,
}: {
  processedDocumentId: string;
  /** The organization the Source landed in — filing is bound to it. */
  organizationId: string;
  onClose: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showPlaces, setShowPlaces] = useState(false);
  const [placeType, setPlaceType] = useState<EntityTypeToken | 'all' | null>(null);
  const { libraries, error: librariesError } = useMyLibraries(userId, showLibrary);
  const [staged, setStaged] = useState<StagedTarget[]>([]);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; lines: string[] } | null>(null);
  const store = useMemo(() => getAssociationsStore(), []);

  const attachTo = buildAttachTargets(staged, libraryId);
  const attachedKeys = new Set(staged.map((t) => attachedKey(t.token, t.id)));
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

  const openLibrary = () => {
    setLibraryId(readRememberedLibrary(localStore(), userId));
    setShowLibrary(true);
  };

  const chooseLibrary = (value: string) => {
    const next = value === NO_LIBRARY ? null : value;
    setLibraryId(next);
    writeRememberedLibrary(localStore(), userId, next);
  };

  const file = async () => {
    if (attachTo.length === 0) return;
    setBusy(true);
    setResult(null);
    const outcome = await keepSource(
      processedDocumentId,
      { keep: true, attach_to: attachTo },
      userId ? { userId, organizationId } : undefined,
    );
    setBusy(false);
    if (!outcome.ok) {
      setResult({ tone: 'error', lines: [outcome.refusal.message] });
      pushNotice({ tone: 'error', title: 'Not filed', message: outcome.refusal.message });
      return;
    }
    const libraryName = libraryId
      ? (libraries.find((l) => l.id === libraryId)?.name ?? 'you chose')
      : null;
    const words = filedPlacesWords(staged, libraryName);
    const sentence = `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
    const lines = [
      sentence,
      ...outcome.landed.notices.map((n) => n.message),
      intelligenceSentence(outcome.landed.intelligence, outcome.landed.kept),
    ];
    setResult({ tone: 'ok', lines: [...new Set(lines)] });
    pushNotice({ tone: 'info', title: 'Source filed', message: sentence });
  };

  return (
    <AssociationsProvider
      store={store}
      notifier={{
        success: () => undefined,
        error: (message, opts) =>
          pushNotice({
            tone: 'error',
            title: 'Filing picker',
            message: opts?.description ? `${message} ${opts.description}` : message,
          }),
      }}
    >
      <section
        aria-label="File this Source"
        data-testid="file-source-panel"
        className="space-y-2 rounded-xl border border-border bg-card p-2.5 text-xs"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 font-medium">
            <FolderPlus className="size-3.5" /> File elsewhere
          </span>
          <button
            type="button"
            aria-label="Close filing"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {!showPlaces && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-xs"
              onClick={() => setShowPlaces(true)}
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
              onClick={openLibrary}
            >
              Add to Library
            </Button>
          )}
        </div>
        {showLibrary && (
          <label htmlFor="file-source-library" className="block space-y-1">
            <span className="text-muted-foreground">Add to a Library (media catalog)</span>
            {librariesError ? (
              <span className="block text-red-600 dark:text-red-400">{librariesError}</span>
            ) : (
              <select
                id="file-source-library"
                aria-label="Library"
                className="h-7 w-full rounded-md border border-border bg-background px-1.5"
                value={libraryId ?? NO_LIBRARY}
                onChange={(e) => chooseLibrary(e.target.value)}
              >
                <option value={NO_LIBRARY}>No Library</option>
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                {libraryId &&
                  !libraries.some((l) => l.id === libraryId) &&
                  libraries.length > 0 && (
                    <option value={libraryId}>
                      A Library you chose earlier (no longer listed)
                    </option>
                  )}
              </select>
            )}
          </label>
        )}

        <div className="space-y-1">
          {showPlaces && (
            <>
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
            </>
          )}
          {staged.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {staged.map((t) => (
                <li
                  key={`${t.token}:${t.id}`}
                  className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5"
                >
                  <span className="max-w-[12rem] truncate">{t.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${t.label}`}
                    onClick={() =>
                      setStaged((prev) =>
                        prev.filter((p) => !(p.token === t.token && p.id === t.id)),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {placeType && (
            <section
              aria-label="Place results"
              className="h-48 overflow-y-auto overscroll-contain rounded-md border border-border"
              onKeyDown={(event) => {
                if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
                event.preventDefault();
                event.currentTarget.scrollTop +=
                  event.currentTarget.clientHeight * (event.key === 'PageDown' ? 1 : -1);
              }}
            >
              {placeType === 'all' ? (
                <UniversalAssociationPicker
                  key={placeType}
                  orgId={organizationId}
                  tokens={[...SAVE_TARGET_TOKENS] as EntityTypeToken[]}
                  attachedKeys={attachedKeys}
                  onAttach={async (token, resourceId, title) => {
                    setStaged((prev) =>
                      prev.some((p) => p.token === token && p.id === resourceId)
                        ? prev
                        : [...prev, { token, id: resourceId, label: title || token }],
                    );
                    return { ok: true };
                  }}
                  onDetach={async (token, resourceId) => {
                    setStaged((prev) =>
                      prev.filter((p) => !(p.token === token && p.id === resourceId)),
                    );
                    return { ok: true };
                  }}
                />
              ) : (
                <AssociationCandidateBody
                  key={placeType}
                  token={placeType}
                  enabled
                  orgId={organizationId}
                  attachedIds={
                    new Set(
                      staged.filter((item) => item.token === placeType).map((item) => item.id),
                    )
                  }
                  onAttach={async (resourceId, title) => {
                    setStaged((prev) =>
                      prev.some((p) => p.token === placeType && p.id === resourceId)
                        ? prev
                        : [
                            ...prev,
                            { token: placeType, id: resourceId, label: title || placeType },
                          ],
                    );
                    return { ok: true };
                  }}
                  onDetach={async (resourceId) => {
                    setStaged((prev) =>
                      prev.filter((p) => !(p.token === placeType && p.id === resourceId)),
                    );
                    return { ok: true };
                  }}
                />
              )}
            </section>
          )}
        </div>

        {attachTo.length > 0 && (
          <Button
            size="sm"
            className="h-7 w-full rounded-full text-xs"
            disabled={busy}
            onClick={() => void file()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            File in {attachTo.length === 1 ? '1 place' : `${attachTo.length} places`}
          </Button>
        )}

        {result && (
          <ul
            data-testid="file-source-result"
            className={
              result.tone === 'ok'
                ? 'space-y-0.5 text-muted-foreground'
                : 'space-y-0.5 text-red-600 dark:text-red-400'
            }
          >
            {result.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    </AssociationsProvider>
  );
}
