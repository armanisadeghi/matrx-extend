import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import {
  classifySeoResourceDiagnosticReport,
  hostedGuestSeoRoute,
  hostedSeoMetadataFixture,
  hostedSeoResourceDiagnostic,
  seoStartupObservationOptions,
  writeSeoGuestReport,
} from './hosted-seo-route.mjs';
import * as seoRoute from './hosted-seo-route.mjs';
import { buildEvidenceRecord } from './record-stabilization-evidence.mjs';

const selected = {
  kind: 'ci_development_test',
  eligibleStore: false,
  extensionDir: '/tmp/ci-artifacts/42/77/chrome-mv3',
  relocatedReceipt: '/tmp/ci-artifacts/42/77/local-dev-receipt.json',
};

test('guest SEO passes the selected development artifact and receipt to the existing driver', () => {
  assert.deepEqual(hostedGuestSeoRoute('guest-seo', 'development', selected), {
    driver: 'tests/browser/seo-guest-acceptance.mjs',
    env: {
      SEO_GUEST_EXTENSION_DIR: selected.extensionDir,
      SEO_GUEST_DEV_BUILD_RECEIPT: selected.relocatedReceipt,
      SEO_GUEST_CASE_SCOPE: 'full',
      SEO_GUEST_METADATA_FIXTURE: undefined,
      SEO_GUEST_INTERRUPT_AFTER_TARGET: undefined,
    },
  });
  assert.equal(hostedGuestSeoRoute('guest-chat', 'development', selected), null);
});

test('readability scope routes only through guest SEO and rejects invalid scope selections', () => {
  const route = hostedGuestSeoRoute('guest-seo', 'development', selected, 'readability');
  assert.equal(route.env.SEO_GUEST_CASE_SCOPE, 'readability');
  assert.equal(route.env.SEO_GUEST_METADATA_FIXTURE, undefined);
  assert.equal(route.env.SEO_GUEST_INTERRUPT_AFTER_TARGET, undefined);
  assert.equal(hostedGuestSeoRoute('guest-chat', 'development', selected), null);
  assert.throws(
    () => hostedGuestSeoRoute('guest-chat', 'development', selected, 'readability'),
    /seo_scope_requires_guest_seo/,
  );
  assert.throws(
    () => hostedGuestSeoRoute('guest-seo', 'development', selected, 'readability-only'),
    /unknown_seo_case_scope/,
  );
});

test('metadata fixtures are explicit, SEO-only, and scope-bound', () => {
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'full', 'airbnb'), 'airbnb');
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'metadata', 'owned'), 'owned');
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'full', 'none'), undefined);
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'full', undefined), undefined);
  for (const [acceptanceCase, scope, fixture] of [
    ['guest-chat', 'full', 'airbnb'],
    ['guest-seo', 'controlled', 'airbnb'],
    ['guest-seo', 'full', 'unknown'],
  ])
    assert.throws(() => hostedSeoMetadataFixture(acceptanceCase, scope, fixture));
  assert.equal(
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'full', 'airbnb').env
      .SEO_GUEST_METADATA_FIXTURE,
    'airbnb',
  );
  assert.throws(() => hostedGuestSeoRoute('guest-chat', 'development', selected, 'full', 'airbnb'));
  assert.throws(() => hostedGuestSeoRoute('guest-seo', 'development', selected, 'full', 'bad'));
  assert.throws(() =>
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'controlled', 'airbnb'),
  );
});

test('owned metadata fixture routes one T09 target only on lane-B metadata scope', () => {
  assert.equal(hostedSeoMetadataFixture('guest-seo', 'metadata', 'owned'), 'owned');
  assert.deepEqual(
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'metadata', 'owned').env,
    {
      SEO_GUEST_EXTENSION_DIR: selected.extensionDir,
      SEO_GUEST_DEV_BUILD_RECEIPT: selected.relocatedReceipt,
      SEO_GUEST_CASE_SCOPE: 'metadata',
      SEO_GUEST_METADATA_FIXTURE: 'owned',
      SEO_GUEST_INTERRUPT_AFTER_TARGET: undefined,
    },
  );
  for (const [acceptanceCase, scope, fixture] of [
    ['guest-chat', 'metadata', 'owned'],
    ['guest-seo', 'full', 'owned'],
    ['guest-seo', 'metadata', 'airbnb'],
    ['guest-seo', 'controlled', 'owned'],
  ])
    assert.throws(() => hostedSeoMetadataFixture(acceptanceCase, scope, fixture));
  assert.throws(
    () => hostedGuestSeoRoute('guest-seo', 'development', selected, 'metadata', 'none'),
    /owned_metadata_fixture_requires_metadata_scope/,
  );
});

