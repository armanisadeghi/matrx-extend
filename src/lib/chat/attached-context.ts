/**
 * What the person attached to the composer that rides every send as a context key: the highlights
 * from the Highlight tab and the Google Docs / Sheets from the Files chip. ONE place, read by the
 * extension's own send path (`use-chat-stream`), its context-rules chip, and the package chat's
 * attachment sources (`features/package-chat/attachment-sources`).
 */

import type { AttachedHighlight } from '@/lib/chat/context/types';
import { getHighlightsByIds } from '@/lib/highlights/queries';
import { useGoogleFilesStore } from '@/state/google-files';
import { useHighlightStore } from '@/state/highlights';

/**
 * Materialize the highlights the user attached via the Highlight tab into the
 * compact shape the `highlights` context key expects. Returns null when the
 * tray is empty so the context builder omits the key entirely.
 */
export async function resolveAttachedHighlights(): Promise<AttachedHighlight[] | null> {
  const ids = useHighlightStore.getState().attachedIds;
  if (ids.length === 0) return null;
  const rows = await getHighlightsByIds(ids);
  if (rows.length === 0) return null;
  return rows.map((h) => ({
    id: h.id,
    mode: h.mode,
    text: h.text,
    url: h.url,
    ref: {
      ...(h.anchor.selector !== undefined ? { selector: h.anchor.selector } : {}),
      ...(h.anchor.ref !== undefined ? { ref: h.anchor.ref } : {}),
      ...(h.anchor.text_quote !== undefined
        ? {
            text_quote: {
              exact: h.anchor.text_quote.exact,
              ...(h.anchor.text_quote.prefix !== undefined
                ? { prefix: h.anchor.text_quote.prefix }
                : {}),
              ...(h.anchor.text_quote.suffix !== undefined
                ? { suffix: h.anchor.text_quote.suffix }
                : {}),
            },
          }
        : {}),
      ...(h.anchor.role !== undefined ? { role: h.anchor.role } : {}),
      ...(h.anchor.tag !== undefined ? { tag: h.anchor.tag } : {}),
    },
  }));
}

/**
 * The Google Drive file ids the user attached via the composer's Files chip.
 * Returns null when the tray is empty so the context builder omits the
 * reserved `__google_files` key entirely. Read from the store rather than
 * re-queried: the chip refreshes the registry every time it opens, and the
 * server drops any id that is no longer a registered resource.
 */
export function resolveAttachedGoogleFileIds(): string[] | null {
  const ids = useGoogleFilesStore.getState().attachedIds;
  return ids.length > 0 ? ids : null;
}

/** The `highlights` context value for a set of attached highlights (one bundled key). */
export function highlightsContextValue(items: AttachedHighlight[]): { count: number; items: AttachedHighlight[] } {
  return { count: items.length, items };
}
