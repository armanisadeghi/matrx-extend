import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolveBrowserRuntime } from './browser-runtime.mjs';
import { readD47SavedResult } from './showcase-d47-saved-result.mjs';
import { waitD47SavedTerminal } from './showcase-d47-terminal-budget.mjs';

if (
  process.env.D47_READER_MUTANT &&
  !['constant_success', 'permissive_preview', 'event_name_only'].includes(
    process.env.D47_READER_MUTANT,
  )
) {
  throw new Error('unrecognized_d47_reader_mutant');
}

let browser;
let page;
before(async () => {
  const runtime = await resolveBrowserRuntime();
  browser = await runtime.chromium.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
  page = await browser.newPage();
});
after(async () => browser?.close());

const recipe = 'Codex D47 document race exact';
const markup = ({
  header = `Last run: ${recipe}`,
  hidden = false,
  row = '[{"eventName":"Canyon Frequency"}]</td><td>current',
  elsewhere = '',
} = {}) => `
  <style>.uppercase { text-transform: uppercase }</style>
  <div id="outside">${elsewhere}</div>
  <div class="space-y-1">
    <div class="uppercase" ${hidden ? 'style="display:none"' : ''}>${header}</div>
    <div class="space-y-2">
      <div class="flex items-center justify-between"><div class="uppercase">1 row</div><div>Table</div></div>
      <div class="overflow-auto"><table class="w-full"><thead><tr><th>events</th><th>document</th></tr></thead><tbody><tr><td>${row}</td></tr></tbody></table></div>
    </div>
  </div>`;

async function observe(html) {
  await page.setContent(html);
  const readerSource =
    process.env.D47_READER_MUTANT === 'constant_success'
      ? '() => ({ exact_recipe: true, current_row: true, old_row: false, header_status: "exact", preview_status: "current_only" })'
      : process.env.D47_READER_MUTANT === 'event_name_only'
        ? readD47SavedResult.toString().replace(
            /const exactResult =[\s\S]*?;\n/,
            `const exactResult = tables.length === 1 && headings.length === 1 &&
              headings[0].textContent.trim() === 'eventName' && rows.length === 1 &&
              cells.length === 1 && cells[0].textContent.trim() === 'Canyon Frequency';\n`,
          )
        : process.env.D47_READER_MUTANT === 'permissive_preview'
          ? readD47SavedResult
              .toString()
              .replace('previewVisible && exactResult)', 'previewVisible && currentCell)')
          : readD47SavedResult.toString();
  // The reader runs inside the page as a Playwright expression string built from its
  // source, so the page never needs eval to rebuild it.
  const expected = JSON.stringify(recipe);
  const oldNeedle = JSON.stringify(`Last run: ${recipe}`);
  return page.evaluate(`({
    old_predicate: document.body.innerText.includes(${oldNeedle}),
    saved: (${readerSource})(document, ${expected}),
  })`);
}

// Native driver selects the response then saves without clicking JsonTree: key_path=[].
// rowsFromBody returns the root; ResultPreview renders events as compact JSON plus document.
test('actual root preview is accepted while CSS uppercase defeats the old body innerText predicate but preserves exact source identity', async () => {
  const result = await observe(markup());
  assert.equal(result.old_predicate, false);
  assert.equal(result.saved.exact_recipe, true);
  assert.equal(result.saved.current_row, true);
  assert.equal(result.saved.old_row, false);
  assert.equal(result.saved.header_status, 'exact');
  assert.equal(result.saved.preview_status, 'current_only');
});

test('a different or prefix-matching recipe does not certify the saved result', async () => {
  for (const header of ['Last run: Other Recipe', `Last run: ${recipe} extra`]) {
    const result = await observe(markup({ header }));
    assert.equal(result.saved.exact_recipe, false);
    assert.equal(result.saved.current_row, false);
  }
});

test('a hidden header does not certify a stale preview', async () => {
  const result = await observe(markup({ hidden: true }));
  assert.equal(result.saved.exact_recipe, false);
  assert.equal(result.saved.current_row, false);
});

test('the current row must be in the preview associated with the exact header', async () => {
  const result = await observe(
    markup({ row: '[{"eventName":"Moonlit Transit"}]</td><td>old', elsewhere: 'Canyon Frequency' }),
  );
  assert.equal(result.saved.exact_recipe, true);
  assert.equal(result.saved.current_row, false);
  assert.equal(result.saved.old_row, true);
  assert.equal(result.saved.preview_status, 'old_only');
});

test('a preview containing both current and old rows cannot certify the terminal result', async () => {
  const result = await observe(
    markup({
      row: '[{"eventName":"Canyon Frequency"},{"eventName":"Moonlit Transit"}]</td><td>current',
    }),
  );
  assert.equal(result.saved.exact_recipe, true);
  assert.equal(result.saved.current_row, false);
  assert.equal(result.saved.old_row, true);
  assert.equal(result.saved.preview_status, 'mixed');
  let clock = 0;
  await assert.rejects(
    waitD47SavedTerminal({
      budget: { timeout_ms: 1, poll_ms: 1 },
      read: async () => result.saved,
      record: () => {},
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    }),
    /saved_current_result_not_observed/,
  );
});

test('a current cell alongside any unexpected saved result cannot certify the terminal result', async () => {
  const cases = [
    markup({
      row: '[{"eventName":"Canyon Frequency"},{"eventName":"Wrong Frequency"}]</td><td>current',
    }),
    markup({
      row: '[{"eventName":"Canyon Frequency"},{"eventName":"Canyon Frequency"}]</td><td>current',
    }),
    markup({ row: '[{"eventName":"Canyon Frequency"}]</td><td>old' }),
    markup({ row: '[{"eventName":"Canyon Frequency","unexpected":true}]</td><td>current' }),
    markup().replace(
      '</tbody>',
      '<tr><td>[{"eventName":"Wrong Frequency"}]</td><td>current</td></tr></tbody>',
    ),
    markup()
      .replace('<th>document</th>', '<th>document</th><th>extra</th>')
      .replace('current</td>', 'current</td><td>unexpected</td>'),
    markup({ row: 'Canyon Frequency' }).replace(
      '<th>events</th><th>document</th>',
      '<th>eventName</th>',
    ),
  ];
  for (const html of cases) {
    const result = await observe(html);
    assert.equal(result.saved.exact_recipe, true);
    assert.equal(result.saved.current_row, false);
    let clock = 0;
    await assert.rejects(
      waitD47SavedTerminal({
        budget: { timeout_ms: 1, poll_ms: 1 },
        read: async () => result.saved,
        record: () => {},
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
      /saved_current_result_not_observed/,
    );
  }
});

test('a renamed result column cannot certify the saved recipe', async () => {
  const result = await observe(markup().replace('<th>events</th>', '<th>wrongName</th>'));
  assert.equal(result.saved.exact_recipe, true);
  assert.equal(result.saved.current_row, false);
});
