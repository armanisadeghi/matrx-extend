import type { Note } from '@/lib/notes/types';
import { useNotesUiStore } from '@/state/notes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

beforeEach(() => {
  api.get.mockReset();
  api.update.mockReset();
  api.delete.mockReset();
  useNotesUiStore.setState({ selectedNoteId: noteId, viewMode: 'edit' });
});
afterEach(cleanup);

describe('Notes detail recovery', () => {
  it('shows a failed detail read and retries into the note editor', async () => {
    api.get.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(note);
    mount();
    expect(await screen.findByText('Could not load this note.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Start writing… or use Append from page to capture content.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading note' }));
    expect(await screen.findByDisplayValue('Call new patient.')).toBeTruthy();
  });

  it('shows a missing note with Back and retry instead of loading forever', async () => {
    api.get.mockResolvedValue(null);
    mount();
    expect(await screen.findByText('This note is unavailable.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry loading note' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(useNotesUiStore.getState().selectedNoteId).toBeNull();
  });

  it('keeps an open draft available when a background detail refresh fails', async () => {
    api.get.mockResolvedValueOnce(note).mockRejectedValueOnce(new Error('Network unavailable'));
    const client = mount();
    const body = await screen.findByDisplayValue('Call new patient.');
    fireEvent.change(body, { target: { value: 'Call new patient and confirm insurance.' } });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['notes', 'detail', noteId] });
    });
    expect(await screen.findByText(/Could not refresh this note/i)).toBeTruthy();
    expect(screen.getByDisplayValue('Call new patient and confirm insurance.')).toBeTruthy();
  });
});
