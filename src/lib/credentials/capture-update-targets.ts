import type { CaptureExistingLogin } from './capture-types';

/**
 * Filters only the metadata fields the capture chooser is allowed to render.
 * IDs remain untouched: selecting an entry must always name the server-approved target.
 */
export function filterCaptureUpdateTargets(
  existing: readonly CaptureExistingLogin[],
  query: string,
): CaptureExistingLogin[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...existing];
  return existing.filter((item) => item.display_name.toLocaleLowerCase().includes(normalized));
}

/** Adds the shortest stable ID suffix needed to distinguish duplicate visible names. */
export function captureUpdateTargetLabel(
  target: CaptureExistingLogin,
  allTargets: readonly CaptureExistingLogin[],
): { primary: string; secondary: string | null } {
  const sameName = allTargets.filter((item) => item.display_name === target.display_name);
  if (sameName.length < 2) return { primary: target.display_name, secondary: null };

  const ids = sameName.map((item) => item.item_id);
  for (let length = 1; length <= target.item_id.length; length++) {
    const prefix = target.item_id.slice(0, length);
    if (ids.filter((id) => id.slice(0, length) === prefix).length === 1)
      return { primary: target.display_name, secondary: `ID ${prefix}` };
  }
  return { primary: target.display_name, secondary: `ID ${target.item_id}` };
}
