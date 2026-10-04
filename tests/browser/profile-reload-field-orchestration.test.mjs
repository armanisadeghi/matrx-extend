import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extendedCaseCensus } from './profile-extended-census.mjs';
import { runProfileExecutionBoundary } from './profile-native-failure.mjs';

const source = await readFile(new URL('./profile-native-acceptance.mjs', import.meta.url), 'utf8');
const caseSource = await readFile(
  new URL('./profile-identity-employment-cases.mjs', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
function section(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'runner_section_unavailable');
  return text.slice(first, last);
}

test('runner rejects a saved field lost only during extension reload before restoration or another edit', async () => {
  const steps = [];
  const desired = { 'First name': 'Marin', 'Last name': 'Vale' };
  const observed = { ...desired };
  const receipt = { observed: {} };
  const verifyFactory = new AsyncFunction(
    'assert',
    'ensureOpen',
    'sample',
    'equalFields',
    'section',
    'labels',
    'desired',
    'receipt',
    `return ({${section(caseSource, 'async verifyReload(activePanel) {', 'async restore(activePanel) {')}}).verifyReload;`,
  );
  const verifyReload = await verifyFactory(
    assert,
    async () => steps.push('reload_read'),
    async () => ({ values: observed, card_name: 'Marin Vale' }),
    (actual, expected, label) => {
      for (const [field, value] of Object.entries(expected))
        assert.equal(actual.values[field], value, `${label}_${field}_mismatch`);
    },
    'Identity',
    Object.keys(desired),
    desired,
    receipt,
  );
  const heldFieldCases = [
    {
      receipt: { id: 'EXT-F-1004-T05' },
      verifyReload,
      async restore() {
        steps.push('restore');
      },
    },
  ];
  const run = new AsyncFunction(
    'heldFieldCases',
    'reloaded',
    'steps',
    `${section(source, "executionOperation = 'verify_saved_fields_after_extension_reload';", "executionOperation = 'case_back_after_reload';")} return steps;`,
  );
  observed['First name'] = 'Original name'; // Ordinary save/reopen was sound; reload lost one field.
  await assert.rejects(
    run(heldFieldCases, { panel: {} }, steps),
    /Identity_extension_reload_First name_mismatch/,
  );
  assert.deepEqual(steps, ['reload_read']);
  observed['First name'] = 'Marin';
  await run(heldFieldCases, { panel: {} }, steps);
  assert.deepEqual(steps.slice(1), ['reload_read', 'restore']);
});

test('failure boundary retains distinct extended case attribution after cleanup', async () => {
  const run = new AsyncFunction(
    'heldFieldCases',
    'reloaded',
    'runProfileExecutionBoundary',
    'report',
    `let executionOperation = 'open_profile_after_reload';
     const failure = await runProfileExecutionBoundary(report, async () => {
       ${section(source, "executionOperation = 'verify_saved_fields_after_extension_reload';", "executionOperation = 'case_back_after_reload';")}
     }, { getOperation: () => executionOperation, readUiState: async () => null });
     executionOperation = 'cleanup';
     return failure;`,
  );
  for (const [id, message] of [
    ['EXT-F-1004-T05', 'Identity_extension_reload_First name_mismatch'],
    ['EXT-F-1004-T17', 'Employment_extension_reload_Company_mismatch'],
  ]) {
    const report = { stage: 'extension_reload' };
    const held = [
      {
        receipt: { id },
        verifyReload: async () => {
          throw new Error(message);
        },
      },
    ];
    assert.ok(await run(held, { panel: {} }, runProfileExecutionBoundary, report));
    assert.equal(report.execution_failure.operation, `${id}:extension_reload:verify`);
    assert.equal(report.execution_failure_code, 'profile_unclassified_failure');
    assert.deepEqual(Object.keys(report.execution_failure).sort(), ['operation', 'stage']);
    assert.equal(JSON.stringify(report).includes(message), false);
  }
});

test('actual runner verdict stays partial when an extended case dimension is missing', async () => {
  const cases = [
    ...['EXT-F-1004-T05', 'EXT-F-1004-T17', 'EXT-F-1004-T21'].flatMap((id) =>
      ['warm', 'extension_reload'].map((dimension) => ({
        id,
        mode: 'member',
        dimension,
        status: 'passed',
      })),
    ),
  ];
  const runVerdict = new AsyncFunction(
    'report',
    'EXTENDED_CASES',
    'extendedCaseCensus',
    'AUTH_MODE',
    `${section(source, 'if (EXTENDED_CASES) report.extended_census = extendedCaseCensus', "report.stage = 'complete';")} return report;`,
  );
  const complete = await runVerdict(
    { cases, scope: 'extended' },
    true,
    extendedCaseCensus,
    'member',
  );
  assert.equal(complete.status, 'passed');
  const incomplete = await runVerdict(
    {
      scope: 'extended',
      cases: cases.filter(
        (entry) => !(entry.id === 'EXT-F-1004-T17' && entry.dimension === 'extension_reload'),
      ),
    },
    true,
    extendedCaseCensus,
    'member',
  );
  assert.equal(incomplete.status, 'partial');
  assert.equal(
    incomplete.extended_census.cells.find(
      (cell) => cell.id === 'EXT-F-1004-T17' && cell.dimension === 'extension_reload',
    ).status,
    'missing',
  );
  const base = await runVerdict({ cases: [], scope: 'base' }, false, extendedCaseCensus, 'member');
  assert.equal(base.status, 'passed');
  assert.equal(base.scope, 'base');
  cases[0].status = 'unverified';
  assert.equal((await runVerdict({ cases }, true, extendedCaseCensus, 'member')).status, 'partial');
});
