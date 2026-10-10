import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { recordDataMemberDriverDiagnostic } from './data-member-driver-diagnostic.mjs';
import {
  refuseDiagnosticAcceptance,
  reloadOpenEvidenceClass,
} from './scrape-reload-open-diagnostic.mjs';

const source = await readFile(
  new URL('./data-member-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('  await runNativeSidepanelQa({');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// SUT owns the actual driver options, terminal verdict, and persisted report.
// Browser execution and artifact filesystem are external; no native acceptance is claimed.
async function drive(flag, fail = false, senderFlag = '0') {
  const report = { observations: {}, stage: 'input' };
  const process = {
    env: {
      MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC: flag,
      MATRX_RELOAD_SENDER_DOCUMENT_DIAGNOSTIC: senderFlag,
    },
    exitCode: 0,
    stderr: { write() {} },
  };
  let options;
  let persisted;
  const run = new AsyncFunction(
    'report',
    'process',
    'runNativeSidepanelQa',
    'join',
    'tmpdir',
    'mkdir',
    'writeFile',
    'refuseDiagnosticAcceptance',
    'reloadOpenEvidenceClass',
    'recordDataMemberDriverDiagnostic',
    `
    const extensionDir = '/owned/development', receiptPath = '/owned/receipt', receipt = {}, fixture = '', output = 'owned.json';
    ${source.match(/const RELOAD_OPEN_DIAGNOSTIC = [^;]+;/)?.[0] ?? ''}
    ${source.match(/const RELOAD_SENDER_DOCUMENT_DIAGNOSTIC =\s*[^;]+;/)?.[0] ?? ''}
    const safeFailureCode = () => 'native_acceptance_error';
    try { ${source.slice(start)}
  `,
  );
  await run(
    report,
    process,
    async (value) => {
      options = value;
      if (fail) throw new Error('injected browser failure');
    },
    (...parts) => parts.join('/'),
    () => '/owned',
    async () => {},
    async (_path, value) => {
      persisted = JSON.parse(value);
    },
    refuseDiagnosticAcceptance,
    reloadOpenEvidenceClass,
    recordDataMemberDriverDiagnostic,
  );
  return { options, persisted, exitCode: process.exitCode };
}

test('member Data propagates opt-in and cannot persist acceptance credit for a perturbed run', async () => {
  for (const flag of ['0', '1']) {
    const result = await drive(flag);
    assert.equal(
      result.options.reloadOpenDiagnostic === true,
      flag === '1',
      'member diagnostic wire missing',
    );
    assert.equal(result.persisted.status, flag === '1' ? 'unverified' : 'pass');
    assert.equal(result.exitCode, flag === '1' ? 1 : 0);
    if (flag === '1')
      assert.equal(result.persisted.failure.code, 'diagnostic_only_perturbed_lifecycle');
  }
});

test('member Data diagnostic failure retains the original failure and remains diagnostic-only', async () => {
  const result = await drive('1', true);
  assert.equal(result.persisted.status, 'unverified');
  assert.equal(result.persisted.error_code, 'native_acceptance_error');
  assert.equal(result.exitCode, 1);
});

for (const flag of ['0', '1']) {
  test(`member Data sender refresh ${flag} propagates and refuses diagnostic acceptance`, async () => {
    const result = await drive('0', false, flag);
    assert.equal(result.options.reloadSenderDocumentDiagnostic, flag === '1');
    assert.equal(result.persisted.status, flag === '1' ? 'unverified' : 'pass');
    assert.equal(result.exitCode, flag === '1' ? 1 : 0);
    if (flag === '1')
      assert.equal(result.persisted.failure.code, 'diagnostic_only_perturbed_lifecycle');
  });
}
