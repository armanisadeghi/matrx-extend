/**
 * Pure helpers for the Notes tab.
 *
 * `appendToContent` is the safety choke point for every page-extraction
 * insert: it never modifies, parses, or overwrites the existing content. It
 * only ever appends a separator + the new block. The invariant is:
 *
 *   appendToContent(existing, block).startsWith(existing.replace(/\s+$/, ''))
 *
 * If you need to add a new "insert from page" action, route it through this
 * function. Don't write directly to `content`.
 */

import type { NoteListItem } from '@/lib/notes/types';
// THE package formatters (`@ai-matrx/kit/format`, duplication census H1
// 2026-09-07): the fleet had ~35 duration, ~18 relative-time and ~20 byte-size
// twins with no correct owner until kit became one.
import { formatRelativeTime as kitFormatRelativeTime } from '@ai-matrx/kit/format';

export interface NoteFilter {
  search?: string;
  folder_name?: string | null;
}

export function filterNotes<T extends NoteListItem>(notes: T[], filter: NoteFilter): T[] {
  const q = (filter.search ?? '').trim().toLowerCase();
  const folder = filter.folder_name ?? null;
  return notes.filter((n) => {
    if (folder !== null && (n.folder_name ?? null) !== folder) return false;
    if (!q) return true;
    return n.label.toLowerCase().includes(q);
  });
}

export function uniqueFolderNames<T extends Pick<NoteListItem, 'folder_name'>>(
  notes: T[],
): string[] {
  const set = new Set<string>();
  for (const n of notes) {
    if (n.folder_name && n.folder_name.trim().length > 0) set.add(n.folder_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function groupNotesByFolder<T extends NoteListItem>(notes: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const n of notes) {
    const key = n.folder_name ?? '(uncategorized)';
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }
  return groups;
}

/**
 * Returns a label that doesn't collide with any existing note's label.
 * If `base` is unique, returns it as-is; otherwise appends " (2)", " (3)", …
 */
export function generateUniqueLabel<T extends Pick<NoteListItem, 'label'>>(
  notes: T[],
  base: string,
): string {
  const labels = new Set(notes.map((n) => n.label));
  if (!labels.has(base)) return base;
  let i = 2;
  while (labels.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

/**
 * Append-only insert. Trims trailing whitespace on the existing content,
 * separates with a blank line, then appends the trimmed block plus a
 * single trailing newline. Empty/null `existing` returns just the block.
 */
export function appendToContent(existing: string | null | undefined, block: string): string {
  const base = (existing ?? '').replace(/\s+$/, '');
  const sep = base.length === 0 ? '' : '\n\n';
  return `${base}${sep}${block.trim()}\n`;
}

/**
 * "2m ago" / "5d ago", a blank when there is no timestamp at all. THE package
 * formatter (census H1); a missing note stamp shows NOTHING here rather than an
 * em-dash, which is why the fallback is bound.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  return kitFormatRelativeTime(iso, { fallback: '' });
}
