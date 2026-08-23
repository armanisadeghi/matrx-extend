/**
 * `flashcard_set` — the study deck, sized for a side panel.
 *
 * Cards flip on click rather than showing front and back at once: a 400px
 * column cannot show both without turning a study aid into a wall of text, and
 * the whole point of a flashcard is that the back is hidden first.
 *
 * The three card `$defs` (flashcard / enhanced_flashcard / tiered_flashcard)
 * differ only in optional fields, so `front` + `back` is read structurally and
 * everything else is left alone.
 */

import { useState } from 'react';
import type { KindComponentProps } from './types';

interface Card {
  front: string;
  back: string;
}

function readSet(value: unknown): { title: string; cards: Card[] } {
  if (typeof value !== 'object' || value === null) return { title: '', cards: [] };
  const root = value as Record<string, unknown>;
  const rawTitle = root.title ?? root.set_title;
  const list = Array.isArray(root.cards) ? root.cards : [];

  const cards: Card[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const card = entry as Record<string, unknown>;
    const front = typeof card.front === 'string' ? card.front : '';
    // `back` is explicitly nullable in the schema — a card mid-stream may have
    // a front and no back yet, and it still deserves to render.
    const back = typeof card.back === 'string' ? card.back : '';
    if (!front) continue;
    cards.push({ front, back });
  }

  return { title: typeof rawTitle === 'string' ? rawTitle : '', cards };
}

function FlashcardRow({ card }: { card: Card }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="w-full px-3 py-2 text-left transition-colors hover:bg-secondary/50"
        aria-expanded={revealed}
      >
        <span className="block text-[12px] font-medium">{card.front}</span>
        {revealed ? (
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
            {card.back || 'No answer on this card yet.'}
          </span>
        ) : (
          <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
            Show answer
          </span>
        )}
      </button>
    </li>
  );
}

export function FlashcardSetKind({ value, complete }: KindComponentProps) {
  const { title, cards } = readSet(value);

  if (cards.length === 0) {
    return (
      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[12px] text-muted-foreground">
        {complete ? 'This deck has no cards.' : 'Building the deck…'}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-[12px] font-medium">{title || 'Flashcards'}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {cards.length}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {cards.map((card, i) => (
          <FlashcardRow key={`${card.front}-${i}`} card={card} />
        ))}
      </ul>
    </div>
  );
}
