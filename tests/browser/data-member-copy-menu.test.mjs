import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const source = await readFile(
  new URL('./data-member-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function copyRows(');
const end = source.indexOf('\nasync function ', start + 1);
const createCopyRows = new Function(
  'assert',
  'click',
  'waitFor',
  'evaluate',
  'withClipboardReadPermission',
  `${source.slice(start, end)} return copyRows;`,
);

for (const label of ['TSV (paste to spreadsheet)', 'JSON', 'For AI agent']) {
  test(`member Data native copy targets ${label} label separately from its description`, async () => {
    const window = new Window();
    window.document.body.innerHTML = `<button title="Copy rows">Copy</button>
      <button>${label.startsWith('TSV') ? 'Unrelated action' : label}</button>
      <div data-radix-popper-content-wrapper>
        <button><span class="truncate">TSV (paste to spreadsheet)</span><p>Tab-separated rows</p></button>
        <button><span class="truncate">JSON</span></button>
        <button><span class="truncate">For AI agent</span></button>
      </div>`;
    const rect = {
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 110,
      bottom: 40,
      width: 100,
      height: 30,
    };
    let target;
    let copied = null;
    for (const button of window.document.querySelectorAll('button')) {
      button.getBoundingClientRect = () => rect;
      button.scrollIntoView = () => {
        target = button;
      };
      button.getAnimations = () => [];
    }
    window.HTMLElement.prototype.getAnimations = () => [];
    window.document.elementFromPoint = () => target;
    for (const button of window.document.querySelectorAll(
      '[data-radix-popper-content-wrapper] button',
    ))
      button.addEventListener('click', () => {
        copied = button.querySelector('span').textContent;
        window.document.body.insertAdjacentHTML('beforeend', '<svg aria-label="Copied"></svg>');
      });
    const panel = {
      async send(method, args) {
        if (method === 'Runtime.evaluate') {
          if (args.expression === 'navigator.clipboard.readText()')
            return { result: { value: copied } };
          return { result: { value: window.eval(args.expression) } };
        }
        if (method === 'Input.dispatchMouseEvent' && args.type === 'mouseReleased') target.click();
        return {};
      },
    };
    const copyRows = createCopyRows(
      assert,
      click,
      waitFor,
      evaluate,
      async ({ evidence, read }) => {
        const result = await read();
        evidence.clipboardObservationPermissionRestored = true;
        return result;
      },
    );
    try {
      const result = await copyRows(
        panel,
        {},
        { url: 'chrome-extension://owned/sidepanel.html' },
        label,
      );
      assert.equal(result, label);
    } finally {
      window.happyDOM.abort();
    }
  });
}
