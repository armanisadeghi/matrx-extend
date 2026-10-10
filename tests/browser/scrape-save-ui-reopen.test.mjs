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
const expected = {
  name: 'Owned custom Source',
  url: 'https://example.test/owned',
  heading: 'Owned capture heading',
  marker: 'Controlled captured text marker.',
};

async function exercise({ corrupt = null, copies = 1 } = {}) {
  assert.ok(start >= 0, 'native driver must implement UI reopen');
  const reopen = new Function(
    'assert',
    'click',
    'waitFor',
    'evaluate',
    'activeTabPanelExpression',
    'trustedType',
    `${source.slice(start, end)} return reopenSavedSourceUi;`,
  );
  const window = new Window();
  const { document } = window;
  const evidence = {};
  const controls = [];
  let clicks = 0;
  document.body.innerHTML =
    '<button role="tab" title="Saved captures" data-state="active" aria-selected="true" aria-controls="saved"></button><section id="saved" role="tabpanel" data-state="active"><input placeholder="Search title or URL"></section>';
  const pane = document.getElementById('saved');
  const showDetail = () => {
    const value = (key) => (corrupt === key ? 'wrong value' : expected[key]);
    pane.innerHTML = `<header><button><span>Back to saved captures</span></button><div class="font-semibold">${value('name')}</div><div>${value('url')}</div></header><div role="tabpanel" data-state="active">${value('heading')} ${value('marker')}</div>`;
  };
  try {
    const run = reopen(
      assert,
      async (_panel, kind, label) => controls.push([kind, label]),
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
          article.innerHTML = `<button><div>${expected.name}</div><div>example.test</div></button>`;
          const button = article.querySelector('button');
          button.getBoundingClientRect = () => ({ left: 1, top: 2, width: 100, height: 20 });
          pane.append(article);
        }
      },
    );
    await run(
      {
        async send(method, event) {
          assert.equal(method, 'Input.dispatchMouseEvent');
          clicks++;
          if (event.type === 'mouseReleased') showDetail();
        },
      },
      expected,
      evidence,
    );
    assert.deepEqual(controls, [['title', 'Saved captures']]);
    assert.equal(clicks, 2);
    return evidence;
  } finally {
    window.happyDOM.abort();
  }
}

test('native driver reopens through Saved captures and verifies persisted UI fields', async () => {
  const evidence = await exercise();
  assert.equal(evidence.saved_source_reopened_in_ui, true);
  assert.ok(Object.values(evidence.reopen_ui).every((value) => value === true));
  assert.equal(JSON.stringify(evidence).includes(expected.name), false);
  assert.match(source, /await resourceAction\(\(\) =>\s*reopenSavedSourceUi/);
  assert.ok(
    source.indexOf("report.stage = 'source_ui_reopen'") <
      source.indexOf('} catch (error) {\n        primaryError = error;'),
  );
});
for (const corrupt of ['name', 'url', 'heading', 'marker']) {
  test(`UI reopen refuses mismatched ${corrupt}`, async () => {
    await assert.rejects(exercise({ corrupt }), /scrape_save_reopened_content_verified/);
  });
}
test('UI reopen refuses duplicate exact-name rows before clicking', async () => {
  await assert.rejects(exercise({ copies: 2 }), /scrape_save_reopen_owned_source_ready/);
});
