import { normalizeSemanticMarkup, runScrape } from '@/lib/scrape/pipeline';
import { describe, expect, it } from 'vitest';

// Defuddle prunes <header> without adjacent paragraphs or an image in Chrome.
// Happy DOM does not implement that :has() selector the same way, so mirror
// the dependency's removal at the boundary after our clone normalization.
async function captureAfterDefuddleHeaderPrune(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const originalHtml = doc.documentElement.outerHTML;
  const cloned = doc.cloneNode(true) as Document;
  normalizeSemanticMarkup(cloned);
  const normalizedArticleHeader = cloned.querySelector(
    'article > header[data-case="headed"], [role="article"] > header[data-case="headed"]',
  );
  const normalizedArticleHeading = cloned.querySelector(
    'article > div > h1, [role="article"] > div > h1',
  );
  const outsideHeader = cloned.querySelector('body > header');
  const unheadedArticleHeader = cloned.querySelector(
    'article > header[data-case="unheaded"], [role="article"] > header[data-case="unheaded"]',
  );
  // This is a controlled stand-in for Defuddle's native-Chrome header prune,
  // not evidence that Defuddle itself ran its selector in this test engine.
  for (const header of Array.from(cloned.querySelectorAll('header'))) header.remove();
  const result = await runScrape(cloned, { baseUrl: 'https://www.aimatrx.com/matrx-extend-demo' });
  return {
    original: doc,
    originalHtml,
    normalizedArticleHeader,
    normalizedArticleHeading,
    outsideHeader,
    unheadedArticleHeader,
    result,
  };
}

describe('article headers at the Defuddle boundary', () => {
  it.each([
    ['article', 'A clear three-stage browser workflow', 'Capture', 'Understand', 'Use'],
    ['role', 'New patient intake workflow', 'Schedule', 'Complete', 'Review'],
  ])(
    'keeps the article heading and introduction for %s',
    async (container, heading, first, second, third) => {
      const articleOpen = container === 'article' ? '<article>' : '<div role="article">';
      const articleClose = container === 'article' ? '</article>' : '</div>';
      const intro = `This page explains the work each person completes before ${first.toLowerCase()} can move forward.`;
      const {
        original,
        originalHtml,
        normalizedArticleHeader,
        normalizedArticleHeading,
        outsideHeader,
        unheadedArticleHeader,
        result,
      } = await captureAfterDefuddleHeaderPrune(`
      <!doctype html><html><head><title>Workflow guide</title></head><body>
      <header><h1>Site navigation</h1><nav>Account and billing</nav></header>
      <main>${articleOpen}
        <header data-case="headed"><p>Workflow guide</p><h1>${heading}</h1>
          <p>${intro}</p>
        </header>
        <h2>The workflow stages</h2>
        <table><tbody><tr><th>${first}</th><td>Record the request.</td></tr>
          <tr><th>${second}</th><td>Check the details.</td></tr>
          <tr><th>${third}</th><td>Finish the next action.</td></tr></tbody></table>
        <p>${'The team uses each completed stage to keep the next person informed. '.repeat(12)}</p>
        <header data-case="unheaded"><p>Related account links</p></header>
      ${articleClose}</main></body></html>`);
      const markdown = result.article.content_markdown ?? '';
      expect(markdown).toContain(heading);
      expect(markdown).toContain(intro);
      expect(original.documentElement.outerHTML).toBe(originalHtml);
      expect(
        original.querySelector(
          `${container === 'article' ? 'article' : '[role="article"]'} > header > h1`,
        )?.textContent,
      ).toBe(heading);
      expect(normalizedArticleHeader).toBeNull();
      expect(normalizedArticleHeading?.textContent).toBe(heading);
      expect(outsideHeader?.tagName).toBe('HEADER');
      expect(unheadedArticleHeader?.tagName).toBe('HEADER');
      expect(markdown).toContain(first);
      expect(markdown).toContain(second);
      expect(markdown).toContain(third);
    },
  );
});
