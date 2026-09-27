/**
 * Optional filing after a Save lands — the web app's Save panel
 * (matrx-frontend `features/sources/SaveSourcePanel.tsx`), brought to the
 * extension. The page is ALREADY a Source when this appears: nothing here
 * blocks or precedes the save, and closing it files nothing.
 *
 *   - File it in: any registered place (project, task, scope, research topic,
 *     deck, podcast episode, war room, data store) through the same
 *     `UniversalAssociationPicker` the web app uses.
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
function useMyLibraries(userId: string | null) {
  const [libraries, setLibraries] = useState<LibraryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return undefined;
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
  }, [userId]);
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
  const { libraries, error: librariesError } = useMyLibraries(userId);
  const [staged, setStaged] = useState<StagedTarget[]>([]);
  const [libraryId, setLibraryId] = useState<string | null>(() =>
    readRememberedLibrary(localStore(), userId),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; lines: string[] } | null>(null);
  const store = useMemo(() => getAssociationsStore(), []);

  const attachTo = buildAttachTargets(staged, libraryId);
  const attachedKeys = new Set(staged.map((t) => attachedKey(t.token, t.id)));

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
            <FolderPlus className="size-3.5" /> File it somewhere (optional)
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

        <label className="block space-y-1">
          <span className="text-muted-foreground">Add to a Library (media catalog)</span>
          {librariesError ? (
            <span className="block text-red-600 dark:text-red-400">{librariesError}</span>
          ) : (
            <select
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
              {libraryId && !libraries.some((l) => l.id === libraryId) && libraries.length > 0 && (
                <option value={libraryId}>A Library you chose earlier (no longer listed)</option>
              )}
            </select>
          )}
        </label>

        <div className="space-y-1">
          <span className="text-muted-foreground">File it in</span>
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
          <div className="max-h-64 overflow-y-auto rounded-md">
            <UniversalAssociationPicker
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
          </div>
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
