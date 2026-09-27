/**
 * The Save panel's pure logic — the web app's
 * `matrx-frontend/features/sources/saveSourceLogic.ts` (SOURCE-CONVERGENCE
 * §8.3), ported for this repo's stricter compiler settings. The extension's
 * filing panel makes exactly the decisions the web app's Save panel makes;
 * `save-source-logic.test.ts` runs both implementations on the same inputs
 * whenever the sibling matrx-frontend checkout is present, so drift is red.
 *
 * What filing sends is `POST /sources/{id}/keep` with `{ keep, attach_to }`.
 */

/** Where a Source can be filed. Every pair is registered in
 * `platform.association_types` for `processed_document`. */
export const SAVE_TARGET_TOKENS = [
  'project',
  'task',
  'scope',
  'research_topic',
  'fc_set',
  'pc_episode',
  'war_room',
  'data_store',
] as const;

export type SaveTargetToken = (typeof SAVE_TARGET_TOKENS)[number];

/** The media-catalog Library token (a picker cannot list it; the panel reads it directly). */
export const LIBRARY_TOKEN = 'media_source_library';

export interface StagedTarget {
  token: string;
  id: string;
  label: string;
}

export interface AttachTargetWire {
  entity_type: string;
  entity_id: string;
  label?: string;
}

/** The per-person key the chosen Library is remembered under. */
export function rememberedLibraryKey(userId: string): string {
  return `matrx.sources.save-panel.library.${userId}`;
}

/** Read the remembered Library id; storage can be absent or throw. */
export function readRememberedLibrary(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  userId: string | null,
): string | null {
  if (!storage || !userId) return null;
  try {
    const value = storage.getItem(rememberedLibraryKey(userId));
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writeRememberedLibrary(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  userId: string | null,
  libraryId: string | null,
): void {
  if (!storage || !userId) return;
  try {
    if (libraryId) storage.setItem(rememberedLibraryKey(userId), libraryId);
    else storage.removeItem(rememberedLibraryKey(userId));
  } catch {
    // A convenience only — filing never depends on it.
  }
}

/** The wire `attach_to`: every staged place, plus the Library when one is chosen. */
export function buildAttachTargets(
  staged: readonly StagedTarget[],
  libraryId: string | null,
): AttachTargetWire[] {
  const seen = new Set<string>();
  const out: AttachTargetWire[] = [];
  for (const t of staged) {
    const key = `${t.token}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entity_type: t.token, entity_id: t.id });
  }
  if (libraryId && !seen.has(`${LIBRARY_TOKEN}:${libraryId}`)) {
    out.push({ entity_type: LIBRARY_TOKEN, entity_id: libraryId, label: 'catalogued_source' });
  }
  return out;
}

/** Whether the button has anything to do. */
export function hasSomethingToSave(save: boolean, attachTo: readonly AttachTargetWire[]): boolean {
  return save || attachTo.length > 0;
}

/** The door's processing answer in words. */
export function intelligenceSentence(
  intelligence: 'queued' | 'deferred' | 'never',
  kept: boolean,
): string {
  switch (intelligence) {
    case 'queued':
      return 'Processing has started: it will be cleaned, made searchable and read for entities.';
    case 'deferred':
      return kept
        ? "Saved. Processing is waiting — your organization's policy has not started it yet."
        : 'Not processed yet: it starts when you save it or file it somewhere.';
    case 'never':
      return "Your organization's policy never processes this kind of Source.";
  }
}

/** "filed in AI Advancements, June 2026 and AI Matrx" — every place, by name. */
export function filedPlacesWords(
  staged: readonly StagedTarget[],
  libraryName: string | null,
): string {
  const names = staged.map((t) => t.label.trim() || t.token);
  if (libraryName) names.push(`the Library ${libraryName}`);
  if (!names.length) return '';
  const last = names[names.length - 1] as string;
  const list = names.length === 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
  return `filed in ${list}`;
}
