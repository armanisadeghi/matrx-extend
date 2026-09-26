/**
 * Release guard (SOURCE-CONVERGENCE §7, Phase 1b): Save with the server
 * unreachable
 *   1. shows the "Not yet a Source" (retry) card,
 *   2. keeps the capture (on this device, in chrome.storage.local, AND open in
 *      the panel),
 *   3. keeps the unsaved-edits guard armed (a Re-capture still asks first),
 * and a retry that lands removes it from the device.
 *
 * Drives the REAL ScrapeView → useScrape → saveCaptureAsSource → landSource
 * path; only the network (`apiPost`) and identity are faked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  saveSeoAudit: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({ apiPost: mocks.apiPost }));
vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: vi.fn(async () => ({ id: '87a6e699-3622-4869-8843-d0867456c0dd' })),
}));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: vi.fn(async () => '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f'),
}));
vi.mock('@/lib/supabase/queries', () => ({ saveSeoAudit: mocks.saveSeoAudit }));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ url: 'https://docs.example.com/guide', title: 'Guide', id: 7 }),
}));
vi.mock('@/hooks/use-page-recognition', () => ({
  usePageRecognition: () => ({ capturedAt: null, capturedId: null, loading: false }),
}));
vi.mock('@/hooks/use-page-scroll-sync', () => ({ usePageScrollSync: () => undefined }));
vi.mock('@/components/AddToProjectButton', () => ({ AddToProjectButton: () => null }));
vi.mock('@/components/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('@/components/CopyMenu', () => ({
  CopyMenu: () => null,
  CopyButton: () => null,
}));
vi.mock('@/features/scrape/DiagnoseCard', () => ({
  DiagnoseCard: () => null,
  DiagnoseLauncher: () => null,
}));
vi.mock('@/features/seo/SeoDetails', () => ({ SeoDetails: () => null }));

import { ScrapeView } from '@/features/scrape/ScrapeView';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { UNSAVED_CAPTURES_KEY, listUnsavedCaptures } from '@/lib/sources/save-capture';
import { useScrapeStore } from '@/state/scrape';

const soup = {
  url: 'https://docs.example.com/guide',
  capturedAt: 1_758_800_000_000,
  metadata: { title: 'Guide', description: 'A guide', lang: 'en' },
  article: {
    title: 'Guide',
    byline: null,
    content_html_safe: '<h1>Guide</h1><p>Intro.</p><h2>Install</h2><p>Run it.</p>',
    content_markdown: '# Guide\n\nIntro.\n\n## Install\n\nRun it.',
    excerpt: null,
    extractor: 'defuddle',
    word_count: 4,
    reading_time_minutes: 1,
  },
  images: [],
  videos: [],
  audio: [],
  links: [],
  ld_json: [],
  seo: { word_count: 4, flesch_reading_ease: 80 },
  raw_html_size: 120,
} as unknown as SoupResult;

// chrome.storage.onChanged that actually fires, as Chrome does in every context.
type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners = new Set<Listener>();

beforeEach(async () => {
  mocks.apiPost.mockReset();
  mocks.saveSeoAudit.mockReset().mockResolvedValue({ id: 'audit-1' });
  await chrome.storage.local.remove(UNSAVED_CAPTURES_KEY);
  listeners.clear();
  const local = chrome.storage.local as unknown as {
    set: (v: Record<string, unknown>) => Promise<void>;
    __origSet?: (v: Record<string, unknown>) => Promise<void>;
  };
  local.__origSet ??= local.set;
  const origSet = local.__origSet;
  local.set = async (values) => {
    await origSet(values);
    const changes = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, { newValue: v }]),
    );
    for (const l of listeners) l(changes, 'local');
  };
  Object.assign(chrome.storage, {
    onChanged: {
      addListener: (l: Listener) => listeners.add(l),
      removeListener: (l: Listener) => listeners.delete(l),
    },
  });
  Object.assign(chrome, {
    tabs: { create: vi.fn(), query: vi.fn(async () => []) },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async () => undefined),
    },
  });
  useScrapeStore.getState().setCurrent(soup);
  // The person edited the article before saving.
  useScrapeStore
    .getState()
    .editArticleMarkdown('# Guide\n\nIntro, edited.\n\n## Install\n\nRun it.');
});

afterEach(cleanup);

describe('Save never loses input', () => {
  it('server unreachable → retry card, capture kept, unsaved-edits guard armed; retry lands', async () => {
    mocks.apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Failed to fetch' });
    render(<ScrapeView />);

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    // 1. The retry card, with the sentence.
    expect(await screen.findByText(/Not yet a Source — kept on this device/)).toBeTruthy();
    expect(screen.getByText(/could not be reached/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Saved/ })).toBeNull();

    // 2. The capture is kept — on the device, with everything the door needs…
    const kept = await listUnsavedCaptures();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toBe(soup.url);
    expect(kept[0]?.prepared.portions.length).toBeGreaterThan(0);
    expect(kept[0]?.prepared.original?.mime_type).toBe('application/json');
    // …and still open in the panel.
    expect(useScrapeStore.getState().current?.url).toBe(soup.url);

    // 3. The unsaved-edits guard stays armed: Re-capture asks before discarding.
    expect(useScrapeStore.getState().edited).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Re-capture/ }));
    expect(await screen.findByText('Discard unsaved edits?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByText('Discard unsaved edits?')).toBeNull());
    expect(useScrapeStore.getState().edited).toBe(true);

    // The request that was attempted is the door's contract…
    const [path, body] = mocks.apiPost.mock.calls[0] as [string, Record<string, unknown>];
    // …carrying the EDITED text (the captured HTML still holds the old words),
    const sent = (body.portions as { text: string }[]).map((p) => p.text).join('\n');
    expect(sent).toContain('Intro, edited.');
    expect(sent).not.toMatch(/Intro\.(?!,)/);
    // …while the original kept in S3 is the untouched capture.
    const original = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob((body.original as { bytes_b64: string }).bytes_b64), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as SoupResult;
    expect(original.article.content_markdown).toBe(soup.article.content_markdown);
    expect(kept[0]?.prepared.portions.map((p) => p.text).join('\n')).toContain('Intro, edited.');
    expect(path).toBe('/sources/land');
    expect(body).toMatchObject({
      source_kind: 'scrape_parsed_page',
      canonical_identity: soup.url,
      keep: true,
      visibility: 'personal',
      organization_id: '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f',
      provenance: { origin_client: 'extension', capture_method: 'own_browser' },
    });

    // A retry that lands removes it from the device.
    mocks.apiPost.mockResolvedValue({
      ok: true,
      data: {
        processed_document_id: '6b8c38dd-6d68-4824-b664-a380b7611627',
        source_id: 'spp-1',
        reused_existing: false,
        kept: true,
        intelligence: 'queued',
        notices: [],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry save/ }));
    await waitFor(() =>
      expect(screen.queryByText(/Not yet a Source — kept on this device/)).toBeNull(),
    );
    expect(await listUnsavedCaptures()).toHaveLength(0);
  });

  it('a refusal from the door is kept too, with the server’s own sentence', async () => {
    mocks.apiPost.mockResolvedValue({
      ok: false,
      status: 422,
      error: JSON.stringify({
        detail: {
          code: 'portion_locator_invalid',
          message: 'Part 1 of this capture is a section but does not say where it is.',
          remedy: 'capture_the_page_again',
          retryable: false,
        },
      }),
    });
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByText(/does not say where it is/)).toBeTruthy();
    expect(await listUnsavedCaptures()).toHaveLength(1);
    expect(useScrapeStore.getState().edited).toBe(true);
  });

  it('a stored unsaved capture is read on mount and survives closing and reopening the panel', async () => {
    // A save that failed in an earlier session of the panel.
    mocks.apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Failed to fetch' });
    const first = render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByText(/Not yet a Source — kept on this device/)).toBeTruthy();
    first.unmount();
    listeners.clear(); // no change event will announce it to the next panel

    // Reopen: a fresh panel with nothing in memory.
    useScrapeStore.getState().setCurrent(null);
    render(<ScrapeView />);
    expect(
      await screen.findByText(/Not yet a Source — kept on this device until the save lands \(1\)/),
    ).toBeTruthy();
    const card = screen.getByRole('alert', { name: 'Captures not yet saved as Sources' });
    expect(card.textContent).toContain(soup.url);
    expect(card.textContent).toContain('Retry save');
    // Mounting did not wipe it.
    await new Promise((r) => setTimeout(r, 50));
    const kept = await listUnsavedCaptures();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toBe(soup.url);
  });

  it('a landed save disarms the guard and links the Source in the web app', async () => {
    mocks.apiPost.mockResolvedValue({
      ok: true,
      data: {
        processed_document_id: '6b8c38dd-6d68-4824-b664-a380b7611627',
        source_id: 'spp-1',
        reused_existing: false,
        kept: true,
        intelligence: 'queued',
        notices: [{ code: 'x', message: 'Heads up from the door.', remedy: '' }],
      },
    });
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByText(/opens in the web app/)).toBeTruthy();
    expect(screen.getByText('Heads up from the door.')).toBeTruthy();
    expect(useScrapeStore.getState().edited).toBe(false);
    expect(await listUnsavedCaptures()).toHaveLength(0);
    const [, body] = mocks.apiPost.mock.calls[0] as [string, { portions: { text: string }[] }];
    expect(body.portions.map((p) => p.text).join('\n')).toContain('Intro, edited.');
  });
});
