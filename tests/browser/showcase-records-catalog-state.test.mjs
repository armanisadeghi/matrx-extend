import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { click, toolsCatalogState } from './settings-panel-driver.mjs';

test('Catalog readiness follows the actual lazy view mount', async () => {
  const window = new Window();
  window.document.body.innerHTML =
    '<button role="tab" title="Tools" data-state="active" aria-controls="tools"></button><div id="tools" role="tabpanel" data-state="active"><div class="animate-spin"></div></div>';
  const panel = {
    async send(method, { expression }) {
      assert.equal(method, 'Runtime.evaluate');
      return { result: { value: await window.eval(expression) } };
    },
  };
  assert.equal(await toolsCatalogState(panel), 'loading');
  window.document.querySelector('#tools').innerHTML =
    '<button role="tab" data-state="active">Catalog</button><input placeholder="Search by name or description…">';
  assert.equal(await toolsCatalogState(panel), 'catalog');
  window.happyDOM.abort();
});

for (const [state, inner] of [
  ['loading', '<div class="animate-spin"></div>'],
  ['other_tab', '<button role="tab" data-state="inactive">Catalog</button>'],
  [
    'catalog',
    '<button role="tab" data-state="active">Catalog</button><input placeholder="Search by name or description…" value="other"><button role="combobox">All (12)</button><button role="combobox">Agent surface (12)</button><button role="combobox">All categories (12)</button><button><span class="font-mono">other</span></button>',
  ],
]) {
  test(`Records pointer samples ${state} without dispatch`, async () => {
    const window = new Window();
    window.document.body.innerHTML = `<button role="tab" title="Tools" data-state="active" aria-controls="tools"></button><div id="tools" role="tabpanel" data-state="active">${inner}</div>`;
    const dispatched = [];
    const panel = {
      async send(method, { expression }) {
        if (method === 'Runtime.evaluate') {
          return { result: { value: await window.eval(expression) } };
        }
        dispatched.push(method);
        return {};
      },
    };
    await assert.rejects(click(panel, 'tool-row', 'records'), (error) => {
      assert.equal(error.driverFailure.code, 'pointer_target_not_unique');
      assert.equal(error.driverFailure.toolsPanelActive, true);
      assert.equal(error.driverFailure.toolsViewState, state);
      assert.equal(error.driverFailure.matchedTargetCount, 0);
      assert.equal(error.driverFailure.toolsCatalogRowCount, state === 'catalog' ? 1 : null);
      assert.equal(error.driverFailure.toolsCatalogSearchEmpty, state === 'catalog' ? false : null);
      assert.equal(
        error.driverFailure.toolsCatalogFiltersDefault,
        state === 'catalog' ? true : null,
      );
      return true;
    });
    assert.deepEqual(dispatched, []);
    window.happyDOM.abort();
  });
}
