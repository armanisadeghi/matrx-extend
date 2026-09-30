/**
 * The capture tray's sentences. The list spans every organization the person can
 * access, so an empty list really is "nothing needs your browser" — no workspace
 * qualifier and no "elsewhere" hedge. Pure functions so the wording is provable by a
 * test instead of a screenshot.
 */

function pages(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}

export interface QueueSentences {
  /** The header line. */
  headline: string;
  /** The one-sentence body shown when the queue is empty; null when there are rows. */
  emptyLine: string | null;
}

export function queueSentences(itemCount: number): QueueSentences {
  return {
    headline:
      itemCount === 0 ? 'Nothing needs your browser' : `${pages(itemCount)} need your browser`,
    emptyLine:
      itemCount === 0
        ? 'Nothing needs your browser. When a page will not open for our servers, it shows up here.'
        : null,
  };
}

/** The capture tab's accessible name and tooltip. */
export function captureTabLabel(count: number): string {
  return count > 0 ? `${pages(count)} need your browser` : 'Pages that need your browser';
}
