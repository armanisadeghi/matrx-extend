import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { observeNativeCdpStartup } from '../tests/browser/native-cdp-startup-diagnostic.mjs';
import { hostedNotesFindRoute } from './hosted-notes-find-route.mjs';
import { hostedSeoResourceDiagnostic } from './hosted-seo-route.mjs';

const workflowPath = new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url);
const parsedResult = spawnSync(
  'ruby',
  ['-ryaml', '-rjson', '-e', 'puts JSON.dump(YAML.load_file(ARGV[0]))', workflowPath.pathname],
  { encoding: 'utf8' },
);
assert.equal(parsedResult.status, 0, parsedResult.stderr);
const workflow = JSON.parse(parsedResult.stdout);
const dispatchInputs = (workflow.on ?? workflow.true).workflow_dispatch.inputs;
const admission = workflow.jobs.guest.steps[0];
const acceptance = workflow.jobs.guest.steps.find(
  (step) => step.name === 'Exercise the selected Chrome side-panel case',
);
test('hosted workflow dispatch stays within GitHub maximum of 25 top-level inputs', () => {
  assert.ok(
    Object.keys(dispatchInputs).length <= 25,
    'workflow_dispatch exceeds GitHub maximum of 25 inputs',
  );
});
const harnessSource = readFileSync(
  new URL('../tests/browser/native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const callsite = harnessSource
  .slice(
    harnessSource.indexOf('export async function connectNativeStartupOwnedCdp'),
    harnessSource.indexOf('\nconst wait ='),
  )
  .replace('export ', '');
const runnerSource = readFileSync(
  new URL('./hosted-guest-acceptance.mjs', import.meta.url),
  'utf8',
);
const childEnvStart = runnerSource.indexOf(
  '  const childEnv = {',
  runnerSource.indexOf('const notesFindRoute ='),
);
const childEnvSource = runnerSource.slice(
  childEnvStart,
  runnerSource.indexOf('  if (needsMemberLink)', childEnvStart),
);
const driverSource = runnerSource.slice(
  runnerSource.indexOf('    const driver =', childEnvStart),
  runnerSource.indexOf('    const child = spawn', childEnvStart),
);

function actualHostedChildEnv(env) {
  const prepared = {
    kind: 'ci_development_test',
    sourceSha: 'a'.repeat(40),
    runId: 123,
    artifactId: 456,
    extensionDir: '/owned/chrome-mv3',
    relocatedReceipt: '/owned/receipt.json',
  };
  const sandbox = {
    process: { env },
    join,
    prepared,
    packageDir: '/owned/browser-runtime',
    acceptanceCase: 'notes-find-member',
    extensionDir: prepared.extensionDir,
    relocatedReceipt: prepared.relocatedReceipt,
    scrapeRoute: null,
    scrapeSelection: null,
    scrapeSaveDestination: null,
    scrapeReloadDiagnostic: '0',
    seoRoute: null,
    needsApprovedAdminOrganization: false,
    showcaseRoute: null,
    tabGroupsRoute: null,
    nativeAiProbeRoute: null,
    notesFindRoute: hostedNotesFindRoute('notes-find-member', prepared, 'A'),
    memberLinkPath: '/owned/member.json',
    kind: prepared.kind,
  };
  const result = runInNewContext(
    `${childEnvSource}\n${driverSource}\n({ env: childEnv, driver });`,
    sandbox,
  );
  assert.equal(result.driver, 'tests/browser/notes-native-acceptance.mjs');
  return result.env;
}

// Evaluate the actual GitHub boolean expression; no duplicate input/env mapping.
function mapped(value, inputs) {
  if (!value) return undefined;
  const expression = value.match(/^\$\{\{ (.+) \}\}$/)?.[1];
  assert.ok(expression, 'diagnostic env must map a workflow input');
  return String(new Function('inputs', `return (${expression});`)(inputs));
}
function admit(inputs) {
  return spawnSync('bash', ['-euo', 'pipefail', '-c', admission.run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ACCEPTANCE_LANE: inputs.acceptance_lane,
      ACCEPTANCE_CASE: inputs.acceptance_case,
      NOTES_STARTUP_DIAGNOSTIC: mapped(admission.env.NOTES_STARTUP_DIAGNOSTIC, inputs) ?? '0',
      SCRAPE_AUTH_MODE: 'guest',
      SCRAPE_SAVE_DESTINATION: 'project',
      SCRAPE_SAVE_SCOPE: 'single',
      DESKTOP_SETTINGS_CASE: 'full',
      SEO_CASE_SCOPE: 'full',
      SEO_METADATA_FIXTURE: 'none',
      SEO_INTERRUPT_AFTER_TARGET: 'none',
      SEO_RESOURCE_DIAGNOSTIC: '0',
    },
  });
}
async function reachActualCallsite(inputs, cpuEnabled = false) {
  const mappedEnv = mapped(acceptance.env.MATRX_CDP_STARTUP_DIAGNOSTIC, inputs);
  assert.notEqual(
    mappedEnv,
    undefined,
    'Notes diagnostic input never reaches native harness environment',
  );
  const env = actualHostedChildEnv({ MATRX_CDP_STARTUP_DIAGNOSTIC: mappedEnv });
  const original = process.env.MATRX_CDP_STARTUP_DIAGNOSTIC;
  const cpuOriginal = process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC;
  const receipts = [];
  const boundaryError = new Error('owned_cdp_open_timeout');
  let connectorCalls = 0;
  try {
    process.env.MATRX_CDP_STARTUP_DIAGNOSTIC = env.MATRX_CDP_STARTUP_DIAGNOSTIC;
    process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC = cpuEnabled ? '1' : '0';
    // Activation seam owns admission, forwarding and selecting the observer.
    // Connector transport is covered with real local HTTP in the helper tests.
    const invoke = runInNewContext(`${callsite}; connectNativeStartupOwnedCdp`, {
      nativeCdpStartupDeadlineMs: async () => 8000,
      connectOwnedCdp: async () => {
        connectorCalls++;
        throw boundaryError;
      },
      observeNativeCdpStartup: (options, connect) =>
        observeNativeCdpStartup(options, connect, { emit: (receipt) => receipts.push(receipt) }),
    });
    await assert.rejects(invoke({}), (error) => error === boundaryError);
    assert.equal(connectorCalls, 1);
    return receipts;
  } finally {
    if (original === undefined) Reflect.deleteProperty(process.env, 'MATRX_CDP_STARTUP_DIAGNOSTIC');
    else process.env.MATRX_CDP_STARTUP_DIAGNOSTIC = original;
    if (cpuOriginal === undefined)
      Reflect.deleteProperty(process.env, 'MATRX_STARTUP_INTERVAL_DIAGNOSTIC');
    else process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC = cpuOriginal;
  }
}

test('Notes A diagnostic dispatch reaches actual native callsite only when requested', async () => {
  assert.equal(
    dispatchInputs.startup_display_mode?.type,
    'choice',
    'Notes diagnostic needs a reachable workflow choice',
  );
  assert.equal(dispatchInputs.startup_display_mode.default, 'headed');
  assert.ok(dispatchInputs.startup_display_mode.options.includes('notes-cdp'));
  for (const enabled of [true, false]) {
    const inputs = {
      acceptance_case: 'notes-find-member',
      acceptance_lane: 'A',
      startup_display_mode: enabled ? 'notes-cdp' : 'headed',
    };
    const admitted = admit(inputs);
    assert.equal(admitted.status, 0, admitted.stderr);
    const receipts = await reachActualCallsite(inputs);
    assert.equal(
      receipts.length,
      enabled ? 1 : 0,
      'workflow input was lost before the actual owned-CDP callsite',
    );
    if (enabled) assert.equal(receipts[0].outcome, 'failed');
    // Notes does not borrow the SEO-only resource diagnostic route.
    hostedSeoResourceDiagnostic('notes-find-member', 'full', 'none', '0');
    assert.equal(
      mapped(acceptance.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC, { seo_diagnostic: 'none' }),
      '0',
    );
  }
});

test('Notes startup diagnostic admission refuses other cases and lane B', () => {
  for (const [acceptance_case, acceptance_lane] of [
    ['notes-find-member', 'B'],
    ['guest-data', 'B'],
    ['guest-seo', 'A'],
    ['native-ai-member-probe', 'A'],
    ['startup-resource-diagnostic', 'A'],
  ]) {
    const result = admit({ acceptance_case, acceptance_lane, startup_display_mode: 'notes-cdp' });
    assert.notEqual(
      result.status,
      0,
      `Notes diagnostic escaped admission onto ${acceptance_case}/${acceptance_lane}`,
    );
  }
  assert.equal(
    admit({ acceptance_case: 'guest-data', acceptance_lane: 'B', startup_display_mode: 'headed' })
      .status,
    0,
  );
});

test('headed and headless startup diagnostics retain their original display mapping', () => {
  const startup = workflow.jobs.guest.steps.find(
    (step) => step.name === 'Measure owned Chromium startup during the existing guard interval',
  );
  for (const startup_display_mode of ['headed', 'headless']) {
    const inputs = {
      acceptance_case: 'startup-resource-diagnostic',
      acceptance_lane: 'A',
      startup_display_mode,
    };
    assert.ok(dispatchInputs.startup_display_mode.options.includes(startup_display_mode));
    assert.equal(admit(inputs).status, 0);
    assert.equal(mapped(startup.env.MATRX_STARTUP_DISPLAY_MODE, inputs), startup_display_mode);
    assert.equal(mapped(acceptance.env.MATRX_CDP_STARTUP_DIAGNOSTIC, inputs), '0');
  }
});

test('existing SEO CPU diagnostic flag cannot activate the new CDP handshake probe', async () => {
  const receipts = await reachActualCallsite(
    { acceptance_case: 'notes-find-member', acceptance_lane: 'A', startup_display_mode: 'headed' },
    true,
  );
  assert.equal(receipts.length, 0);
});
