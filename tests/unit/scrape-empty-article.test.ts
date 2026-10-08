// @vitest-environment jsdom
import { runScrape } from '@/lib/scrape/pipeline';
import { articleToMarkdown } from '@/lib/scrape/to-markdown';
import { expect, it } from 'vitest';

it('renders the real blank-page scrape fallback while retaining article extraction for content pages', async () => {
  const blank = new DOMParser().parseFromString(
    '<!doctype html><html><head><title>Harbor Dental blank notice</title></head><body></body></html>',
    'text/html',
  );
  const emptyCapture = await runScrape(blank, { baseUrl: 'http://localhost/blank-article' });
  expect(emptyCapture.article.content_markdown).toBeFalsy();
  expect(articleToMarkdown(emptyCapture)).toContain('No clean article extracted.');

  const populated = new DOMParser().parseFromString(
    '<!doctype html><html><head><title>Harbor Dental referral hours</title></head><body><main><article><h1>Harbor Dental referral hours</h1><p>Referral coordinators answer weekday calls.</p></article></main></body></html>',
    'text/html',
  );
  const populatedCapture = await runScrape(populated, { baseUrl: 'http://localhost/referrals' });
  expect(populatedCapture.article.content_markdown).toContain(
    'Referral coordinators answer weekday calls.',
  );
  expect(articleToMarkdown(populatedCapture)).not.toContain('No clean article extracted.');
});
