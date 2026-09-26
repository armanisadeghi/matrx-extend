import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
// A plain throwing stand-in for the failure case (a throwing vi.fn failed the
// test here even though pageSourceStatus caught it and returned correctly).
const offline = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/supabase/queries', () => ({
  lookupCapturedByUrl: (url: string) => {
    if (offline.on) throw new Error('offline');
    return lookup(url);
  },
}));

import { NOT_YET_A_SOURCE_ACTION, pageSourceFlat, pageSourceStatus } from './page-source';

beforeEach(() => {
  lookup.mockReset();
  offline.on = false;
});

describe('pageSourceStatus — what the chat context says about the active page', () => {
  it('a landed page is a Source, by id', async () => {
    lookup.mockResolvedValue({
      status: 'found',
      page: {
        id: 'src-1',
        url: 'https://a.test/x',
        captured_at: '2026-09-26T00:00:00Z',
        title: 'X',
      },
    });
    const s = await pageSourceStatus('https://a.test/x');
    expect(s).toEqual({
      status: 'source',
      source_id: 'src-1',
      title: 'X',
      saved_at: '2026-09-26T00:00:00Z',
    });
    expect(pageSourceFlat(s)).toMatchObject({
      page_source_status: 'source',
      page_source_id: 'src-1',
    });
  });

  it('an address without landed content is "not yet a Source", with the action', async () => {
    lookup.mockResolvedValue({ status: 'none' });
    const s = await pageSourceStatus('https://a.test/y');
    expect(s).toEqual({ status: 'not_yet_a_source', how_to_make_it_one: NOT_YET_A_SOURCE_ACTION });
    expect(NOT_YET_A_SOURCE_ACTION).toMatch(/Not yet a Source.*Save/);
    expect(pageSourceFlat(s)).toEqual({
      page_source_status: 'not_yet_a_source',
      page_source_note: NOT_YET_A_SOURCE_ACTION,
    });
  });

  it('a failed lookup is unknown — reported, not silently dropped', async () => {
    lookup.mockResolvedValue({ status: 'unknown', reason: 'permission denied' });
    expect(await pageSourceStatus('https://a.test/z')).toEqual({
      status: 'unknown',
      reason: 'Could not check whether this page is a Source: permission denied',
    });
    offline.on = true;
    expect(await pageSourceStatus('https://a.test/z')).toEqual({
      status: 'unknown',
      reason: 'Could not check whether this page is a Source: offline',
    });
  });
});
