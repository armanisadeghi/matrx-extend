import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  keepSource: vi.fn(),
  pushNotice: vi.fn(),
  libraryRead: vi.fn(),
  libraries: [
    { id: 'lib-2', name: 'Reading list', adapter: 'manual' },
    { id: 'lib-1', name: 'Web clips', adapter: 'web_capture' },
  ],
}));

vi.mock('@/lib/api/routes/sources', () => ({ keepSource: mocks.keepSource }));
vi.mock('@/state/notices', () => ({ pushNotice: mocks.pushNotice }));
vi.mock('@/lib/sources/associations-store', () => ({ getAssociationsStore: () => ({}) }));
vi.mock('@/lib/supabase/schemas', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: async () => {
      mocks.libraryRead();
      return { data: mocks.libraries, error: null };
    },
  };
  return { mediaDb: () => ({ from: () => chain }) };
});
// The registry picker is the package's; here it offers one project to choose.
vi.mock('@ai-matrx/associations/react', () => ({
  AssociationsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  attachedKey: (t: string, id: string) => `${t}:${id}`,
  UniversalAssociationPicker: ({
    onAttach,
    tokens,
    orgId,
  }: {
    onAttach: (t: string, id: string, title: string) => Promise<unknown>;
    tokens: string[];
    orgId: string;
  }) => (
    <button
      type="button"
      data-tokens={tokens.join(',')}
      data-org={orgId}
      onClick={() => void onAttach('project', 'proj-1', 'Launch plan')}
    >
      pick Launch plan
    </button>
  ),
}));

import { useAuthStore } from '@/state/auth';
import { FileSourcePanel } from './FileSourcePanel';

const SOURCE = '6b8c38dd-6d68-4824-b664-a380b7611627';
const ORG = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const USER = '87a6e699-3622-4869-8843-d0867456c0dd';

beforeEach(() => {
  mocks.keepSource.mockReset().mockResolvedValue({
    ok: true,
    landed: {
      processed_document_id: SOURCE,
      source_id: 's',
      reused_existing: true,
      kept: true,
      intelligence: 'queued',
      notices: [],
    },
  });
  mocks.pushNotice.mockReset();
  mocks.libraryRead.mockReset();
  useAuthStore.setState({ user: { id: USER } as never });
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
      removeItem: (k: string) => memory.delete(k),
    },
  });
});
afterEach(cleanup);

describe('FileSourcePanel — optional filing after the save lands', () => {
  it('offers no File button until a place is chosen (nothing dead, nothing blocking)', async () => {
    render(
      <FileSourcePanel processedDocumentId={SOURCE} organizationId={ORG} onClose={() => {}} />,
    );
    expect(mocks.libraryRead).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^File in/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'pick Launch plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a place' }));
    expect(screen.queryByRole('button', { name: 'pick Launch plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    // One type is loaded only after that choice, in the Source's org.
    const picker = screen.getByRole('button', { name: 'pick Launch plan' });
    expect(picker.getAttribute('data-tokens')).toBe('project');
    expect(picker.getAttribute('data-org')).toBe(ORG);
  });

  it('files in a project and a Library through keep/attach_to, bound to the landing org, and names both places', async () => {
    render(
      <FileSourcePanel processedDocumentId={SOURCE} organizationId={ORG} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to Library' }));
    await screen.findByRole('option', { name: 'Web clips' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a place' }));
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick Launch plan' }));
    fireEvent.change(screen.getByLabelText('Library'), { target: { value: 'lib-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'File in 2 places' }));
    await waitFor(() => expect(mocks.keepSource).toHaveBeenCalledTimes(1));
    expect(mocks.keepSource).toHaveBeenCalledWith(
      SOURCE,
      {
        keep: true,
        attach_to: [
          { entity_type: 'project', entity_id: 'proj-1' },
          { entity_type: 'media_source_library', entity_id: 'lib-1', label: 'catalogued_source' },
        ],
      },
      { userId: USER, organizationId: ORG },
    );
    const sentence = 'Filed in Launch plan and the Library Web clips.';
    expect((await screen.findByTestId('file-source-result')).textContent).toContain(sentence);
    expect(mocks.pushNotice).toHaveBeenCalledWith({
      tone: 'info',
      title: 'Source filed',
      message: sentence,
    });
    // The Library is remembered for this person.
    expect(window.localStorage.getItem(`matrx.sources.save-panel.library.${USER}`)).toBe('lib-1');
  });

  it("a refusal is shown in the door's words and as a notice", async () => {
    mocks.keepSource.mockResolvedValue({
      ok: false,
      refusal: { status: 403, code: 'x', message: 'You cannot file into that project.' },
    });
    render(
      <FileSourcePanel processedDocumentId={SOURCE} organizationId={ORG} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose a place' }));
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pick Launch plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'File in 1 place' }));
    expect(await screen.findByText('You cannot file into that project.')).toBeTruthy();
    expect(mocks.pushNotice).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: 'You cannot file into that project.' }),
    );
  });
});