test('resource bracket requires explicit full Airbnb SEO diagnostic and cannot produce acceptance targets', () => {
  assert.equal(hostedSeoResourceDiagnostic('guest-seo', 'full', 'airbnb', '0'), false);
  assert.equal(hostedSeoResourceDiagnostic('guest-seo', 'full', 'airbnb', '1'), true);
  for (const [acceptanceCase, scope, fixture, enabled] of [
    ['guest-chat', 'full', 'airbnb', '1'],
    ['guest-seo', 'controlled', 'airbnb', '1'],
    ['guest-seo', 'full', 'none', '1'],
    ['guest-seo', 'full', 'airbnb', 'true'],
  ])
    assert.throws(() => hostedSeoResourceDiagnostic(acceptanceCase, scope, fixture, enabled));
  const ordinary = { status: 'partial', targets: [{ case: 'T09', status: 'passed' }] };
  assert.equal(classifySeoResourceDiagnosticReport(ordinary, false), ordinary);
  assert.deepEqual(classifySeoResourceDiagnosticReport(ordinary, true), {
    status: 'diagnostic_only',
    diagnostic_source_status: 'partial',
    targets: [],
    diagnostic_targets: [{ case: 'T09', status: 'passed' }],
    evidence_classification: 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT',
  });
  assert.deepEqual(ordinary.targets, [{ case: 'T09', status: 'passed' }]);
});

