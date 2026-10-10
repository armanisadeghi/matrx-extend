import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';

const source = await readFile(
  new URL('./data-member-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const fixtureStart = source.indexOf('const cards =');
const fixtureEnd = source.indexOf('const report =', fixtureStart);
const html = new Function(`${source.slice(fixtureStart, fixtureEnd)} return fixture;`)();
const replayStart = source.indexOf('        const expectedRows =');
const replayEnd = source.indexOf("        await runAndCopy('before_reload');", replayStart);
const replay = new AsyncFunction(
  'assert',
  'report',
  'panel',
  'native',
  'click',
  'waitFor',
  'extractionState',
  'copyRows',
  `${source.slice(replayStart, replayEnd)} await runAndCopy('before_reload');`,
);

async function runReplay(priceSelector) {
  const window = new Window();
  window.document.body.innerHTML = html;
  // Same selected elements as the native picker: first name, second card price.
  const rows = [
    {
      field_1: window.document.querySelector('.product-card:nth-of-type(1) .product-name')
        .textContent,
      field_2: window.document.querySelector(priceSelector).textContent,
    },
  ];
  const report = { observations: {} };
  const native = { browserSession: {}, panelTarget: {} };
  const extractionState = async () => ({ parseable: true, rows });
  const waitFor = async (_label, read, accept) => {
    const state = await read();
    assert.equal(accept(state), true, 'replay must observe extracted rows');
    return state;
  };
  const copyRows = async (_panel, _browser, _target, format) => {
    if (format === 'JSON') return JSON.stringify(rows);
    if (format === 'For AI agent')
      return 'structured data extracted from a webpage using a saved pattern\nRow count: 1\nCedar chair';
    return `field_1\tfield_2\n${rows[0].field_1}\t${rows[0].field_2}`;
  };
  try {
    await replay(assert, report, {}, native, async () => {}, waitFor, extractionState, copyRows);
    return report;
  } finally {
    window.close();
  }
}

test('member replay accepts the second-card price selected by the native picker', async () => {
  const report = await runReplay('.product-card:nth-of-type(2) .product-price');
  assert.equal(report.stage, 'copy_ai_before_reload');
  assert.equal(report.observations.saved_pattern_run_before_reload, true);
  assert.equal(report.observations.clipboard_before_reload.tsv_matches_fixture, true);
});

test('member replay rejects a selector that drifts to the first-card price', async () => {
  await assert.rejects(runReplay('.product-card:nth-of-type(1) .product-price'), {
    message: /^data_member_saved_pattern_rows_mismatch_before_reload/,
  });
});

const codeStart = source.indexOf('function safeFailureCode(');
const codeEnd = source.indexOf('\nasync function ', codeStart);
const safeFailureCode = new Function(
  `${source.slice(codeStart, codeEnd)} return safeFailureCode;`,
)();
test('member failure retains allowlisted pointer category without raw exception text', () => {
  assert.equal(
    safeFailureCode({
      message: 'https://private.invalid/?secret=credential',
      driverFailure: {
        code: 'pointer_stable_hit_not_observed',
      },
    }),
    'pointer_stable_hit_not_observed',
  );
});
test('member failure retains assertion category before Node assertion diff', () => {
  assert.equal(
    safeFailureCode({
      message:
        'data_member_saved_pattern_rows_mismatch_before_reload\n+ actual - expected\nprivate data',
    }),
    'data_member_saved_pattern_rows_mismatch_before_reload',
  );
});
test('member failure refuses arbitrary driver categories and raw messages', () => {
  assert.equal(
    safeFailureCode({
      message: 'https://private.invalid/?secret=credential',
      driverFailure: {
        code: 'credential_value',
      },
    }),
    'native_acceptance_error',
  );
});
