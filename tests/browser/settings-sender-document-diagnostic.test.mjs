import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';
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
  retirement_evidence: {
    sender_document: sender,
    open_panel_diagnostic: {
      availability: 'ready',
      ingress: true,
      open_invoked: true,
      open_settlement: 'resolved',
      send_response: 'unobservable_without_instrumented_build',
      private_data: 'must-not-persist',
    },
  },
});
const makeReport = () => ({
  status: 'pass',
  cases: [{ status: 'pass' }],
  reload_sender_document_diagnostic: {},
  reload_open_diagnostic: {},
});

// SUT: actual Settings driver options, replacement gate and persistence tail.
// Browser and filesystem are external doubles. No browser acceptance is claimed.
async function drive(
  enabled,
  sender = complete,
  acceptanceCase = 'settings-controls',
  openEnabled = false,
) {
  const processEnv = {
    MATRX_RELOAD_SENDER_DOCUMENT_DIAGNOSTIC: enabled ? '1' : '0',
    MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
    MATRX_SCRAPE_RELOAD_OPEN_DIAGNOSTIC: openEnabled ? '1' : '0',
  };
  const flagStart = source.indexOf('const RELOAD_SENDER_DOCUMENT_DIAGNOSTIC =');
  const flagEnd = source.indexOf('const CASE_IDS =', flagStart);
  const configured = new Function(
    'process',
    `${source.slice(flagStart, flagEnd)} return { sender: RELOAD_SENDER_DOCUMENT_DIAGNOSTIC, open: RELOAD_OPEN_DIAGNOSTIC };`,
  )({ env: processEnv });
  const scopeStart = source.indexOf(
    '  assert.ok(\n    !(RELOAD_SENDER_DOCUMENT_DIAGNOSTIC || RELOAD_OPEN_DIAGNOSTIC) ||',
  );
  const scopeEnd = source.indexOf('  const packageJson =', scopeStart);
  new Function(
    'assert',
    'process',
    'RELOAD_SENDER_DOCUMENT_DIAGNOSTIC',
    'RELOAD_OPEN_DIAGNOSTIC',
    source.slice(scopeStart, scopeEnd),
  )(assert, { env: processEnv }, configured.sender, configured.open);
  let options;
  const start = source.indexOf('  const result = await runNativeSidepanelQa({');
  const end = source.indexOf('  assert.equal(result.verified, true);', start);
  await new AsyncFunction(
    'runNativeSidepanelQa',
    'RELOAD_SENDER_DOCUMENT_DIAGNOSTIC',
    'RELOAD_OPEN_DIAGNOSTIC',
    'DEV_BUILD_RECEIPT',
    source.slice(start, end),
  )(
    async (value) => {
      options = value;
      return { verified: true };
    },
    configured.sender,
    configured.open,
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
    'RELOAD_OPEN_DIAGNOSTIC',
    'requireSettingsSenderDocumentReceipt',
    'captureLifecycleEvidence',
    'assert',
    `let guestStage; ${source.slice(gateStart, gateEnd)} return guestStage;`,
  )(
    report,
    async () => replacement(sender),
    configured.sender,
    configured.open,
    requireSettingsSenderDocumentReceipt,
    captureLifecycleEvidence,
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
    'RELOAD_OPEN_DIAGNOSTIC',
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
    configured.sender,
    configured.open,
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

// Captured run38103073242: sender refresh proved, then panel_poll failed.
for (const field of [null, ...Object.keys(complete)]) {
  test(`failed reload keeps honest sender receipt when ${field ?? 'all predicates hold'}`, () => {
    const report = makeReport();
    report.guestStageFailed = 'extension_reload';
    report.guestExtensionReloadFailure = {
      failure_code: 'native_extension_replacement_panel_unverified',
      transport_failure_class: 'none',
      retirement_evidence: {
        sender_document: field ? { ...complete, [field]: false } : complete,
      },
    };
    finalizeSettingsSenderDocumentDiagnostic(report, true);
    assert.equal(report.status, 'unverified');
    assert.equal(report.cases[0].status, 'unverified');
    if (field) {
      assert.equal(report.reload_sender_document_diagnostic.receipt, undefined);
      assert.equal(
        report.reload_sender_document_diagnostic.receipt_failure,
        'native_reload_sender_document_refresh_unverified',
      );
    } else {
      assert.deepEqual(report.reload_sender_document_diagnostic.receipt, complete);
      assert.equal(report.reload_sender_document_diagnostic.receipt_source, 'failed_reload');
      assert.equal(report.reload_sender_document_diagnostic.receipt_failure, undefined);
      assert.equal(report.failure.code, 'native_extension_replacement_panel_unverified');
    }
  });
}

test('Settings worker open diagnostic alone reaches harness and persists nonzero diagnostic verdict', async () => {
  const result = await drive(false, undefined, 'settings-controls', true);
  assert.equal(result.options.reloadOpenDiagnostic, true);
  assert.equal(result.persisted.reload_open_diagnostic.outcome.ingress, true);
  assert.equal(result.persisted.reload_open_diagnostic.outcome.open_invoked, true);
  assert.equal(result.persisted.reload_open_diagnostic.outcome.open_settlement, 'resolved');
  assert.equal(result.persisted.reload_open_diagnostic.outcome.private_data, undefined);
  assert.equal(result.options.reloadSenderDocumentDiagnostic, false);
  assert.equal(result.persisted.status, 'unverified');
  assert.equal(result.persisted.cases[0].evidence_class, 'diagnostic_only');
  assert.equal(result.persisted.reload_sender_document_diagnostic.receipt_failure, undefined);
  assert.equal(result.exitCode, 1);
});

test('Settings runner refuses worker open diagnostic outside exact hosted case', async () => {
  await assert.rejects(
    drive(false, undefined, 'settings-theme-rendering', true),
    /settings_sender_document_diagnostic_scope_refused/,
  );
});
