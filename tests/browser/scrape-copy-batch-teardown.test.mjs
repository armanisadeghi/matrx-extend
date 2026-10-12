import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { runGuestCopyMenus } from './scrape-guest-behavior-batch.mjs';

// Harbor Dental's capture copy finishes asynchronously; its closing portal
// must prevent another menu/tab click and prevent premature batch success.
async function exercise({ menus, remove }) {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="scrape-pane"></button>
    <section id="scrape-pane" role="tabpanel" data-state="active"><button title="Copy capture" aria-controls="capture-menu"></button></section>`;
  let clipboard = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      writeText: async (value) => {
        clipboard = value;
      },
      readText: async () => clipboard,
    },
  });
  const pointers = [];
  let teardownObservations = 0;
  const result = runGuestCopyMenus({
    panel: {},
    origin: 'http://127.0.0.1:65000',
    fixtureKey: 'intake',
    resourceAction: (action) => action(),
    menus,
    adapters: {
      evaluate: async (_panel, expression) => window.eval(expression),
      click: async (_panel, kind, label) => {
        pointers.push([kind, label]);
        if (kind === 'title') {
          const wrapper = window.document.createElement('div');
          wrapper.setAttribute('data-radix-popper-content-wrapper', '');
          wrapper.innerHTML = `<div id="capture-menu" role="dialog" data-state="open">${[...new Set(menus.flatMap((menu) => menu[2]))].map((option) => `<button><span class="truncate">${option}</span></button>`).join('')}</div>`;
          window.document.body.append(wrapper);
        }
        if (kind === 'scrape-copy-option') {
          clipboard =
            label === 'Page URL'
              ? 'http://127.0.0.1:65000/intake'
              : 'Harbor Dental intake guide\nNew patients can review appointment timing, forms, and arrival instructions\nSEO audit';
          window.document.getElementById('capture-menu').setAttribute('data-state', 'closed');
        }
      },
      waitFor: async (label, read, accept) => {
        const value = await read();
        if (accept(value)) return value;
        if (label === 'scrape_copy_popover_teardown') {
          teardownObservations++;
          if (remove) {
            window.document.getElementById('capture-menu').parentElement.remove();
            const after = await read();
            assert.equal(accept(after), true);
            return after;
          }
        }
        throw new Error(`${label}_not_observed`);
      },
      withClipboardReadPermission: async ({ read, evidence }) => {
        const value = await read();
        evidence.clipboardObservationPermissionRestored = true;
        return value;
      },
    },
  });
  return { result, pointers, observations: () => teardownObservations };
}

for (const [boundary, menus] of [
  ['next option', [['Copy capture', null, ['Page URL', 'Plain text']]]],
  [
    'next menu',
    [
      ['Copy capture', null, ['Page URL']],
      ['Copy capture', null, ['Page URL']],
    ],
  ],
  [
    'next tab',
    [
      ['Copy capture', null, ['Page URL']],
      ['Copy capture', 'Article', ['Page URL']],
    ],
  ],
  ['batch completion', [['Copy capture', null, ['Page URL']]]],
])
  test(`closed portal blocks ${boundary} until actual removal`, async () => {
    const blocked = await exercise({ menus, remove: false });
    const failure = await blocked.result.then(
      () => null,
      (error) => error,
    );
    assert.deepEqual(
      blocked.pointers,
      [
        ['title', 'Copy capture'],
        ['scrape-copy-option', 'Page URL'],
      ],
      'next pointer fired before portal removal',
    );
    assert.ok(failure, 'batch completed before portal removal');
    await assert.rejects(Promise.reject(failure), (error) => {
      assert.match(error.message, /scrape_copy_popover_teardown_not_observed/);
      assert.equal(error.copyBatchFailure.action.stage, 'wait_menu_teardown');
      return true;
    });
    assert.deepEqual(blocked.pointers, [
      ['title', 'Copy capture'],
      ['scrape-copy-option', 'Page URL'],
    ]);
    const released = await exercise({ menus, remove: true });
    const evidence = await released.result;
    const optionCount = menus.reduce((total, menu) => total + menu[2].length, 0);
    assert.equal(evidence.length, optionCount);
    assert.equal(released.observations(), optionCount);
  });
