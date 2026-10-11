import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  finalizeSettingsSenderDocumentDiagnostic,
  requireSettingsSenderDocumentReceipt,
} from './settings-sender-document-diagnostic.mjs';

const source = await readFile(
  new URL('./settings-local-controls-acceptance.mjs', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const complete = {
  refresh_requested: true,
  refresh_completed: true,
  new_document_observed: true,
  same_url_observed: true,
};
const replacement = (sender = complete) => ({
  management_reload_clicked: true,
  old_targets_retired: true,
  worker_replaced: true,
  panel_replaced: true,
  retirement_evidence: { sender_document: sender },
});
const makeReport = () => ({
  status: 'pass',
  cases: [{ status: 'pass' }],
  reload_sender_document_diagnostic: {},
});

// SUT: actual Settings driver options, replacement gate and persistence tail.
// Browser and filesystem are external doubles. No browser acceptance is claimed.
async function drive(enabled, sender = complete, acceptanceCase = 'settings-controls') {
  const processEnv = {
    MATRX_RELOAD_SENDER_DOCUMENT_DIAGNOSTIC: enabled ? '1' : '0',
    MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
  };
  const flagStart = source.indexOf('const RELOAD_SENDER_DOCUMENT_DIAGNOSTIC =');
  const flagEnd = source.indexOf('const CASE_IDS =', flagStart);
  const configured = new Function(
    'process',
    `${source.slice(flagStart, flagEnd)} return RELOAD_SENDER_DOCUMENT_DIAGNOSTIC;`,
  )({ env: processEnv });
  const scopeStart = source.indexOf('  assert.ok(\n    !RELOAD_SENDER_DOCUMENT_DIAGNOSTIC ||');
  const scopeEnd = source.indexOf('  const packageJson =', scopeStart);
  new Function(
    'assert',
    'process',
    'RELOAD_SENDER_DOCUMENT_DIAGNOSTIC',
    source.slice(scopeStart, scopeEnd),
  )(assert, { env: processEnv }, configured);
  let options;
  const start = source.indexOf('  const result = await runNativeSidepanelQa({');
  const end = source.indexOf('  assert.equal(result.verified, true);', start);
  await new AsyncFunction(
    'runNativeSidepanelQa',
    'RELOAD_SENDER_DOCUMENT_DIAGNOSTIC',
    'DEV_BUILD_RECEIPT',
    source.slice(start, end),
  )(
    async (value) => {
      options = value;
      return { verified: true };
    },
    configured,
    undefined,
  );
  const report = makeReport();
  const gateStart = source.indexOf("        guestStage = 'extension_reload';");
  const gateEnd =
    source.indexOf("        guestStage = 'reload_settings';", gateStart) +
    "        guestStage = 'reload_settings';".length;
  const stage = await new AsyncFunction(
    'report',
    'reloadExtension',
    'RELOAD_SENDER_DOCUMENT_DIAGNOSTIC',
    'requireSettingsSenderDocumentReceipt',
    'assert',
    `let guestStage; ${source.slice(gateStart, gateEnd)} return guestStage;`,
  )(
    report,
    async () => replacement(sender),
    configured,
    requireSettingsSenderDocumentReceipt,
    assert,
  );
  const tail = source.slice(
    source.indexOf('  const diagnosticOnly = finalizeSettingsSenderDocumentDiagnostic('),
    source.lastIndexOf('\n}'),
  );
  let persisted;
  const process = { exitCode: 0 };
  await new AsyncFunction(
    'report',
    'RELOAD_SENDER_DOCUMENT_DIAGNOSTIC',
    'finalizeSettingsSenderDocumentDiagnostic',
    'mkdir',
    'join',
    'REPO',
    'writeFile',
    'OUTPUT',
    'console',
    'process',
    tail,
  )(
    report,
    configured,
    finalizeSettingsSenderDocumentDiagnostic,
    async () => {},
    (...parts) => parts.join('/'),
    '/owned',
    async (_path, value) => {
      persisted = JSON.parse(value);
    },
    '/owned/report.json',
    { log() {}, error() {} },
    process,
  );
  return { options, stage, persisted, exitCode: process.exitCode };
}

for (const enabled of [false, true]) {
  test(`Settings sender diagnostic ${enabled} reaches harness and persists an honest verdict`, async () => {
    const result = await drive(enabled);
    assert.equal(result.options.reloadSenderDocumentDiagnostic, enabled);
    assert.equal(result.stage, 'reload_settings');
    assert.equal(result.persisted.status, enabled ? 'unverified' : 'pass');
    assert.equal(result.persisted.cases[0].status, enabled ? 'unverified' : 'pass');
    assert.equal(result.exitCode, enabled ? 1 : 0);
    if (enabled) {
      assert.deepEqual(result.persisted.reload_sender_document_diagnostic.receipt, complete);
      assert.equal(result.persisted.failure.code, 'diagnostic_only_perturbed_lifecycle');
    }
  });
}

for (const field of Object.keys(complete)) {
  test(`diagnostic rejects replacement before Settings when ${field} was not proven`, async () => {
    await assert.rejects(
      drive(true, { ...complete, [field]: false }),
      /native_reload_sender_document_refresh_unverified/,
    );
  });
}

test('ordinary control needs no sender refresh receipt', async () => {
  const result = await drive(false, undefined);
  assert.equal(result.persisted.status, 'pass');
  assert.equal(result.persisted.reload_sender_document_diagnostic.receipt, undefined);
});

test('diagnostic with no replacement receipt records the missing proof and cannot earn credit', () => {
  const report = makeReport();
  finalizeSettingsSenderDocumentDiagnostic(report, true);
  assert.equal(report.status, 'unverified');
  assert.equal(report.failure.code, 'native_reload_sender_document_refresh_unverified');
  assert.equal(
    report.reload_sender_document_diagnostic.receipt_failure,
    'native_reload_sender_document_refresh_unverified',
  );
});

test('diagnostic preserves failed case evidence and the original failure', () => {
  const report = makeReport();
  report.cases.push({ status: 'fail' });
  report.failure = { stage: 'panel_poll', code: 'native_extension_replacement_panel_unverified' };
  finalizeSettingsSenderDocumentDiagnostic(report, true);
  assert.equal(report.cases[1].status, 'fail');
  assert.equal(report.failure.code, 'native_extension_replacement_panel_unverified');
});

test('Settings runner refuses sender diagnostic outside its exact hosted case', async () => {
  await assert.rejects(
    drive(true, complete, 'settings-theme-rendering'),
    /settings_sender_document_diagnostic_scope_refused/,
  );
});
