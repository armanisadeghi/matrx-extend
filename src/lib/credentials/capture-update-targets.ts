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
  return existing.filter((item) =>
    [item.display_name, item.username ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}
