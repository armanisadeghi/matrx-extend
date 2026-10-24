import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  data: null as unknown,
  error: null as { message: string; code?: string } | null,
  client: null as any,
}));

function makeClient() {
  const query = {
    select(columns: string) {
      supabase.calls.push(['select', columns]);
      return query;
    },
    eq(column: string, value: unknown) {
      supabase.calls.push(['eq', column, value]);
      return query;
    },
    is(column: string, value: unknown) {
      supabase.calls.push(['is', column, value]);
      return query;
    },
    maybeSingle: async () => {
      supabase.calls.push(['maybeSingle']);
      return { data: supabase.data, error: supabase.error };
    },
  };
  return {
    schema(schema: string) {
      supabase.calls.push(['schema', schema]);
      return {
        from(table: string) {
          supabase.calls.push(['from', table]);
          return query;
        },
      };
    },
  };
}

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => supabase.client,
}));

import { fetchScreenshotById } from './queries';

const screenshotId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const screenshotRow = {
  id: screenshotId,
  page_url_canonical: 'https://example.test/page',
  page_url_full: 'https://example.test/page?source=fixture',
  page_title: 'Fixture page',
  file_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  file_url: 'https://files.example.test/screenshot.png',
  width: 1280,
  height: 720,
  mime_type: 'image/png',
  byte_length: 4096,
  source: 'user',
  captured_at: '2026-10-23T12:00:00.000Z',
};
const projectedColumns =
  'id,page_url_canonical,page_url_full,page_title,file_id,file_url,width,height,mime_type,byte_length,source,captured_at';

beforeEach(() => {
  supabase.calls = [];
  supabase.data = null;
  supabase.error = null;
  supabase.client = makeClient();
});

describe('fetchScreenshotById through the data/db read door', () => {
  it('reads the selected screenshot id with the canonical projection and soft-delete filter', async () => {
    supabase.data = screenshotRow;

    await expect(fetchScreenshotById(screenshotId)).resolves.toEqual(screenshotRow);
    expect(supabase.calls).toEqual([
      ['schema', 'extend'],
      ['from', 'wbx_screenshot'],
      ['select', projectedColumns],
      ['eq', 'id', screenshotId],
      ['is', 'deleted_at', null],
      ['maybeSingle'],
    ]);
  });

  it('returns null when the selected id has no visible row', async () => {
    await expect(fetchScreenshotById(screenshotId)).resolves.toBeNull();
    expect(supabase.calls).toEqual([
      ['schema', 'extend'],
      ['from', 'wbx_screenshot'],
      ['select', projectedColumns],
      ['eq', 'id', screenshotId],
      ['is', 'deleted_at', null],
      ['maybeSingle'],
    ]);
  });

  it('preserves data-layer read failures with the fetch call site', async () => {
    supabase.error = { message: 'permission denied for table wbx_screenshot', code: '42501' };

    await expect(fetchScreenshotById(screenshotId)).rejects.toThrow(
      'fetchScreenshotById: permission denied for table wbx_screenshot',
    );
    expect(supabase.calls).toEqual([
      ['schema', 'extend'],
      ['from', 'wbx_screenshot'],
      ['select', projectedColumns],
      ['eq', 'id', screenshotId],
      ['is', 'deleted_at', null],
      ['maybeSingle'],
    ]);
  });
});
