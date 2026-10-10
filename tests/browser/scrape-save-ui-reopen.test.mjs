import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { activeTabPanelExpression } from './settings-panel-driver.mjs';

const source = await readFile(
  process.env.SCRAPE_REOPEN_DRIVER_SOURCE ??
    new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function reopenSavedSourceUi(');
const end = source.indexOf('async function dialogState(', start);
const helperStart = source.indexOf('const ARTICLE_EXTRACTORS = new Set(');
const helperEnd = source.indexOf('async function readCaptureArticleLayer(', helperStart);
const contentEvidence = new Function(
  `${source.slice(helperStart, helperEnd)} return { articleLayerEvidence, renderedContentEvidence };`,
)();
const expected = {
  name: 'Northline appointment source',
  url: 'https://northline.example/appointments/intake',
  title: 'Northline appointment intake',
  heading: 'Preparing for a Northline appointment',
  marker: 'Bring the signed intake form to the appointment.',
};

function soup(corrupt) {
  return {
    url: expected.url,
    capturedAt: 1,
    metadata: { title: expected.title },
    article: {
      title: corrupt === 'originalTitle' ? 'Wrong article title' : expected.title,
      content_markdown: `${corrupt === 'originalHeading' ? '# Other heading' : `# ${expected.heading}`}\n\n${corrupt === 'originalMarker' ? 'Different body text.' : expected.marker}`,
      extractor: corrupt === 'extractor' ? 'unknown' : 'defuddle',
    },
    images: [],
    videos: [],
    audio: [],
    links: [],
  };
}

async function exercise({ corrupt = null, copies = 1 } = {}) {
  assert.ok(start >= 0, 'native driver must implement UI reopen');
  const reopen = new Function(
    'assert',
    'click',
    'waitFor',
    'evaluate',
    'activeTabPanelExpression',
    'trustedType',
    'articleLayerEvidence',
    'renderedContentEvidence',
    `${source.slice(start, end)} return reopenSavedSourceUi;`,
  );
  const window = new Window();
  const { document } = window;
  const evidence = {
    capture: {
      article_layer_ready: true,
      article_title_matches: true,
      heading_matches: true,
      marker_matches: true,
      extractor: 'defuddle',
    },
  };
  const controls = [];
  let clicks = 0;
  const detailSoup = soup(corrupt);
  document.body.innerHTML =
    '<button role="tab" title="Saved captures" data-state="active" aria-selected="true" aria-controls="saved"></button><section id="saved" role="tabpanel" data-state="active"><input placeholder="Search title or URL"></section>';
  const pane = document.getElementById('saved');
  const setTab = (label) => {
    const rows = {
      Details: `<div class="grid"><span>Original</span><span>${corrupt === 'originalUnavailable' ? 'Could not be read.' : 'Saved in your files'}</span></div>`,
      Data: `<pre>${JSON.stringify(detailSoup)}</pre>`,
      Article: `<div>${corrupt === 'uiHeading' ? 'Other heading' : expected.heading} ${corrupt === 'uiMarker' ? 'Different body text.' : expected.marker}</div>`,
    };
    pane.innerHTML = `<header><button><span>Back to saved captures</span></button><div class="font-semibold">${corrupt === 'name' ? 'Wrong source name' : expected.name}</div><div>${corrupt === 'url' ? 'https://northline.example/other' : expected.url}</div></header><button>${label}</button><div role="tabpanel" data-state="active">${rows[label]}</div>`;
  };
  try {
    const run = reopen(
      assert,
      async (_panel, kind, label) => {
        controls.push([kind, label]);
        if (kind === 'button-text' && ['Details', 'Data', 'Article'].includes(label)) setTab(label);
      },
      async (label, read, accept) => {
        const state = await read();
        assert.equal(Boolean(accept(state)), true, label);
        return state;
      },
      async (_panel, expression) => window.eval(expression),
      activeTabPanelExpression,
      async (_panel, selector, text) => {
        assert.equal(document.querySelectorAll(selector).length, 1);
        assert.equal(text, expected.name);
        for (let index = 0; index < copies; index++) {
          const article = document.createElement('article');
          article.innerHTML = `<button><div>${expected.name}</div><div>northline.example</div></button>`;
          const button = article.querySelector('button');
          button.getBoundingClientRect = () => ({ left: 1, top: 2, width: 100, height: 20 });
          button.scrollIntoView = () => {};
          pane.append(article);
        }
      },
      contentEvidence.articleLayerEvidence,
      contentEvidence.renderedContentEvidence,
    );
    await run(
      {
        async send(method, event) {
          assert.equal(method, 'Input.dispatchMouseEvent');
          clicks++;
          if (event.type === 'mouseReleased') setTab('Article');
        },
      },
      expected,
      evidence,
    );
    assert.deepEqual(controls, [
      ['title', 'Saved captures'],
      ['button-text', 'Details'],
      ['button-text', 'Data'],
      ['button-text', 'Article'],
    ]);
    assert.equal(clicks, 2);
    return evidence;
  } finally {
    window.happyDOM.abort();
  }
}

test('native driver reads original capture and reopened article before crediting a heading', async () => {
  const evidence = await exercise();
  assert.equal(evidence.saved_source_reopened_in_ui, true);
  assert.equal(evidence.reopen_header.name_matches, true);
  assert.equal(evidence.reopen_header.url_matches, true);
  assert.equal(evidence.saved_original_read_ready, true);
  assert.deepEqual(evidence.saved_original, {
    article_layer_ready: true,
    article_title_matches: true,
    heading_matches: true,
    marker_matches: true,
    extractor: 'defuddle',
  });
  assert.deepEqual(evidence.reopen_ui, { heading_matches: true, marker_matches: true });
  assert.equal(JSON.stringify(evidence).includes(expected.name), false);
  assert.match(source, /scrape_save_saved_original_content_ready/);
  assert.match(source, /await resourceAction\(\(\) =>\s*reopenSavedSourceUi/);
  assert.ok(
    source.indexOf("report.stage = 'source_ui_reopen'") <
      source.indexOf('} catch (error) {\n        primaryError = error;'),
  );
});

for (const [corrupt, reason] of [
  ['name', /scrape_save_reopened_name_not_observed/],
  ['url', /scrape_save_reopened_url_not_observed/],
  ['originalUnavailable', /scrape_save_original_read_ready/],
  ['originalTitle', /scrape_save_original_title_not_observed/],
  ['originalHeading', /scrape_save_original_heading_not_observed/],
  ['originalMarker', /scrape_save_original_marker_not_observed/],
  ['extractor', /scrape_save_original_extractor_not_allowlisted/],
  ['uiHeading', /scrape_save_reopened_content_verified_not_observed/],
  ['uiMarker', /scrape_save_reopened_marker_not_observed/],
]) {
  test(`UI reopen refuses ${corrupt} evidence loss`, async () => {
    await assert.rejects(exercise({ corrupt }), reason);
  });
}

test('UI reopen refuses duplicate exact-name rows before opening a Source', async () => {
  await assert.rejects(exercise({ copies: 2 }), /scrape_save_reopen_owned_source_ready/);
});
