/**
 * THE DISPATCH TABLE — the one place a component key becomes a component in
 * this client, and the ONLY thing about kind rendering this repo decides.
 *
 * ## Explicit registration, never a silent fallback
 *
 * A kind draws through a real component here for exactly one reason: a
 * `content_ir.kind_component` row with `platform='chrome-extension'` names a
 * key that appears in `KIND_COMPONENTS` below. Two halves, both explicit —
 * the DB says "this kind has a component on this client", the map says "and
 * here it is". Neither half alone renders anything.
 *
 * Everything else lands on the generic structured floor, which SAYS SO. That
 * is the honest disposition (ruling R6), not a shrug: the reader sees their
 * data as a document, and the muted footer records that no custom view exists
 * yet. A kind must never quietly borrow another kind's component.
 *
 * ## Why the keys are not the web app's keys
 *
 * `kind_component.platform` exists precisely so a side panel and a 1200px web
 * page can draw the same kind differently. A `web` row naming `flashcards`
 * points at a Next.js component this repo does not have; these rows name
 * `flashcard_set_panel` and friends. Same kind, same envelope, same route —
 * a component sized for where it renders.
 */

import type { ComponentType } from 'react';
import { MarkdownKind } from './MarkdownKind';
import { SearchResultsKind } from './SearchResultsKind';
import { FlashcardSetKind } from './FlashcardSetKind';
import { QuizSetKind } from './QuizSetKind';
import type { KindComponentProps } from './types';

export const KIND_COMPONENTS: Record<string, ComponentType<KindComponentProps>> = {
  markdown_panel: MarkdownKind,
  search_results_panel: SearchResultsKind,
  flashcard_set_panel: FlashcardSetKind,
  quiz_set_panel: QuizSetKind,
};

export function lookupKindComponent(
  componentKey: string,
): ComponentType<KindComponentProps> | null {
  return KIND_COMPONENTS[componentKey] ?? null;
}
