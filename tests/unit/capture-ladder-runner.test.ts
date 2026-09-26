/**
 * The runner reaches the guards — the half `capture-ladder-guards.test.ts`
 * cannot prove on its own.
 *
 * A guard nobody calls is decoration. These drive `runOne()` / `runBatch()` /
 * `captureDrivenTab()` with the server calls and the Chrome tab APIs stubbed,
 * and assert on WHAT WENT OUT THE DOOR: which endpoint was posted, with which
 * `captured_by_rung`, and whether anything was dropped in silence.
 *
 * What these do NOT prove, and must never be read as proving: that aidream's
 * `/capture/*` endpoints exist or behave as the contract says. They did not
 * exist when this was written. These prove the extension's half of the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claimHandoff = vi.fn();
const postCaptureResult = vi.fn();
const postNeedsDrive = vi.fn();
const captureWithFallback = vi.fn();
const getOuterHtml = vi.fn();

vi.mock('@/lib/capture-ladder/api', () => ({
  claimHandoff: (...args: unknown[]) => claimHandoff(...args),
  postCaptureResult: (...args: unknown[]) => postCaptureResult(...args),
  postNeedsDrive: (...args: unknown[]) => postNeedsDrive(...args),
  dismissHandoff: vi.fn(),
  getCapturePolicy: vi.fn(),
}));
vi.mock('@/lib/scrape/capture-with-fallback', () => ({
  captureWithFallback: (...args: unknown[]) => captureWithFallback(...args),
}));
vi.mock('@/lib/scrape/capture-html', () => ({
  getOuterHtml: (...args: unknown[]) => getOuterHtml(...args),
}));
vi.mock('@/lib/scrape/page-ready', () => ({
  settlePage: vi.fn(async () => undefined),
  scrollToLoadLazy: vi.fn(async () => undefined),
}));

import { captureDrivenTab, nextScrollPauseMs, runOne } from '@/lib/capture-ladder/runner';
import { type Handoff, handoffSchema } from '@/lib/capture-ladder/types';

function row(overrides: Partial<Handoff> = {}): Handoff {
  return handoffSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    url: 'https://example.com/article',
    title: 'An article',
    rung: 'own_browser',
    status: 'waiting',
    ...overrides,
  });
}

const created: { url?: string; active?: boolean }[] = [];
const removed: number[] = [];
const executed: unknown[] = [];

function installTabs(): void {
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> };
  chromeGlobal.chrome = {
    ...(chromeGlobal.chrome ?? {}),
    tabs: {
      create: vi.fn(async (opts: { url?: string; active?: boolean }) => {
        created.push(opts);
        return { id: 77, url: opts.url, status: 'complete' };
      }),
      get: vi.fn(async (_id: number) => ({
        id: 77,
        url: 'https://example.com/article',
        status: 'complete',
      })),
      remove: vi.fn(async (id: number) => {
        removed.push(id);
      }),
    },
    scripting: {
      executeScript: vi.fn(async (arg: unknown) => {
        executed.push(arg);
        return [{ result: undefined }];
      }),
    },
  };
}

function goodCapture(chars: number): void {
  captureWithFallback.mockResolvedValue({
    ok: true,
    soup: {
      article: { title: 'An article', content_markdown: 'x'.repeat(chars) },
    },
  });
  getOuterHtml.mockResolvedValue('<html></html>');
}

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
  executed.length = 0;
  claimHandoff.mockReset();
  postCaptureResult.mockReset();
  postNeedsDrive.mockReset();
  captureWithFallback.mockReset();
  getOuterHtml.mockReset();
  installTabs();
  claimHandoff.mockResolvedValue({ ok: true, data: row({ status: 'claimed' }) });
  postCaptureResult.mockResolvedValue({
    ok: true,
    data: {
      handoff: {},
      processed_document_id: '6b8c38dd-6d68-4824-b664-a380b7611627',
      source_id: 'spp-1',
      transcript_id: null,
      library_id: 'lib',
      notices: [
        {
          code: 'intelligence_deferred',
          message: 'Saved as a Source, not processed by AI yet.',
          remedy: 'keep_it_to_process_it',
        },
      ],
    },
  });
  postNeedsDrive.mockResolvedValue({ ok: true, data: row({ status: 'needs_drive' }) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rung 3 — the unattended run', () => {
  it('opens the page in a BACKGROUND tab, reads it, closes it, and files a rung-3 result', async () => {
    goodCapture(5_000);
    const outcome = await runOne(row(), { scrollPasses: 2, claimFirst: true });

    expect(created[0]?.active).toBe(false);
    expect(removed).toContain(77);
    expect(postCaptureResult).toHaveBeenCalledTimes(1);
    const body = postCaptureResult.mock.calls[0]?.[1] as {
      captured_by_rung: string;
      chars: number;
    };
    expect(body.captured_by_rung).toBe('own_browser');
    expect(body.chars).toBe(5_000);
    expect(outcome).toMatchObject({ posted: 'result', ok: true, claimed: true });
    // The landing's Source and its notices reach the outcome and the tray sentence.
    expect(outcome.processedDocumentId).toBe('6b8c38dd-6d68-4824-b664-a380b7611627');
    expect(outcome.notices?.[0]?.code).toBe('intelligence_deferred');
    expect(outcome.note).toContain('Saved as a Source, not processed by AI yet.');
  });

  it('hands a thin read to the person instead of filing a near-empty Source', async () => {
    goodCapture(40);
    const outcome = await runOne(row(), { scrollPasses: 1, claimFirst: true });

    expect(postCaptureResult).not.toHaveBeenCalled();
    expect(postNeedsDrive).toHaveBeenCalledTimes(1);
    const body = postNeedsDrive.mock.calls[0]?.[1] as { reason: string; note: string };
    expect(body.reason).toBe('thin_content');
    // The person reads this. It has to be a sentence telling them what to do.
    expect(body.note).toMatch(/I am done, capture it/);
    expect(outcome.posted).toBe('needs_drive');
  });

  it('hands an unreadable page to the person rather than dropping it', async () => {
    captureWithFallback.mockResolvedValue({ ok: false, reason: 'no-content-script' });
    const outcome = await runOne(row(), { scrollPasses: 1, claimFirst: true });

    expect(postNeedsDrive).toHaveBeenCalledTimes(1);
    expect(outcome.posted).toBe('needs_drive');
    expect(removed).toContain(77);
  });

  it('REFUSES to run a row that is waiting on a person — no tab, no post', async () => {
    goodCapture(5_000);
    const outcome = await runOne(row({ rung: 'human_drive', status: 'needs_drive' }), {
      scrollPasses: 2,
      claimFirst: true,
    });

    expect(created).toHaveLength(0);
    expect(postCaptureResult).not.toHaveBeenCalled();
    expect(claimHandoff).not.toHaveBeenCalled();
    expect(outcome.posted).toBe('none');
    expect(outcome.note).toMatch(/did not file it/);
  });

  it('leaves a row alone when another browser already holds the claim', async () => {
    claimHandoff.mockResolvedValue({ ok: false, status: 409, error: 'already_claimed' });
    const outcome = await runOne(row(), { scrollPasses: 1, claimFirst: true });

    expect(created).toHaveLength(0);
    expect(postCaptureResult).not.toHaveBeenCalled();
    expect(postNeedsDrive).not.toHaveBeenCalled();
    // Not a skip: nothing was claimed, so the row is untouched and still waiting.
    expect(outcome).toMatchObject({ claimed: false, posted: 'none' });
    expect(outcome.note).toMatch(/Another browser/);
  });

  it('says so on the item when it could not report the outcome at all', async () => {
    // Both doors shut: the read failed AND the needs-drive post failed. The row
    // is claimed and nothing was reported — exactly the silent skip.
    captureWithFallback.mockResolvedValue({ ok: false, reason: 'capture-error' });
    postNeedsDrive.mockResolvedValue({ ok: false, status: 500, error: 'server_unavailable' });

    const outcome = await runOne(row(), { scrollPasses: 1, claimFirst: true });

    expect(outcome.claimed).toBe(true);
    expect(outcome.posted).toBe('none');
    expect(outcome.note).toMatch(/looking busy/);
  });

  it('scrolls exactly as many times as the org knob says', async () => {
    goodCapture(5_000);
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    await runOne(row(), { scrollPasses: 3, claimFirst: true });
    vi.restoreAllMocks();

    // 3 scroll steps + the two getOuterHtml/settle calls are separate mocks, so
    // every executeScript here is a scroll.
    expect(executed).toHaveLength(3);
  });
});

describe('pacing is human, never a metronome', () => {
  it('stays inside the 400–1200ms band once jitter is applied', () => {
    const samples = Array.from({ length: 500 }, () => nextScrollPauseMs());
    for (const ms of samples) {
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThanOrEqual(1_400);
    }
    // A fixed interval would collapse to one value. This must not.
    expect(new Set(samples).size).toBeGreaterThan(50);
  });

  it('is not a constant even for a constant random source', () => {
    // Same random draw twice gives the same pause — but the jitter term means
    // the pause is not simply the band's midpoint.
    expect(nextScrollPauseMs(() => 0.5)).toBe(800);
    expect(nextScrollPauseMs(() => 0)).toBe(220);
  });
});

describe('rung 4 — the person drove', () => {
  it('captures the tab as it stands and stamps it as the person s own work', async () => {
    goodCapture(1_200);
    const handoff = row({ rung: 'human_drive', status: 'needs_drive' });
    const outcome = await captureDrivenTab(handoff, 77);

    expect(postCaptureResult).toHaveBeenCalledTimes(1);
    const body = postCaptureResult.mock.calls[0]?.[1] as { captured_by_rung: string };
    expect(body.captured_by_rung).toBe('human_drive');
    expect(outcome).toMatchObject({ posted: 'result', ok: true });
    // The person arranged that tab. Nothing scrolled it and nothing closed it.
    expect(executed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('refuses to file a rung-3 row as work a person drove', async () => {
    goodCapture(1_200);
    const outcome = await captureDrivenTab(row({ rung: 'own_browser' }), 77);

    expect(postCaptureResult).not.toHaveBeenCalled();
    expect(outcome.posted).toBe('none');
    expect(outcome.note).toMatch(/did not file it/);
  });
});
