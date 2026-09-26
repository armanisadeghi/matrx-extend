import { STORAGE_KEYS } from '@/config/env';
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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  saveSeoAudit: vi.fn(),
  organizationId: '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f',
}));

vi.mock('@/lib/api/client', () => ({ apiPost: mocks.apiPost }));
vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: vi.fn(async () => ({ id: '87a6e699-3622-4869-8843-d0867456c0dd' })),
}));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: vi.fn(async () => mocks.organizationId),
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
import {
  UNSAVED_CAPTURES_KEY,
  discardUnsavedCapture,
  listUnsavedCaptures,
  retryUnsavedCapture,
  saveCaptureAsSource,
} from '@/lib/sources/save-capture';
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
  mocks.organizationId = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
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
  await chrome.storage.local.set({
    [STORAGE_KEYS.ACTIVE_ORGANIZATION]: { id: mocks.organizationId, name: 'Harbor Dental' },
  });
  useScrapeStore.getState().setCurrent(soup);
  // The person edited the article before saving.
  useScrapeStore
    .getState()
    .editArticleMarkdown('# Guide\n\nIntro, edited.\n\n## Install\n\nRun it.');
});

afterEach(cleanup);

const landedResponse = {
  ok: true,
  data: {
    processed_document_id: '6b8c38dd-6d68-4824-b664-a380b7611627',
    source_id: 'spp-1',
    reused_existing: false,
    kept: true,
    intelligence: 'queued',
    notices: [],
  },
};

const OTHER_ORGANIZATION_ID = '8e530f1e-a236-4bca-8131-f15327796301';

async function switchWorkspace(organizationId: string) {
  mocks.organizationId = organizationId;
  await act(async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.ACTIVE_ORGANIZATION]: { id: organizationId, name: 'New workspace' },
    });
  });
}

