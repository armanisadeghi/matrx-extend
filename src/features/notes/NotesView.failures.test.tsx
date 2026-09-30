import { useNotesUiStore } from '@/state/notes';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/notes/queries', () => ({ listMyNotes: api.list, createNote: api.create }));

import { NotesView } from './NotesView';

const note = {
  id: '11111111-1111-4111-8111-111111111111',
  created_by: '22222222-2222-4222-8222-222222222222',
  label: 'Harbor Dental intake',
  folder_name: 'Patients',
  folder_id: null,
  tags: [],
  updated_at: '2026-09-28T18:00:00.000Z',
  position: 1,
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NotesView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.list.mockReset();
  api.create.mockReset();
  useNotesUiStore.setState({ selectedNoteId: null, selectedFolder: null, searchQuery: '' });
  useSidepanelTabStore.setState({ tab: 'notes' });
});

afterEach(cleanup);

describe('Notes failure recovery', () => {
  it('shows a failed list read and retries into the returned note', async () => {
    api.list.mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValueOnce([note]);
    mount();

    expect(await screen.findByText(/Could not load notes/i)).toBeTruthy();
    expect(screen.queryByText(/No notes yet/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry loading notes/i }));
    expect(await screen.findByText('Harbor Dental intake')).toBeTruthy();
  });

  it('keeps a successful empty read distinct from a failed read', async () => {
    api.list.mockResolvedValue([]);
    mount();
    expect(await screen.findByText(/No notes yet/i)).toBeTruthy();
    expect(screen.queryByText(/Could not load notes/i)).toBeNull();
  });

});
