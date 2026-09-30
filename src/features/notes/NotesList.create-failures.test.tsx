import { useNotesUiStore } from '@/state/notes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/notes/queries', () => ({ createNote: api.create }));

import { NotesList } from './NotesList';

const createdNote = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Harbor Dental intake',
};

beforeEach(() => {
  api.create.mockReset();
  useNotesUiStore.setState({ selectedNoteId: null, selectedFolder: null, searchQuery: '' });
});

afterEach(cleanup);

describe('Notes creation failure', () => {
  it('reports failed creation and retries without selecting a nonexistent note', async () => {
    api.create.mockResolvedValueOnce(null).mockResolvedValueOnce(createdNote);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NotesList notes={[]} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /New note/i }));
    expect(await screen.findByText(/Could not confirm note creation/i)).toBeTruthy();
    expect(screen.getByText(/Refresh your notes before retrying/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh notes/i })).toBeTruthy();
    expect(useNotesUiStore.getState().selectedNoteId).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry creating note/i }));
    await waitFor(() => expect(useNotesUiStore.getState().selectedNoteId).toBe(createdNote.id));
    expect(api.create).toHaveBeenCalledTimes(2);
  });
});
