import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';

const source = await readFile(
  new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('async function trustedType(');
const end = source.indexOf('\nasync function ', start + 1);
const factory = new Function(
  'assert',
  'evaluate',
  'process',
  `${source.slice(start, end)} return trustedType;`,
);

for (const platform of ['darwin', 'linux']) {
  test(`trusted replacement selects all prefilled text before insertion on ${platform}`, async () => {
    const window = new Window();
    window.document.body.innerHTML =
      '<input aria-label="Source name" value="Northline source intake">';
    const input = window.document.querySelector('input');
    input.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 30 });
    const commands = [];
    const panel = {
      async send(method, args) {
        commands.push(method);
        if (method === 'Input.dispatchMouseEvent') {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
        if (
          method === 'Input.dispatchKeyEvent' &&
          args.type === 'keyDown' &&
          args.commands?.includes('selectAll')
        ) {
          assert.equal(args.modifiers, platform === 'darwin' ? 4 : 2);
          input.select();
        }
        if (method === 'Input.insertText')
          input.setRangeText(args.text, input.selectionStart, input.selectionEnd, 'end');
      },
    };
    const evaluate = async (_panel, expression) => window.eval(expression);
    const trustedType = factory(assert, evaluate, { platform });
    const evidence = {};
    try {
      await trustedType(panel, 'input', 'Northline saved source', evidence);
      assert.equal(input.value, 'Northline saved source');
      assert.equal(evidence.before_insert.focused, true);
      assert.equal(evidence.before_insert.all_selected, true);
      assert.equal(evidence.after_insert.matches_expected, true);
      assert.equal(commands.filter((method) => method === 'Input.insertText').length, 1);
      assert.equal(JSON.stringify(evidence).includes('Northline'), false);
    } finally {
      window.happyDOM.abort();
    }
  });
}

for (const focused of [false, true]) {
  test(`trusted replacement refuses insertion when focus=${focused} and select-all was not observed`, async () => {
    let inserts = 0;
    let reads = 0;
    const panel = {
      async send(method) {
        if (method === 'Input.insertText') inserts++;
      },
    };
    const evaluate = async () =>
      ++reads === 1
        ? { count: 1, x: 10, y: 10 }
        : {
            count: 1,
            focused,
            value_length: 23,
            selection_start: 23,
            selection_end: 23,
            all_selected: false,
          };
    const trustedType = factory(assert, evaluate, { platform: 'darwin' });
    const evidence = {};
    await assert.rejects(trustedType(panel, 'input', 'Northline saved source', evidence), {
      message: focused ? /^scrape_save_input_selection_missing/ : /^scrape_save_input_focus_missing/,
    });
    assert.equal(inserts, 0);
    assert.equal(evidence.before_insert.focused, focused);
  });
}
