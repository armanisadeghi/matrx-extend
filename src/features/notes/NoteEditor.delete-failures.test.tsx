import type { Note } from '@/lib/notes/types';
import { useNotesUiStore } from '@/state/notes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/notes/queries', () => ({
  getNote: api.get,
  updateNote: api.update,
  softDeleteNote: api.delete,
}));
vi.mock('@/components/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('./AppendFromPagePanel', () => ({ AppendFromPagePanel: () => null }));

import { NoteEditor } from './NoteEditor';

const noteId = '11111111-1111-4111-8111-111111111111';
const note: Note = {
  id: noteId,
  created_by: '22222222-2222-4222-8222-222222222222',
  label: 'Harbor Dental intake',
  folder_name: 'Patients',
  folder_id: null,
  tags: [],
  updated_at: '2026-09-28T18:00:00.000Z',
  position: 1,
  content: 'Call new patient.',
  metadata: null,
  deleted_at: null,
  version: 1,
  created_at: '2026-09-28T18:00:00.000Z',
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NoteEditor noteId={noteId} />
    </QueryClientProvider>,
  );
  return client;
}

async function confirmDelete() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }));
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(note);
  api.update.mockReset();
  api.delete.mockReset();
  useNotesUiStore.setState({ selectedNoteId: noteId, viewMode: 'edit' });
});
afterEach(cleanup);

describe('Notes deletion failure', () => {
  it('keeps the editor open on an unconfirmed delete and retries after another confirmation', async () => {
    api.delete.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mount();
    expect(await screen.findByDisplayValue('Call new patient.')).toBeTruthy();
    await confirmDelete();
    expect(await screen.findByText(/Could not confirm deletion/i)).toBeTruthy();
    expect(useNotesUiStore.getState().selectedNoteId).toBe(noteId);
    expect(screen.getByDisplayValue('Call new patient.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }));
    await waitFor(() => expect(useNotesUiStore.getState().selectedNoteId).toBeNull());
    expect(api.delete).toHaveBeenCalledTimes(2);
  });

  it('makes a thrown delete error visible without discarding the editor', async () => {
    api.delete.mockRejectedValue(new Error('Network unavailable'));
    mount();
    expect(await screen.findByDisplayValue('Call new patient.')).toBeTruthy();
    await confirmDelete();
    expect(await screen.findByText(/Could not confirm deletion/i)).toBeTruthy();
    expect(useNotesUiStore.getState().selectedNoteId).toBe(noteId);
  });
});
