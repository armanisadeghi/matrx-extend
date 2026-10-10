import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('const ARTICLE_EXTRACTORS = new Set(');
const end = source.indexOf('async function readCaptureArticleLayer(', start);
assert.ok(start >= 0 && end > start, 'native driver must define content evidence helpers');
const { articleLayerEvidence, renderedContentEvidence } = new Function(
  `${source.slice(start, end)} return { articleLayerEvidence, renderedContentEvidence };`,
)();

const cases = [
  {
    expected: {
      title: 'Northline appointment intake',
      heading: 'Preparing for a Northline appointment',
      marker: 'Bring the signed intake form to the appointment.',
    },
    article: {
      title: 'Northline appointment intake',
      markdown:
        '# Preparing for a Northline appointment\n\nBring the signed intake form to the appointment.',
      extractor: 'defuddle',
    },
  },
  {
    expected: {
      title: 'Harbor Dental first visit',
      heading: 'Before your first visit',
      marker: 'Complete the health history before check-in.',
    },
    article: {
      title: 'Harbor Dental first visit',
      markdown: '# Before your first visit\n\nComplete the health history before check-in.',
      extractor: 'readability',
    },
  },
];

test('content evidence separates article title from heading across distinct captures', () => {
  for (const { expected, article } of cases) {
    assert.deepEqual(articleLayerEvidence(article, expected), {
      article_layer_ready: true,
      article_title_matches: true,
      heading_matches: true,
      marker_matches: true,
      extractor: article.extractor,
    });
    assert.deepEqual(renderedContentEvidence(article.markdown, expected), {
      heading_matches: true,
      marker_matches: true,
    });
  }
});

test('content evidence exposes title, heading, marker, and extractor loss independently', () => {
  const { expected, article } = cases[0];
  assert.deepEqual(
    articleLayerEvidence(
      { ...article, markdown: `# ${expected.heading}\n\n${expected.marker}` },
      expected,
    ),
    {
      article_layer_ready: true,
      article_title_matches: true,
      heading_matches: true,
      marker_matches: true,
      extractor: 'defuddle',
    },
  );
  assert.equal(
    articleLayerEvidence({ ...article, title: 'Wrong page title' }, expected).article_title_matches,
    false,
    'article_title_matches must reject a different title',
  );
  assert.equal(
    articleLayerEvidence({ ...article, markdown: `Body only: ${expected.marker}` }, expected)
      .heading_matches,
    false,
    'heading_matches must reject a missing captured h1',
  );
  assert.equal(
    articleLayerEvidence({ ...article, markdown: `# ${expected.heading}` }, expected)
      .marker_matches,
    false,
    'marker_matches must reject a missing body marker',
  );
  assert.equal(
    articleLayerEvidence({ ...article, extractor: 'unreviewed-extractor' }, expected).extractor,
    null,
  );
  assert.equal(
    articleLayerEvidence({ ...article, markdown: null }, expected).article_layer_ready,
    false,
    'article_layer_ready must wait for observed title and extracted text',
  );
  const rendered = renderedContentEvidence(`Body only: ${expected.marker}`, expected);
  assert.equal(rendered.heading_matches, false, 'rendered heading_matches must reject missing h1');
  assert.equal(
    rendered.marker_matches,
    true,
    'rendered marker_matches must preserve observed body text',
  );
  assert.equal(
    renderedContentEvidence(expected.heading, expected).marker_matches,
    false,
    'rendered marker_matches must reject missing body text',
  );
});
