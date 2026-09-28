import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, UpdateNotePatch } from '@/lib/notes/types';

const api = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/notes/queries', () => ({
  getNote: api.get,
  listMyNotes: api.list,
  updateNote: api.update,
  softDeleteNote: api.delete,
}));
vi.mock('@/components/MarkdownView', () => ({ MarkdownView: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('./AppendFromPagePanel', () => ({
  AppendFromPagePanel: ({ getCurrentContent, onAppend }: {
    getCurrentContent: () => string;
    onAppend: (content: string) => Promise<void>;
  }) => <button type="button" onClick={() => void onAppend(`${getCurrentContent()}\n\nReferral call completed.`)}>Append from page</button>,
}));

import { useNotesUiStore } from '@/state/notes';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { NotesView } from './NotesView';

// A Harbor Dental coordinator edits intake notes while Supabase writes are slow.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-09-28T18:00:00.000Z';
const initial = new Map<string, Note>([
  [A, { id: A, created_by: A, label: 'Harbor Dental intake', folder_name: 'Patients', folder_id: null,
    tags: [], updated_at: stamp, position: 1, visibility: 'private', content: 'Call new patient.',
    metadata: null, deleted_at: null, version: 1, created_at: stamp }],
  [B, { id: B, created_by: A, label: 'Harbor Dental supplies', folder_name: 'Operations', folder_id: null,
    tags: [], updated_at: stamp, position: 2, visibility: 'private', content: 'Order gloves.',
    metadata: null, deleted_at: null, version: 1, created_at: stamp }],
]);
let stored: Map<string, Note>;
let writes: { id: string; patch: UpdateNotePatch; resolve: () => void }[];

function resolveWrite(index: number) {
  const write = writes[index];
  if (!write) throw new Error(`No pending note write ${index}`);
  write.resolve();
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><NotesView /></QueryClientProvider>);
  return { ...view, client };
}

async function debounce() {
  await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); });
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  stored = new Map(initial);
  writes = [];
  api.get.mockReset().mockImplementation(async (id: string) => stored.get(id) ?? null);
  api.list.mockReset().mockImplementation(async () => [...stored.values()]);
  api.update.mockReset().mockImplementation((id: string, patch: UpdateNotePatch) => new Promise<Note | null>((resolve) => {
    writes.push({ id, patch, resolve: () => {
      const updated = { ...stored.get(id)!, ...patch, updated_at: `2026-09-28T18:00:0${writes.length}.000Z` };
      stored.set(id, updated);
      resolve(updated);
    } });
  }));
  api.delete.mockReset().mockResolvedValue(true);
  useNotesUiStore.setState({ selectedNoteId: A, viewMode: 'edit' });
  useSidepanelTabStore.setState({ tab: 'notes' });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Notes editor autosave', () => {
  it('stores the latest edit after an older write, and only then says Saved', async () => {
    mount();
    const body = await screen.findByDisplayValue('Call new patient.');
    vi.useFakeTimers();
    fireEvent.change(body, { target: { value: 'Call new patient. Confirm coverage.' } });
    await debounce();
    expect(writes).toHaveLength(1);
    fireEvent.change(body, { target: { value: 'Call new patient. Confirm coverage and appointment.' } });
    await debounce();
    expect(screen.queryByText(/^Saved /)).toBeNull();
    resolveWrite(0);
    await settle();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.patch.content).toBe('Call new patient. Confirm coverage and appointment.');
    expect(screen.queryByText(/^Saved /)).toBeNull();
    resolveWrite(1);
    await settle();
    expect(stored.get(A)?.content).toBe('Call new patient. Confirm coverage and appointment.');
    expect(screen.getByText(/^Saved /)).toBeTruthy();
  });

  it('keeps note identities separate when switching during a write', async () => {
    mount();
    const first = await screen.findByDisplayValue('Call new patient.');
    vi.useFakeTimers();
    fireEvent.change(first, { target: { value: 'Call new patient at 9 AM.' } });
    await debounce();
    expect(writes[0]?.id).toBe(A);
    await act(async () => { useNotesUiStore.getState().setSelectedNoteId(B); });
    await settle();
    const second = screen.getByDisplayValue('Order gloves.');
    fireEvent.change(second, { target: { value: 'Order nitrile gloves and masks.' } });
    await debounce();
    expect(writes[1]?.id).toBe(B);
    resolveWrite(0);
    await settle();
    expect(screen.queryByText(/^Saved /)).toBeNull();
    resolveWrite(1);
    await settle();
    expect(stored.get(A)?.content).toBe('Call new patient at 9 AM.');
    expect(stored.get(B)?.content).toBe('Order nitrile gloves and masks.');
  });

  it('serializes Append from page behind an in-flight autosave', async () => {
    mount();
    const body = await screen.findByDisplayValue('Call new patient.');
    vi.useFakeTimers();
    fireEvent.change(body, { target: { value: 'Call new patient at 9 AM.' } });
    await debounce();
    fireEvent.click(screen.getByRole('button', { name: 'Append from page' }));
    resolveWrite(0);
    await settle();
    expect(writes).toHaveLength(2);
    resolveWrite(1);
    await settle();
    expect(stored.get(A)?.content).toBe('Call new patient at 9 AM.\n\nReferral call completed.');
  });

  it('flushes the latest queued draft after editor unmount', async () => {
    const view = mount();
    const body = await screen.findByDisplayValue('Call new patient.');
    vi.useFakeTimers();
    fireEvent.change(body, { target: { value: 'Call new patient at 9 AM.' } });
    await debounce();
    fireEvent.change(body, { target: { value: 'Call new patient at 9 AM and confirm insurance.' } });
    await debounce();
    view.unmount();
    resolveWrite(0);
    await settle();
    expect(writes).toHaveLength(2);
    resolveWrite(1);
    await settle();
    expect(stored.get(A)?.content).toBe('Call new patient at 9 AM and confirm insurance.');
  });
});
