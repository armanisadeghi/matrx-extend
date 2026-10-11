import { describe, expect, it } from 'vitest';
import type { NoteListItem } from './types';
import { filterNotes, homeLabelFor, searchHomes } from './utils';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const note = (id: string, home: string, label: string): NoteListItem => ({
  id,
  created_by: null,
  label,
  home_scope_id: home,
  tags: null,
  updated_at: '2026-10-10T00:00:00Z',
  position: null,
});

describe('notes homes', () => {
  it('filters the list by home id, not by a folder name', () => {
    const notes = [note('n1', A, 'Plan'), note('n2', B, 'Memo')];
    expect(filterNotes(notes, { home_scope_id: B }).map((n) => n.id)).toEqual(['n2']);
    expect(filterNotes(notes, {}).length).toBe(2);
  });

  it('labels a note with its home and searches homes by label', () => {
    const homes = [
      { id: A, label: 'General · AI Matrx' },
      { id: B, label: 'ABC Legal' },
    ];
    expect(homeLabelFor(homes, A)).toBe('General · AI Matrx');
    expect(homeLabelFor(homes, null)).toBeNull();
    expect(searchHomes(homes, 'legal').map((h) => h.id)).toEqual([B]);
    expect(searchHomes(homes, '').length).toBe(2);
  });
});