test('headless SEO timeout observation survives native failure without acceptance credit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-startup-observation-'));
  try {
    const path = join(directory, 'seo.json');
    const report = {
      status: 'unverified',
      targets: [{ case_id: 'EXT-F-1008-T09', status: 'pass' }],
    };
    const options = await seoStartupObservationOptions(report, true);
    assert.equal(options.startupEndpointObservationMs, 15_000);
    const nativeRunner = async ({ headed, onStartupEndpointObservation }) => {
      assert.equal(headed, false);
      await onStartupEndpointObservation({
        phase: 'cdp_timeout',
        endpointPresent: false,
        inspectionFailed: false,
        exitObserved: false,
        elapsedMs: 5022,
        polls: 116,
        privatePath: '/owned/profile',
      });
      await onStartupEndpointObservation({
        phase: 'post_timeout',
        endpointPresent: true,
        inspectionFailed: false,
        exitObserved: false,
        elapsedMs: 300,
        polls: 4,
        privatePath: '/owned/profile',
      });
      throw new Error('owned_cdp_endpoint_timeout');
    };
    await assert.rejects(nativeRunner({ headed: false, ...options }), /owned_cdp_endpoint_timeout/);
    await writeSeoGuestReport(path, report, true);
    const written = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(written.status, 'unverified');
    assert.deepEqual(written.targets, []);
    assert.equal(written.evidence_classification, 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT');
    assert.deepEqual(
      written.startup_endpoint_observations.map(({ phase }) => phase),
      ['cdp_timeout', 'post_timeout'],
    );
    assert.equal(written.startup_endpoint_observations[1].endpointPresent, true);
    assert.equal(written.startup_endpoint_observations[1].elapsedMs, 300);
    assert.equal(Object.hasOwn(written.startup_endpoint_observations[1], 'privatePath'), false);
    assert.deepEqual(await seoStartupObservationOptions({}, false), {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SEO reporter retains safe phase and completed targets after SIGTERM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-progress-'));
  const writerUrl = new URL('./hosted-seo-route.mjs', import.meta.url).href;
  const driverSource = await readFile(
    new URL('../tests/browser/seo-guest-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const driverAst = ts.createSourceFile(
    'seo-guest-acceptance.mjs',
    driverSource,
    ts.ScriptTarget.Latest,
    true,
  );
  assert.equal(driverAst.parseDiagnostics.length, 0);
  const driverFunctions = ['checkpoint', 'advance', 'target']
    .map((name) => {
      const declaration = driverAst.statements.find(
        (statement) =>
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (item) => ts.isIdentifier(item.name) && item.name.text === name,
          ),
      );
      assert.ok(declaration, `native driver declares ${name}`);
      return declaration.getText(driverAst);
    })
    .join('\n');
  try {
    for (const diagnostic of [false, true]) {
      const path = join(directory, diagnostic ? 'diagnostic.json' : 'ordinary.json');
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import { writeSeoGuestProgress, interruptSeoAfterCheckpoint } from ${JSON.stringify(writerUrl)};
        const path = process.argv[1];
        const diagnostic = process.argv[2] === 'true';
        const report = {
          schema_version: 1, feature_id: 'EXT-F-1008', mode: 'guest',
          status: 'partial', scope: 'public-page guest SEO actions',
          case_selection: { scope: 'full' },
          build: { before: { kind: 'ci_development_test', version: '0.2.407', treeSha256: 'a'.repeat(64) }, after: null },
          last_safe_stage: 'before_owned_profile', last_safe_observable: null, current_operation: null,
          targets: [],
        };
        const OUTPUT = path;
        const SEO_RESOURCE_DIAGNOSTIC = diagnostic;
        const SEO_INTERRUPT_AFTER_TARGET = undefined;
        ${driverFunctions}
        advance('owned_guest_panel_ready', { nativePanel: true });
        advance('public_page_0_ready', { title: 'private page text' });
        target('T09', 'page_0_title_and_headings', { title: 'private page text', sourceUrl: 'https://private.invalid/' });
        report.current_operation = 'public_page_1_navigation';
        process.kill(process.pid, 'SIGTERM');
      `,
          path,
          String(diagnostic),
        ],
        { encoding: 'utf8' },
      );
      assert.equal(child.signal, 'SIGTERM', child.stderr);
      const persisted = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(persisted.schema_version, 1);
      assert.equal(persisted.mode, 'guest');
      assert.equal(persisted.build.before.version, '0.2.407');
      assert.equal(persisted.build.before.treeSha256, 'a'.repeat(64));
      assert.equal(persisted.resource_diagnostic_enabled, diagnostic);
      assert.equal(persisted.last_safe_stage, 'public_page_0_ready');
      assert.equal(persisted.current_operation, null);
      assert.equal(persisted.status, 'unverified');
      assert.equal(persisted.receipt_state, 'in_progress');
      assert.deepEqual(diagnostic ? persisted.diagnostic_targets : persisted.targets, [
        { case_id: 'EXT-F-1008-T09', subtarget: 'page_0_title_and_headings', status: 'pass' },
      ]);
      if (diagnostic) {
        assert.deepEqual(persisted.targets, []);
        assert.equal(persisted.evidence_classification, 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT');
      }
      assert.doesNotMatch(JSON.stringify(persisted), /private page text|private\.invalid/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('SEO final writer preserves success and failure report shape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-final-'));
  try {
    const path = join(directory, 'result.json');
    const report = {
      schema_version: 1,
      mode: 'guest',
      status: 'partial',
      build: {
        before: { version: '0.2.407', treeSha256: 'b'.repeat(64) },
        after: { version: '0.2.407', treeSha256: 'b'.repeat(64) },
      },
      targets: [
        {
          case_id: 'EXT-F-1008-T09',
          subtarget: 'rich_public_detail_groups',
          status: 'pass',
          evidence: { observed: true },
        },
      ],
    };
    await writeSeoGuestReport(path, report, false);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), report);
    await writeSeoGuestReport(
      path,
      { ...report, status: 'unverified', failure_stage: 'build_recheck' },
      false,
    );
    const failed = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(failed.status, 'unverified');
    assert.equal(failed.failure_stage, 'build_recheck');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('interruption diagnostic final writer cannot claim product acceptance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-interrupt-final-'));
  try {
    const path = join(directory, 'result.json');
    await writeSeoGuestReport(
      path,
      {
        status: 'pass',
        interruption_test_target: 'manual_button_returns_to_current_page',
        targets: [
          {
            case_id: 'EXT-F-1008-T02',
            subtarget: 'manual_button_returns_to_current_page',
            status: 'pass',
          },
        ],
      },
      false,
    );
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(persisted.status, 'unverified');
    assert.equal(persisted.evidence_classification, 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT');
    assert.deepEqual(persisted.targets, []);
    assert.equal(
      persisted.diagnostic_targets[0].subtarget,
      'manual_button_returns_to_current_page',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('instrumented SEO writer outcomes never become native pass in the evidence summary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-diagnostic-contract-'));
  const guardLogPath = join(directory, 'guard.jsonl');
  const resultPath = join(directory, 'seo.json');
  const runId = 'seo-diagnostic-contract';
  const at = '2026-10-08T12:00:00.000Z';
  const guard = [
    { schema: 1, code: 'RESOURCE_ADMITTED', runId, at },
    { schema: 1, code: 'RESOURCE_JOB_EXIT', runId, at, childExitCode: 0 },
  ];
  try {
    await writeFile(guardLogPath, `${guard.map((event) => JSON.stringify(event)).join('\n')}\n`);
    for (const [sourceStatus, expectedStatus] of [
      ['pass', 'diagnostic_only'],
      ['partial', 'diagnostic_only'],
      ['unverified', 'unverified'],
      ['fail', 'fail'],
      ['future_success', 'diagnostic_only'],
    ]) {
      const source = {
        status: sourceStatus,
        targets: [{ case_id: 'EXT-F-1008-T09', status: 'pass' }],
        build: { version: '0.2.407', treeSha256: 'a'.repeat(64) },
      };
      const written = classifySeoResourceDiagnosticReport(source, true);
      await writeFile(resultPath, JSON.stringify(written));
      const summary = await buildEvidenceRecord({ runId, guardLogPath, resultPath });
      assert.equal(summary.raw_result.status, expectedStatus, sourceStatus);
      assert.equal(written.diagnostic_source_status, sourceStatus);
      assert.deepEqual(written.targets, [], sourceStatus);
      assert.deepEqual(written.diagnostic_targets, source.targets, sourceStatus);
      assert.equal(written.evidence_classification, 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT');
    }
    const ordinary = { status: 'pass', targets: [{ case_id: 'EXT-F-1008-T09', status: 'pass' }] };
    await writeFile(
      resultPath,
      JSON.stringify(classifySeoResourceDiagnosticReport(ordinary, false)),
    );
    const ordinarySummary = await buildEvidenceRecord({ runId, guardLogPath, resultPath });
    assert.equal(ordinarySummary.raw_result.status, 'pass');
    assert.equal(classifySeoResourceDiagnosticReport(ordinary, false), ordinary);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('hosted preflight rejects invalid metadata, resource diagnostic, and interruption selection before browser setup', () => {
  const preflight = (acceptanceCase, scope, fixture, diagnostic = '0', interrupt = 'none') =>
    spawnSync(process.execPath, ['scripts/hosted-guest-acceptance.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        MATRX_HOSTED_PHASE: 'preflight',
        MATRX_HOSTED_ACCEPTANCE_CASE: acceptanceCase,
        MATRX_HOSTED_SEO_CASE_SCOPE: scope,
        MATRX_HOSTED_SEO_METADATA_FIXTURE: fixture,
        MATRX_HOSTED_SEO_RESOURCE_DIAGNOSTIC: diagnostic,
        MATRX_HOSTED_SEO_INTERRUPT_AFTER_TARGET: interrupt,
      },
    });
  assert.equal(preflight('guest-seo', 'full', undefined).status, 0);
  assert.equal(preflight('guest-seo', 'full', 'airbnb').status, 0);
  assert.equal(preflight('guest-seo', 'full', 'airbnb', '1').status, 0);
  assert.equal(preflight('guest-seo', 'metadata', 'owned').status, 0);
  assert.equal(
    preflight('guest-seo', 'controlled', 'none', '0', 'manual_button_returns_to_current_page')
      .status,
    0,
  );
  for (const [acceptanceCase, scope, fixture] of [
    ['guest-seo', 'full', 'invalid'],
    ['guest-seo', 'controlled', 'airbnb'],
    ['guest-seo', 'full', 'owned'],
    ['guest-seo', 'metadata', 'none'],
    ['guest-seo', 'metadata', 'airbnb'],
    ['guest-chat', 'full', 'airbnb'],
  ])
    assert.notEqual(preflight(acceptanceCase, scope, fixture).status, 0);
  assert.notEqual(preflight('guest-seo', 'full', 'none', '1').status, 0);
  assert.notEqual(preflight('guest-seo', 'controlled', 'airbnb', '1').status, 0);
  for (const [acceptanceCase, scope, fixture, diagnostic] of [
    ['guest-chat', 'controlled', 'none', '0'],
    ['guest-seo', 'full', 'none', '0'],
    ['guest-seo', 'controlled', 'airbnb', '0'],
    ['guest-seo', 'controlled', 'none', '1'],
  ])
    assert.notEqual(
      preflight(acceptanceCase, scope, fixture, diagnostic, 'manual_button_returns_to_current_page')
        .status,
      0,
    );
  assert.notEqual(preflight('guest-seo', 'controlled', 'none', '0', 'not_a_target').status, 0);
});

test('guest SEO controlled scope reaches the native driver and unknown scope fails', () => {
  assert.equal(
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'controlled').env
      .SEO_GUEST_CASE_SCOPE,
    'controlled',
  );
  assert.throws(
    () => hostedGuestSeoRoute('guest-seo', 'development', selected, 'unknown'),
    /unknown_seo_case_scope/,
  );
});

test('hosted SEO interruption is confined to one controlled development target', () => {
  assert.equal(
    typeof seoRoute.hostedSeoInterruptTarget,
    'function',
    'hosted interrupt selector is missing',
  );
  const { hostedSeoInterruptTarget } = seoRoute;
  const target = 'manual_button_returns_to_current_page';
  assert.equal(hostedSeoInterruptTarget('guest-seo', 'controlled', 'none', '0', target), target);
  assert.equal(hostedSeoInterruptTarget('guest-seo', 'controlled', 'none', '0', 'none'), undefined);
  for (const [acceptanceCase, scope, fixture, diagnostic, selector] of [
    ['guest-chat', 'controlled', 'none', '0', target],
    ['guest-seo', 'full', 'none', '0', target],
    ['guest-seo', 'controlled', 'airbnb', '0', target],
    ['guest-seo', 'controlled', 'none', '1', target],
    ['guest-seo', 'controlled', 'none', '0', 'unknown_target'],
  ])
    assert.throws(() =>
      hostedSeoInterruptTarget(acceptanceCase, scope, fixture, diagnostic, selector),
    );
  assert.equal(
    hostedGuestSeoRoute('guest-seo', 'development', selected, 'controlled', 'none', target).env
      .SEO_GUEST_INTERRUPT_AFTER_TARGET,
    target,
  );
  assert.throws(() =>
    hostedGuestSeoRoute('guest-seo', 'release', selected, 'controlled', 'none', target),
  );
});

test('selected target survives the real progress writer before driver SIGTERM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seo-interrupt-'));
  const writerUrl = new URL('./hosted-seo-route.mjs', import.meta.url).href;
  const driverSource = await readFile(
    new URL('../tests/browser/seo-guest-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const driverAst = ts.createSourceFile(
    'seo-guest-acceptance.mjs',
    driverSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = driverAst.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (item) => ts.isIdentifier(item.name) && item.name.text === 'target',
      ),
  );
  assert.ok(declaration, 'native driver target boundary exists');
  try {
    for (const [selector, expectedSignal, expectedTargets] of [
      ['manual_button_returns_to_current_page', 'SIGTERM', 1],
      ['none', null, 2],
    ]) {
      const path = join(directory, `${selector}.json`);
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import { writeSeoGuestProgress, interruptSeoAfterCheckpoint } from ${JSON.stringify(writerUrl)};
        const OUTPUT = process.argv[1];
        const SEO_INTERRUPT_AFTER_TARGET = process.argv[2] === 'none' ? undefined : process.argv[2];
        const SEO_RESOURCE_DIAGNOSTIC = false;
        const report = {schema_version: 1, feature_id: 'EXT-F-1008', mode: 'guest',
          scope: 'public-page guest SEO actions', case_selection: {scope: 'controlled'},
          build: {before: {kind: 'ci_development_test'}, after: null},
          last_safe_stage: 'manual_reaudit_click_dispatched', current_operation: null,
          targets: [], interruption_test_target: SEO_INTERRUPT_AFTER_TARGET};
        const checkpoint = () => writeSeoGuestProgress(OUTPUT, report, SEO_RESOURCE_DIAGNOSTIC);
        ${declaration.getText(driverAst)}
        target('T02', 'manual_button_returns_to_current_page', {currentTitlePreserved: true});
        target('T07', 'guest_menu_offers_text_and_ai_but_hides_json', {guestOnly: true});
      `,
          path,
          selector,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(child.signal, expectedSignal, child.stderr);
      assert.equal(child.status, expectedSignal ? null : 0, child.stderr);
      const persisted = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(persisted.status, 'unverified');
      assert.equal(persisted.receipt_state, 'in_progress');
      assert.equal(persisted.targets.length, expectedTargets);
      assert.equal(persisted.targets[0].subtarget, 'manual_button_returns_to_current_page');
      if (expectedSignal) {
        assert.equal(persisted.interruption_test_target, selector);
        assert.equal(persisted.evidence_classification, 'DIAGNOSTIC_ONLY_NO_ACCEPTANCE_CREDIT');
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('guest SEO refuses release, Store, and mismatched development selection', () => {
  for (const [mode, prepared] of [
    ['release', selected],
    ['published-crx', selected],
    ['development', { ...selected, kind: 'published_release' }],
    ['development', { ...selected, eligibleStore: true }],
    ['development', { ...selected, extensionDir: '/tmp/other/chrome-mv3' }],
    ['development', { ...selected, relocatedReceipt: '/tmp/other/local-dev-receipt.json' }],
  ])
    assert.throws(() => hostedGuestSeoRoute('guest-seo', mode, prepared));
});

test('hosted workflow admits guest SEO on lane B with one exact development artifact', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /- guest-seo\n/);
  assert.match(workflow, /- readability\n/);
  assert.match(workflow, /- metadata\n/);
  assert.match(workflow, /- owned\n/);
  assert.match(workflow, /Owned metadata target requires lane B guest-seo metadata scope/);
  assert.match(workflow, /SEO_CASE_SCOPE" == readability/);
  assert.match(workflow, /Readability SEO scope requires guest-seo/);
  assert.match(workflow, /guest-chat\|guest-seo\|guest-data\|member-data\|guest-scrape/);
  assert.match(
    workflow,
    /"\$ACCEPTANCE_CASE" == guest-seo[^\n]*\n\s*\[\[ -z "\$RELEASE_RUN_ID" && -n "\$DEVELOPMENT_RUN_ID" && -n "\$DEVELOPMENT_ARTIFACT_ID" && "\$PUBLISHED_STORE_CRX" != true \]\]/,
  );
  assert.match(workflow, /test-results\/seo-guest-acceptance\.json/);
  assert.match(workflow, /seo_resource_diagnostic:\n[\s\S]*?default: false\n\s*type: boolean/);
  assert.match(workflow, /seo_interrupt_after_target:\n[\s\S]*?default: none\n\s*type: choice/);
  assert.equal(
    (
      workflow.match(
        /MATRX_HOSTED_SEO_INTERRUPT_AFTER_TARGET: \$\{\{ inputs\.seo_interrupt_after_target \|\| 'none' \}\}/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    workflow,
    /SEO_INTERRUPT_AFTER_TARGET: \$\{\{ inputs\.seo_interrupt_after_target \|\| 'none' \}\}/,
  );
  assert.match(
    workflow,
    /MATRX_STARTUP_INTERVAL_DIAGNOSTIC: \$\{\{ inputs\.seo_resource_diagnostic == true && '1' \|\| '0' \}\}/,
  );
  assert.match(workflow, /MATRX_HOSTED_SEO_CASE_SCOPE: \$\{\{ inputs\.seo_case_scope \}\}/);
  assert.equal(
    (
      workflow.match(
        /MATRX_HOSTED_SEO_METADATA_FIXTURE: \$\{\{ inputs\.seo_metadata_fixture \|\| 'none' \}\}/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    workflow,
    /SEO_METADATA_FIXTURE: \$\{\{ inputs\.seo_metadata_fixture \|\| 'none' \}\}/,
  );
});
