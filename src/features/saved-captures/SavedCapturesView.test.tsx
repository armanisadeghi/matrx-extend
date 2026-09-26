import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  edit: vi.fn(),
  del: vi.fn(),
  readOriginal: vi.fn(),
  setTab: vi.fn(),
}));

vi.mock('@/lib/supabase/queries', () => ({
  listSavedCaptures: mocks.list,
  getSavedCapture: mocks.get,
  deleteSavedCapture: mocks.del,
}));
vi.mock('@/lib/api/routes/sources', () => ({ editSource: mocks.edit }));
vi.mock('@/lib/sources/read-original', () => ({ readCaptureOriginal: mocks.readOriginal }));
vi.mock('@/state/sidepanel-tab', () => ({
  useSidepanelTabStore: (selector: (state: { setTab: typeof mocks.setTab }) => unknown) =>
    selector({ setTab: mocks.setTab }),
}));
vi.mock('@/components/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('@/components/CopyMenu', () => ({ CopyMenu: () => <button type="button">Copy</button> }));

import { SavedCapturesView } from './SavedCapturesView';

const firstSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'https://docs.example.com/alpha',
  captured_at: '2026-09-20T12:00:00.000Z',
  updated_at: '2026-09-20T12:00:00.000Z',
  title: 'Alpha guide',
  description: 'The first saved guide',
  kept_at: '2026-09-20T12:00:00.000Z',
};

const secondSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  url: 'https://news.example.net/beta',
  captured_at: '2026-09-19T08:30:00.000Z',
  updated_at: '2026-09-19T08:30:00.000Z',
  title: 'Beta report',
  description: null,
  kept_at: null,
};

const soup = {
  url: firstSummary.url,
  capturedAt: 1_758_369_600_000,
  metadata: { title: firstSummary.title, description: firstSummary.description },
  article: {
    title: firstSummary.title,
    byline: null,
    content_html_safe: null,
    content_markdown: '# Original alpha',
    excerpt: null,
    extractor: 'readability',
    word_count: 2,
    reading_time_minutes: 1,
  },
  images: [{ src: 'https://docs.example.com/hero.png', alt: 'Hero', width: 100, height: 80 }],
  videos: [],
  audio: [],
  links: [{ href: 'https://docs.example.com/next', text: 'Next', rel: null }],
  ld_json: [],
  seo: { word_count: 2 },
  raw_html_size: 321,
};

const fullCapture = {
  ...firstSummary,
  structured: {
    images: soup.images,
    videos: [],
    audio: [],
    links: soup.links,
    ld_json: [],
    metadata: soup.metadata,
    pattern_id: null,
  },
  content: 'Original alpha',
  edited_content: null,
  original_file_id: '99999999-9999-4999-8999-999999999999',
  visibility: 'personal',
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([firstSummary, secondSummary]);
  mocks.get.mockReset().mockResolvedValue(fullCapture);
  mocks.readOriginal.mockReset().mockResolvedValue(soup);
  mocks.edit.mockReset().mockResolvedValue({
    ok: true,
    landed: {
      processed_document_id: '55555555-5555-4555-8555-555555555555',
      source_id: 'spp',
      reused_existing: false,
      kept: true,
      intelligence: 'deferred',
      notices: [
        {
          code: 'edit_kept_beside_original',
          message:
            'Your edit was saved as the version people read; the original capture is kept unchanged.',
          remedy: '',
        },
      ],
    },
  });
  mocks.del.mockReset().mockResolvedValue(undefined);
  mocks.setTab.mockReset();
  Object.assign(chrome, { tabs: { create: vi.fn() } });
});

afterEach(cleanup);

describe('SavedCapturesView', () => {
  it('searches the complete saved-capture collection on the server', async () => {
    mocks.list.mockImplementation(async ({ search }: { search?: string }) =>
      search === 'later match'
        ? [secondSummary]
        : Array.from({ length: 40 }, (_, index) => ({
            ...firstSummary,
            id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
            title: `Alpha guide ${index + 1}`,
          })),
    );
    render(<SavedCapturesView />);

    expect(await screen.findByText('Alpha guide 1')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search title or URL'), {
      target: { value: 'later match' },
    });
    expect(await screen.findByText('Beta report')).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 40, search: 'later match' });
  });

  it('opens a Source, reads its original from S3, and saves an edit through the door', async () => {
    render(<SavedCapturesView />);
    fireEvent.click(await screen.findByText('Alpha guide'));

    expect(await screen.findByText('# Original alpha')).toBeTruthy();
    expect(mocks.readOriginal).toHaveBeenCalledWith(fullCapture.original_file_id);
    mocks.get.mockResolvedValueOnce({
      ...fullCapture,
      edited_content: '# Revised alpha\n\nComplete text.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Article text'), {
      target: { value: '# Revised alpha\n\nComplete text.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.edit).toHaveBeenCalled());
    const [id, portions] = mocks.edit.mock.calls[0] as [
      string,
      { locator: unknown; text: string }[],
    ];
    expect(id).toBe(firstSummary.id);
    expect(portions).toEqual([
      {
        ordinal: 1,
        kind: 'section',
        text: '# Revised alpha\n\nComplete text.',
        locator: {
          heading_path: ['Revised alpha'],
          text_fragment: '# Revised alpha Complete text.',
        },
        method: 'native',
      },
    ]);
    expect(
      await screen.findByText(
        'Your edit was saved as the version people read; the original capture is kept unchanged.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Showing your edited version. The original capture is kept unchanged.'),
    ).toBeTruthy();
    expect(screen.getByText('# Revised alpha Complete text.')).toBeTruthy();
  });

  it('shows the door refusal sentence when an edit is refused', async () => {
    mocks.edit.mockResolvedValueOnce({
      ok: false,
      refusal: {
        status: 403,
        code: 'x',
        message: 'You cannot edit this Source.',
        remedy: '',
        retryable: false,
      },
    });
    render(<SavedCapturesView />);
    fireEvent.click(await screen.findByText('Alpha guide'));
    await screen.findByText('# Original alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('You cannot edit this Source.')).toBeTruthy();
  });

  it('shows a load failure without also claiming the library is empty', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Saved captures are unavailable.'));
    render(<SavedCapturesView />);

    expect(await screen.findByText('Saved captures are unavailable.')).toBeTruthy();
    expect(screen.queryByText('No saved captures yet')).toBeNull();
  });

  it('soft-deletes a capture only after the consequence dialog is confirmed', async () => {
    render(<SavedCapturesView />);
    expect(await screen.findByText('Alpha guide')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha guide' }));
    expect(mocks.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(firstSummary.id));
    expect(screen.queryByText('Alpha guide')).toBeNull();
    expect(screen.getByText('Beta report')).toBeTruthy();
  });
});
