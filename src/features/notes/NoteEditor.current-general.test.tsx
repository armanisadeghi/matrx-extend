import { NoteEditor } from '@/features/notes/NoteEditor';
import type { Note } from '@/lib/notes/types';
import { useNotesUiStore } from '@/state/notes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/supabase/schemas', () => ({
  platformDb: () => ({ rpc: db.rpc }),
  workbenchDb: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: db.read }) }) }),
  }),
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ schema: () => ({ rpc: db.rpc }) }),
}));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));
vi.mock('@/components/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('./AppendFromPagePanel', () => ({ AppendFromPagePanel: () => null }));

const currentScope = '11111111-1111-4111-8111-111111111111';
const otherScope = '22222222-2222-4222-8222-222222222222';
const currentOrg = '44444444-4444-4444-8444-444444444444';
const otherOrg = '55555555-5555-4555-8555-555555555555';
// A legal practice reviews an intake note in its renamed General, then either
// leaves its home selected or explicitly moves the note to another practice.
const note = {
  id: '66666666-6666-4666-8666-666666666666',
  created_by: null,
  label: 'Intake checklist',
  content: 'Confirm signed engagement letter.',
  home_scope_id: currentScope,
  tags: [],
  updated_at: '2026-10-11T12:00:00Z',
  position: null,
  metadata: null,
  deleted_at: null,
  version: 1,
  created_at: '2026-10-11T12:00:00Z',
} satisfies Note;

beforeEach(() => {
  vi.clearAllMocks();
  useNotesUiStore.setState({ selectedNoteId: note.id, viewMode: 'edit' });
  db.read.mockResolvedValue({ data: note, error: null });
  db.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'my_homes'
        ? [
            {
              scope_id: currentScope,
              organization_id: currentOrg,
              organization_name: 'Law Firm',
              name: 'Intake',
              is_general: true,
            },
            {
              scope_id: otherScope,
              organization_id: otherOrg,
              organization_name: 'Legal Clinic',
              name: 'Intake',
              is_general: true,
            },
          ]
        : {},
    error: null,
  }));
});
afterEach(cleanup);

it.each([
  { label: 'Intake · Law Firm', destination: null },
  { label: 'Intake · Legal Clinic', destination: otherScope },
])(
  'emits a home write only when the selected General changes: $label',
  async ({ label, destination }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NoteEditor noteId={note.id} />
      </QueryClientProvider>,
    );
    await screen.findByDisplayValue('Confirm signed engagement letter.');
    fireEvent.click(await screen.findByRole('button', { name: 'Intake · Law Firm' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: label, pressed: destination === null }));
    });
    const writes = db.rpc.mock.calls.filter(
      ([name]) => name === 'ensure_general_scope' || name === 'set_home',
    );
    expect(writes).toEqual(
      destination
        ? [['set_home', { p_entity_type: 'note', p_entity_id: note.id, p_scope_id: destination }]]
        : [],
    );
    client.clear();
  },
);
