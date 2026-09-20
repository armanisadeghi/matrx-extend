import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  setDeleted: vi.fn(),
  setTab: vi.fn(),
}));

vi.mock('@/lib/supabase/queries', () => ({
  listSavedCaptures: mocks.list,
  getSavedCapture: mocks.get,
  updateSavedCapture: mocks.update,
  setSavedCaptureDeleted: mocks.setDeleted,
}));
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
  media_count: 2,
  deleted_at: null,
  version: 3,
};

const secondSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  url: 'https://news.example.net/beta',
  captured_at: '2026-09-19T08:30:00.000Z',
  updated_at: '2026-09-19T08:30:00.000Z',
  title: 'Beta report',
  description: null,
  media_count: 0,
  deleted_at: null,
  version: 1,
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
  lang: 'en',
  soup,
  markdown: '# Original alpha',
  metadata: soup.metadata,
  ld_json: [],
  pattern_id: null,
  created_at: firstSummary.captured_at,
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([firstSummary, secondSummary]);
  mocks.get.mockReset().mockResolvedValue(fullCapture);
  mocks.update.mockReset().mockImplementation(async (input) => ({
    ...fullCapture,
    title: input.title,
    description: input.description,
    markdown: input.markdown,
    soup: input.soup,
    version: 4,
  }));
  mocks.setDeleted.mockReset().mockResolvedValue(undefined);
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

    fireEvent.change(screen.getByPlaceholderText('Search title, URL, or description'), {
      target: { value: 'later match' },
    });
    expect(await screen.findByText('Beta report')).toBeTruthy();
    expect(mocks.list).toHaveBeenLastCalledWith({ limit: 40, search: 'later match' });
  });

  it('opens a persisted capture, edits its article, and updates the exact versioned row', async () => {
    render(<SavedCapturesView />);
    fireEvent.click(await screen.findByText('Alpha guide'));

    expect(await screen.findByText('# Original alpha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Alpha handbook' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Updated field notes' },
    });
    fireEvent.change(screen.getByLabelText('Article markdown'), {
      target: { value: '# Revised alpha\n\nComplete text.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: firstSummary.id,
          expectedVersion: 3,
          title: 'Alpha handbook',
          description: 'Updated field notes',
          markdown: '# Revised alpha\n\nComplete text.',
        }),
      ),
    );
    const updateInput = mocks.update.mock.calls[0]?.[0];
    expect(updateInput).toBeTruthy();
    expect(updateInput?.soup.article.content_markdown).toBe('# Revised alpha\n\nComplete text.');
    expect(updateInput?.soup.article.word_count).toBe(5);
    expect(updateInput?.soup.article.reading_time_minutes).toBe(1);
    expect(updateInput?.soup.seo.word_count).toBe(5);
    expect(updateInput?.metadata).toEqual({
      title: 'Alpha handbook',
      description: 'Updated field notes',
    });
    expect(await screen.findByText('Alpha handbook')).toBeTruthy();
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
    expect(mocks.setDeleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mocks.setDeleted).toHaveBeenCalledWith(firstSummary.id, true));
    expect(screen.queryByText('Alpha guide')).toBeNull();
    expect(screen.getByText('Beta report')).toBeTruthy();
  });
});