function deferredApiResponse() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Save never loses input', () => {
  it('server unreachable → retry card, capture kept, unsaved-edits guard armed; retry lands', async () => {
    mocks.apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Failed to fetch' });
    render(<ScrapeView />);

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    // 1. The retry card, with the sentence.
    expect(await screen.findByText(/Not yet a Source — kept on this device/)).toBeTruthy();
    expect(screen.getByText(/could not be reached/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Saved/ })).toBeNull();
    // One control per state: while the card holds this page, its Retry is the
    // only save action — the main Save steps aside.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull());
    expect(screen.getAllByRole('button', { name: /Retry save/ })).toHaveLength(1);

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
      visibility: 'internal',
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

  it('re-saving a page already waiting replaces its entry — one per canonical URL, never two', async () => {
    mocks.apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Failed to fetch' });
    const first = await saveCaptureAsSource(useScrapeStore.getState().current as SoupResult);
    const again = await saveCaptureAsSource({ ...soup, url: `${soup.url}#section` } as SoupResult);
    const kept = await listUnsavedCaptures();
    expect(kept).toHaveLength(1);
    expect(first.status === 'unsaved' && again.status === 'unsaved').toBe(true);
    if (first.status === 'unsaved' && again.status === 'unsaved') {
      expect(again.unsaved.id).toBe(first.unsaved.id);
    }
    expect(kept[0]?.attempts).toBe(2);
    // The newest content wins (the second save carried the un-edited article).
    expect(kept[0]?.prepared.portions.map((p) => p.text).join('\n')).not.toContain(
      'Intro, edited.',
    );

    // A save of that page that lands clears it from the queue.
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
    expect((await saveCaptureAsSource(soup)).status).toBe('landed');
    expect(await listUnsavedCaptures()).toHaveLength(0);
  });

  it("Retry for the open page sends the panel's CURRENT capture — edits after the failed save included", async () => {
    mocks.apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Failed to fetch' });
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByText(/Not yet a Source — kept on this device/)).toBeTruthy();
    // The person keeps editing after the save failed (a real edit renders
    // before the next click, hence act).
    act(() =>
      useScrapeStore
        .getState()
        .editArticleMarkdown('# Guide\n\nIntro, edited twice.\n\n## Install\n\nRun it.'),
    );
    mocks.apiPost.mockResolvedValue(landedResponse);
    fireEvent.click(screen.getByRole('button', { name: /Retry save/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    const body = mocks.apiPost.mock.calls[1]?.[1] as { portions: { text: string }[] };
    expect(body.portions.map((p) => p.text).join('\n')).toContain('Intro, edited twice.');
    await waitFor(async () => expect(await listUnsavedCaptures()).toHaveLength(0));
  });

  it('Retry for a page NOT open in the panel sends its queued content', async () => {
    mocks.apiPost.mockResolvedValue({ ok: false, status: 0, error: 'Failed to fetch' });
    const other = {
      ...soup,
      url: 'https://elsewhere.example.com/page',
      article: {
        ...soup.article,
        content_markdown: '# Elsewhere\n\nQueued words.',
        content_html_safe: '<h1>Elsewhere</h1><p>Queued words.</p>',
      },
    } as SoupResult;
    await saveCaptureAsSource(other);
    render(<ScrapeView />);
    mocks.apiPost.mockResolvedValue(landedResponse);
    fireEvent.click(await screen.findByRole('button', { name: /Retry save/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    const body = mocks.apiPost.mock.calls[1]?.[1] as {
      portions: { text: string }[];
      canonical_identity: string;
    };
    expect(body.canonical_identity).toBe(other.url);
    expect(body.portions.map((p) => p.text).join('\n')).toContain('Queued words.');
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
    await waitFor(async () => expect(await listUnsavedCaptures()).toHaveLength(1));
    expect((await listUnsavedCaptures())[0]?.lastRefusal.message).toContain(
      'does not say where it is',
    );
    expect(await screen.findByText(/does not say where it is/)).toBeTruthy();
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

  it('switching workspaces clears the local Saved button and Source link without dropping the capture', async () => {
    mocks.apiPost.mockResolvedValue(landedResponse);
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByRole('button', { name: /^Saved$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open this Source/ })).toBeTruthy();

    await switchWorkspace(OTHER_ORGANIZATION_ID);

    expect(screen.queryByRole('button', { name: /^Saved$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open this Source/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeTruthy();
    expect(useScrapeStore.getState().current?.article.content_markdown).toContain('Intro, edited.');
    expect(useScrapeStore.getState().edited).toBe(true);
  });

  it('a save started in the old workspace cannot restore its Saved claim after a switch', async () => {
    const pending = deferredApiResponse();
    mocks.apiPost.mockReturnValueOnce(pending.promise);
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    expect(mocks.apiPost.mock.calls[0]?.[1]).toMatchObject({
      organization_id: '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f',
    });

    await switchWorkspace(OTHER_ORGANIZATION_ID);
    await act(async () => pending.resolve(landedResponse));

    expect(screen.queryByRole('button', { name: /^Saved$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open this Source/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeTruthy();
    expect(useScrapeStore.getState().current?.article.content_markdown).toContain('Intro, edited.');

    mocks.apiPost.mockResolvedValue({
      ...landedResponse,
      data: {
        ...landedResponse.data,
        processed_document_id: 'c8a1cd55-3f22-44d1-bda6-1bb2d2777aae',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost.mock.calls[1]?.[1]).toMatchObject({
      organization_id: OTHER_ORGANIZATION_ID,
    });
    expect(await screen.findByRole('button', { name: /^Saved$/ })).toBeTruthy();
  });

  it('an old workspace save finishing late keeps the new workspace retry capture queued', async () => {
    const oldSave = deferredApiResponse();
    mocks.apiPost
      .mockReturnValueOnce(oldSave.promise)
      .mockResolvedValueOnce({ ok: false, status: 0, error: 'Failed to fetch' });
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));

    await switchWorkspace(OTHER_ORGANIZATION_ID);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
    expect(mocks.apiPost.mock.calls[1]?.[1]).toMatchObject({
      organization_id: OTHER_ORGANIZATION_ID,
    });
    expect(
      await screen.findByRole('alert', { name: 'Captures not yet saved as Sources' }),
    ).toBeTruthy();

    await act(async () => oldSave.resolve(landedResponse));
    const queued = await listUnsavedCaptures();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ url: soup.url, organizationId: OTHER_ORGANIZATION_ID });
    expect(screen.getByRole('button', { name: /Retry save/ })).toBeTruthy();
    expect(useScrapeStore.getState().current?.article.content_markdown).toContain('Intro, edited.');
  });

  it('an older A refusal cannot replace B’s newer edited capture in the retry card', async () => {
    const oldSave = deferredApiResponse();
    mocks.apiPost
      .mockReturnValueOnce(oldSave.promise)
      .mockResolvedValueOnce({ ok: false, status: 0, error: 'Failed to fetch' });
    render(<ScrapeView />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));

    await switchWorkspace(OTHER_ORGANIZATION_ID);
    act(() =>
      useScrapeStore
        .getState()
        .editArticleMarkdown('# Guide\n\nB changed the intake checklist.\n\n## Install\n\nRun it.'),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(async () => expect(await listUnsavedCaptures()).toHaveLength(1));
    const before = (await listUnsavedCaptures())[0];
    expect(before?.organizationId).toBe(OTHER_ORGANIZATION_ID);
    expect(before?.prepared.portions.map((p) => p.text).join('\n')).toContain(
      'B changed the intake checklist.',
    );

    await act(async () => oldSave.resolve({ ok: false, status: 0, error: 'Failed to fetch' }));
    const after = (await listUnsavedCaptures())[0];
    expect(after?.organizationId).toBe(OTHER_ORGANIZATION_ID);
    expect(after?.prepared.portions.map((p) => p.text).join('\n')).toContain(
      'B changed the intake checklist.',
    );
    expect(after?.prepared.portions.map((p) => p.text).join('\n')).not.toContain('Intro, edited.');
    expect(screen.getByRole('button', { name: /Retry save/ })).toBeTruthy();
  });

  it('an older retry refusal cannot replace a newer queued edit for the same URL', async () => {
    mocks.apiPost.mockResolvedValueOnce({ ok: false, status: 0, error: 'Failed to fetch' });
    const first = await saveCaptureAsSource(soup);
    expect(first.status).toBe('unsaved');
    if (first.status !== 'unsaved') return;

    const retry = deferredApiResponse();
    mocks.apiPost.mockReturnValueOnce(retry.promise);
    const oldRetry = retryUnsavedCapture(first.unsaved.id);
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));

    mocks.organizationId = OTHER_ORGANIZATION_ID;
    mocks.apiPost.mockResolvedValueOnce({ ok: false, status: 0, error: 'Failed to fetch' });
    const revised = {
      ...soup,
      article: {
        ...soup.article,
        content_markdown: '# Guide\n\nB revised the checklist after the first refusal.',
      },
    } as SoupResult;
    expect((await saveCaptureAsSource(revised, { articleEdited: true })).status).toBe('unsaved');
    const before = (await listUnsavedCaptures())[0];
    expect(before?.organizationId).toBe(OTHER_ORGANIZATION_ID);

    retry.resolve({ ok: false, status: 0, error: 'Failed to fetch' });
    await oldRetry;
    const after = (await listUnsavedCaptures())[0];
    expect(after?.organizationId).toBe(OTHER_ORGANIZATION_ID);
    expect(after?.prepared.portions.map((p) => p.text).join('\n')).toContain(
      'B revised the checklist',
    );
  });
  it.each(['land', 'discard'] as const)(
    'an old refusal cannot resurrect a page after a newer %s',
    async (terminal) => {
      mocks.apiPost.mockResolvedValueOnce({ ok: false, status: 0, error: 'Failed to fetch' });
      const first = await saveCaptureAsSource(soup);
      if (first.status !== 'unsaved') throw new Error('Expected queued capture');
      const pending = deferredApiResponse();
      mocks.apiPost.mockReturnValueOnce(pending.promise);
      const oldRetry = retryUnsavedCapture(first.unsaved.id);
      await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(2));
      if (terminal === 'land') {
        mocks.apiPost.mockResolvedValueOnce(landedResponse);
        expect((await saveCaptureAsSource(soup)).status).toBe('landed');
      } else {
        await discardUnsavedCapture(first.unsaved.id);
      }
      expect(await listUnsavedCaptures()).toEqual([]);
      pending.resolve({ ok: false, status: 0, error: 'Failed to fetch' });
      await oldRetry;
      expect(await listUnsavedCaptures()).toEqual([]);
      // A fresh explicit Save after the terminal action can still queue this page.
      mocks.apiPost.mockResolvedValueOnce({ ok: false, status: 0, error: 'Failed to fetch' });
      await saveCaptureAsSource(soup);
      expect(await listUnsavedCaptures()).toHaveLength(1);
    },
  );

  it('storage failure before dispatch returns the capture with an honest keep-panel-open remedy', async () => {
    const set = vi
      .spyOn(chrome.storage.local, 'set')
      .mockRejectedValueOnce(new Error('Device storage full'));
    try {
      const outcome = await saveCaptureAsSource(soup);
      expect(outcome.status).toBe('unsaved');
      if (outcome.status !== 'unsaved') throw new Error('Expected recoverable capture');
      expect(outcome.unsaved.prepared.portions.map((p) => p.text).join(' ')).toContain('Intro.');
      expect(outcome.unsaved.lastRefusal.message).toMatch(/keep this panel open/i);
      expect(mocks.apiPost).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
    }
  });

  it('device storage refusal is visible at Save and the edited capture can land after recovery', async () => {
    const set = vi
      .spyOn(chrome.storage.local, 'set')
      .mockRejectedValueOnce(new Error('Device storage full'));
    render(<ScrapeView />);
    try {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      expect(await screen.findByText(/not sent or saved on this device/)).toBeTruthy();
      expect(screen.getByText(/Keep this panel open/)).toBeTruthy();
      expect(useScrapeStore.getState().edited).toBe(true);
      expect(useScrapeStore.getState().current?.article.content_markdown).toContain(
        'Intro, edited.',
      );
      expect(mocks.apiPost).not.toHaveBeenCalled();
    } finally {
      set.mockRestore();
    }
    mocks.apiPost.mockResolvedValueOnce(landedResponse);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByRole('button', { name: /^Saved$/ })).toBeTruthy();
    expect(
      mocks.apiPost.mock.calls[0]?.[1].portions.map((p: { text: string }) => p.text).join(' '),
    ).toContain('Intro, edited.');
  });
});
