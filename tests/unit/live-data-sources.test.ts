import {
  type DataFetchRefusal,
  clampRecords,
  consumeDataFetch,
  estimatePoints,
  matchSourceForUrl,
  parseCatalog,
  tableUrl,
} from '@/lib/data-sources/contract';
import { describe, expect, it } from 'vitest';

const catalog = parseCatalog({
  sources: [
    {
      key: 'trustpilot_reviews',
      label: 'Trustpilot reviews',
      input: { kind: 'url' },
      example_url: 'https://www.trustpilot.com/review/acme.com',
      verified: true,
      usd_per_record: 0.0015,
    },
    {
      key: 'google_maps_places',
      label: 'Google Maps',
      input: { kind: 'url' },
      example_url: 'https://www.google.com/maps/place/x',
      verified: true,
      usd_per_record: 0.002,
    },
  ],
  limits: {
    max_records_per_fetch: {
      value: 500,
      setting: 'knowledge.scraper.site_data_max_records_per_fetch',
    },
  },
});

async function* gen(items: unknown[]) {
  for (const i of items) yield i;
}

describe('live data sources', () => {
  it('matches by host and first path segment', () => {
    expect(
      matchSourceForUrl('https://www.trustpilot.com/review/allbirds.com', catalog.sources)?.key,
    ).toBe('trustpilot_reviews');
    expect(matchSourceForUrl('https://uk.trustpilot.com/review/x', catalog.sources)?.key).toBe(
      'trustpilot_reviews',
    );
    expect(matchSourceForUrl('https://www.google.com/search?q=a', catalog.sources)).toBeNull();
    expect(matchSourceForUrl('https://example.com/', catalog.sources)).toBeNull();
  });
  it('quotes points and clamps to the limit', () => {
    expect(estimatePoints({ usdPerRecord: 0.0015, pointsPerRecord: null }, 25)).toBe(750);
    expect(estimatePoints({ usdPerRecord: null, pointsPerRecord: null }, 25)).toBeNull();
    expect(clampRecords(9999, catalog.maxRecordsPerFetch)).toBe(500);
    expect(clampRecords(0, null)).toBe(1);
  });
  it('folds a stream into a result and surfaces refusals', async () => {
    const result = await consumeDataFetch(
      gen([
        { event: 'data', data: { type: 'data_fetch_stage', label: 'Fetching' } },
        {
          event: 'data',
          data: {
            type: 'data_fetch_result',
            result: { table_id: 't1', table_name: 'T', rows_created: 5 },
          },
        },
      ]),
    );
    expect(result.tableId).toBe('t1');
    await expect(
      consumeDataFetch(
        gen([
          {
            event: 'error',
            data: { code: 'limit', user_message: 'Too many.', limit: { value: 10, setting: 's' } },
          },
        ]),
      ),
    ).rejects.toMatchObject({
      userMessage: 'Too many.',
      limit: { value: 10, setting: 's' },
    } satisfies Partial<DataFetchRefusal>);
  });
  it('prefers the server url pattern and its points quote', () => {
    const c = parseCatalog({
      sources: [
        {
          key: 'a',
          label: 'A',
          input: { kind: 'url' },
          url_pattern: { host: '(^|\\.)trustpilot\\.com$', path: '^/review/' },
          verified: true,
          usd_per_record: 0.001,
          points_per_record: 30,
        },
      ],
    });
    expect(
      matchSourceForUrl('https://www.trustpilot.com/review/allbirds.com', c.sources)?.key,
    ).toBe('a');
    expect(matchSourceForUrl('https://www.trustpilot.com/categories', c.sources)).toBeNull();
    expect(estimatePoints(c.sources[0] as never, 5)).toBe(150);
  });
  it('matches the server pattern against path plus query', () => {
    const c = parseCatalog({
      sources: [
        {
          key: 'maps',
          label: 'Google Maps place',
          input: { kind: 'url' },
          url_pattern: { host: '(^|\\.)google\\.com$', path: '^/maps/place/.*place_id' },
          verified: true,
          points_per_record: 30,
        },
      ],
    });
    expect(
      matchSourceForUrl(
        'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4',
        c.sources,
      )?.key,
    ).toBe('maps');
    expect(matchSourceForUrl('https://www.google.com/maps/place/Sydney', c.sources)).toBeNull();
  });
  it('builds the web table url', () => {
    expect(tableUrl('https://aimatrx.com/', 'abc')).toBe('https://aimatrx.com/data/abc');
  });
});
