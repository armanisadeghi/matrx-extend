import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyGuestCopy } from './seo-guest-clipboard.mjs';

const pages = [
  { url: 'https://example.org/', title: 'Example Domain', heading: 'Example Domain' },
  {
    url: 'https://www.iana.org/domains/reserved',
    title: 'IANA — IANA-managed Reserved Domains',
    heading: 'IANA-managed Reserved Domains',
  },
];

const summary = ({ url, title, heading }) =>
  `URL: ${url}\nTitle (${title.length} chars): ${title}\nDescription (0 chars): —\nCanonical: —\nRobots: —\n\nHeadings (1):\n  H1: ${heading}\n\nPage stats:\n  Images: 0 (missing alt: 0)\n  Words: 42`;

const ai = (text, { url, title }) =>
  `The following is an SEO audit for a webpage.\n\n- Source URL: ${url}\n- Title: ${title}\n\n\`\`\`\n${text}\n\`\`\``;

test('guest copy rejects stale page data and a swapped AI variant', () => {
  const [first, second] = pages;
  const firstText = summary(first);
  const secondText = summary(second);
  assert.deepEqual(verifyGuestCopy(firstText, ai(firstText, first), first), {
    textMatchesPublicPage: true,
    aiWrapsExactSummary: true,
  });
  assert.deepEqual(verifyGuestCopy(secondText, ai(secondText, second), second), {
    textMatchesPublicPage: true,
    aiWrapsExactSummary: true,
  });
  assert.throws(
    () => verifyGuestCopy(firstText, ai(firstText, first), second),
    /seo_clipboard_text_does_not_match_public_page/,
  );
  assert.throws(
    () => verifyGuestCopy(secondText, secondText, second),
    /seo_clipboard_ai_format_or_content_mismatch/,
  );
  assert.throws(
    () =>
      verifyGuestCopy(
        secondText.replace('Page stats:', 'Page summary:'),
        ai(secondText, second),
        second,
      ),
    /seo_clipboard_text_does_not_match_public_page/,
  );
});
