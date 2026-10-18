import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);

function restoration() {
  const start = source.indexOf(
    '        // Restore the native member panel after web authentication.',
  );
  const end = source.indexOf("        stage = 'signed_in_swipe_file_tab';", start);
  assert.ok(start >= 0 && end > start, 'member foreground restoration must precede Chat');
  return new Function(
    'web',
    'page',
    'native',
    'panel',
    'waitFor',
    'evaluate',
    `return (async () => { ${source.slice(start, end)} })();`,
  );
}

test('member runner closes auth tab, activates root, reopens owned panel, then requires native visibility', async () => {
  const events = [];
  let webOpen = true;
  let rootActive = false;
  let visibility = 'hidden';
  await restoration()(
    {
      close: async () => {
        webOpen = false;
        events.push('web_closed');
      },
    },
    {
      bringToFront: async () => {
        assert.equal(webOpen, false);
        rootActive = true;
        events.push('root_active');
      },
    },
    {
      reopenPanel: async () => {
        assert.equal(rootActive, true);
        visibility = 'visible';
        events.push('panel_reopened');
      },
    },
    {},
    async (_label, read, accepts) => {
      assert.equal(accepts(await read()), true, 'hidden panel cannot pass native foreground gate');
      events.push('visible_gate');
    },
    async (_panel, expression) => {
      assert.equal(expression, 'document.visibilityState');
      return visibility;
    },
  );
  assert.deepEqual(events, ['web_closed', 'root_active', 'panel_reopened', 'visible_gate']);
});

test('member foreground gate refuses a panel that stays hidden', async () => {
  await assert.rejects(
    () =>
      restoration()(
        { close: async () => {} },
        { bringToFront: async () => {} },
        { reopenPanel: async () => {} },
        {},
        async (_label, read, accepts) => {
          assert.equal(
            accepts(await read()),
            true,
            'hidden panel cannot pass native foreground gate',
          );
        },
        async () => 'hidden',
      ),
    /hidden panel cannot pass native foreground gate/,
  );
});
