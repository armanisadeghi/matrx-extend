#!/usr/bin/env node
/** Real signed-in saved Network replay with an owned HTTP document race. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { approvedAdminOrganizationName, signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';

const repo = resolve(import.meta.dirname, '../..');
const output =
  process.env.MATRX_SHOWCASE_OUTPUT ?? join(tmpdir(), `showcase-d47-${randomUUID()}.json`);
const report = {
  schema_version: 1,
  case_id: 'EXT-F-1012-T57',
  defect_id: 'EXT-D-0047',
  status: 'unverified',
  stage: 'inputs',
  artifact: null,
  fixture: null,
  contexts: [],
  binding_events: [],
  saved_result: null,
  verdicts: {
    current_saved_replay: 'unverified',
    delayed_old_binding: 'unverified',
    cancellation: 'unverified',
  },
  failure_code: null,
};
let fixture;
const stage = (value) => {
  report.stage = value;
};
const control = async (origin, action) => {
  const response = await fetch(`${origin}/control/document-race/${action}`);
  const body = await response.text();
  return { status: response.status, body: body.startsWith('{') ? JSON.parse(body) : null };
};
const status = async (origin) => (await control(origin, 'status')).body;

async function startFixture() {
  const child = spawn(process.execPath, [join(repo, 'tests/fixtures/showcase-replay/serve.mjs')], {
    env: { ...process.env, SHOWCASE_FIXTURE_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  const origin = await new Promise((resolveOrigin, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture_start_timeout')), 10000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /Showcase fixture: (http:\/\/127\.0\.0\.1:\d+)\//.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolveOrigin(match[1]);
      }
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('fixture_exited_before_ready'));
    });
    child.once('error', reject);
  });
  return { child, origin };
}

async function stopFixture() {
  if (!fixture || fixture.child.exitCode !== null || fixture.child.signalCode !== null) return;
  await new Promise((resolveStop) => {
    fixture.child.once('exit', resolveStop);
    fixture.child.kill('SIGTERM');
  });
}

const panelText = (panel) => evaluate(panel, 'document.body.innerText');
async function trustedPanelClick(panel, selector, text = null) {
  const point = await evaluate(
    panel,
    `(() => {
    const found = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && getComputedStyle(el).visibility === 'visible'
        && (${JSON.stringify(text)} === null || el.textContent.trim() === ${JSON.stringify(text)});
    });
    if (found.length !== 1) return { count: found.length };
    found[0].scrollIntoView({ block: 'center', inline: 'center' });
    const r = found[0].getBoundingClientRect();
    return { count: 1, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`,
  );
  assert.equal(point.count, 1, 'panel_target_not_unique');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}
const allow = async (panel) => {
  await waitFor(
    'debugger_approval',
    () => panelText(panel),
    (text) => text?.includes('Allowing this uses Chrome debugger'),
  );
  await click(panel, 'button-text', 'Allow');
};
const tab = async (panel, name) => {
  await click(panel, 'title', name);
};

async function installPassiveWorkerProbe(worker, origin) {
  await worker.send('Runtime.enable');
  const result = await worker.send('Runtime.evaluate', {
    expression: `(() => {
      if (globalThis.__d47PassiveProbe) throw new Error('probe_already_installed');
      const observed = [];
      const origin = ${JSON.stringify(origin)};
      const listener = (source, method, params = {}) => {
        if (!Number.isInteger(source.tabId) || source.sessionId) return;
        const order = observed.length + 1;
        if (method === 'Runtime.executionContextCreated') {
          const c = params.context;
          if (c?.auxData?.isDefault) observed.push({ order, kind: 'context_created', tab_id: source.tabId, id: c.id, unique_id: c.uniqueId ?? null, frame_id: c.auxData.frameId ?? null });
        } else if (method === 'Runtime.executionContextDestroyed') {
          observed.push({ order, kind: 'context_destroyed', tab_id: source.tabId, id: params.executionContextId });
        } else if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
          observed.push({ order, kind: 'frame_navigated', tab_id: source.tabId, frame_id: params.frame?.id ?? null, current_fixture: params.frame?.url === origin + '/document-race/' });
        } else if (method === 'Runtime.bindingCalled' && String(params.name).startsWith('__matrx_capture_')) {
          let packet = null;
          try { packet = JSON.parse(params.payload); } catch { /* malformed marker below */ }
          observed.push({ order, kind: 'binding', tab_id: source.tabId, context_id: params.executionContextId,
            binding_name: params.name,
            handshake: packet?.__matrx_capture_hook === 'network-tap',
            target_packet: packet?.url === origin + '/api/document-race',
            request_sequence: Number.isSafeInteger(packet?.request_sequence) ? packet.request_sequence : null,
            current_payload: typeof packet?.body === 'string' && packet.body.includes('Canyon Frequency'),
            old_payload: typeof packet?.body === 'string' && packet.body.includes('Moonlit Transit') });
        }
      };
      chrome.debugger.onEvent.addListener(listener);
      globalThis.__d47PassiveProbe = { observed, listener };
      return true;
    })()`,
    returnByValue: true,
  });
  assert.equal(result.result?.value, true, 'worker_probe_install_failed');
}
async function readPassiveWorkerProbe(worker) {
  const result = await worker.send('Runtime.evaluate', {
    expression: 'globalThis.__d47PassiveProbe?.observed ?? null',
    returnByValue: true,
  });
  return result.result?.value ?? null;
}
async function removePassiveWorkerProbe(worker) {
  await worker.send('Runtime.evaluate', {
    expression: `(() => { const probe = globalThis.__d47PassiveProbe;
      if (probe) chrome.debugger.onEvent.removeListener(probe.listener);
      delete globalThis.__d47PassiveProbe; return true; })()`,
    returnByValue: true,
  });
}

try {
  const extensionDir = process.env.MATRX_SHOWCASE_EXTENSION_DIR;
  const receiptPath = process.env.MATRX_SHOWCASE_RECEIPT;
  assert.ok(extensionDir && receiptPath, 'exact_artifact_required');
  assert.match(process.env.MATRX_SHOWCASE_CI_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.MATRX_SHOWCASE_CI_RUN_ID ?? '', /^[1-9][0-9]*$/);
  assert.match(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID ?? '', /^[1-9][0-9]*$/);
  const requiredOrganizationName = await approvedAdminOrganizationName(
    process.env.MATRX_APPROVED_ADMIN_ORGANIZATION_FILE,
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256);
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version);
  report.artifact = {
    source_sha: process.env.MATRX_SHOWCASE_CI_SOURCE_SHA,
    run_id: Number(process.env.MATRX_SHOWCASE_CI_RUN_ID),
    artifact_id: Number(process.env.MATRX_SHOWCASE_CI_ARTIFACT_ID),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };
  fixture = await startFixture();
  stage('native');
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? tmpdir(), 'guest-acceptance'),
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async ({
      page,
      panel,
      resourceAction,
      requireResourceHealth,
      reopenPanel,
      attachWorker,
    }) => {
      const origin = fixture.origin;
      stage('signin');
      const auth = await resourceAction(() =>
        signInSettings({
          mode: 'admin',
          page,
          panel,
          repo,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
          onStage: (value) => {
            report.auth_stage = value;
          },
        }),
      );
      assert.equal(auth.admin_role, true);
      stage('organization');
      await runShowcaseOrganizationCheckpoint({
        panel,
        auth,
        resourceAction,
        report,
        requiredOrganizationName,
      });
      await resourceAction(() => reopenPanel());
      await resourceAction(() => page.goto(`${origin}/document-race/`));
      await waitFor(
        'fixture_seed',
        () => page.locator('#phase').textContent(),
        (value) => value === 'seed',
      );
      await requireResourceHealth();
      stage('capture_seed');
      await tab(panel, 'Showcase (admin only)');
      await trustedPanelClick(panel, '[role="tablist"] [role="tab"]', 'Network');
      await click(panel, 'button-text', 'Capture page load');
      await allow(panel);
      await waitFor(
        'seed_response',
        () => panelText(panel),
        (value) => value?.includes('/api/document-race') && value?.includes('response captured'),
      );
      if ((await panelText(panel)).includes('● recording'))
        await click(panel, 'button-text', 'Stop');
      stage('select_seed_response');
      await trustedPanelClick(panel, 'button.font-mono:has(span.flex-1)');
      await waitFor(
        'seed_save_ready',
        () =>
          evaluate(
            panel,
            `(() => [...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Save pattern' && !x.disabled))()`,
          ),
        (ready) => ready === true,
      );
      stage('save_recipe');
      await click(panel, 'button-text', 'Save pattern');
      const recipe = `Codex D47 document race ${randomUUID()}`;
      // The popover is the only visible name field in this flow.
      const inputs = await evaluate(
        panel,
        `(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper] input')].map(x => ({ placeholder: x.placeholder })))()`,
      );
      assert.equal(inputs.length, 1, 'save_name_input_ambiguous');
      await trustedPanelClick(panel, '[data-radix-popper-content-wrapper] input');
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        modifiers: 4,
      });
      await panel.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        modifiers: 4,
      });
      // Trusted typing through CDP; React observes the normal input sequence.
      await panel.send('Input.insertText', { text: recipe });
      await click(panel, 'button-text', 'Save');
      await waitFor(
        'recipe_saved',
        () => panelText(panel),
        (value) => value?.includes('Pattern saved'),
      );
      stage('arm_old_document');
      await control(origin, 'arm');
      await resourceAction(() => page.reload());
      await waitFor(
        'old_pending',
        () => status(origin),
        (value) => value?.old_pending === true && value.target_requests === 1,
      );
      stage('old_context_identity');
      const pageCdp = await page.context().newCDPSession(page);
      const oldContexts = [];
      pageCdp.on('Runtime.executionContextCreated', ({ context }) => {
        if (context.auxData?.isDefault && context.uniqueId)
          oldContexts.push({
            unique_id: context.uniqueId,
            frame_id: context.auxData.frameId ?? null,
          });
      });
      await pageCdp.send('Runtime.enable');
      await waitFor(
        'old_page_context',
        () => oldContexts,
        (value) => value.length === 1 && Boolean(value[0].frame_id),
      );
      const oldPageContext = oldContexts[0];
      await pageCdp.detach();
      const worker = await attachWorker();
      stage('worker_observer');
      await installPassiveWorkerProbe(worker, origin);
      stage('saved_replay');
      await trustedPanelClick(panel, '[role="tablist"] [role="tab"]', 'Patterns');
      await waitFor(
        'saved_recipe_visible',
        () => panelText(panel),
        (value) => value?.includes(recipe),
      );
      await click(panel, 'title', 'Run pattern');
      stage('saved_approval');
      await allow(panel);
      stage('current_http');
      await waitFor(
        'current_response',
        () => status(origin),
        (value) => value?.current_response_sent === true && value.target_requests === 2,
      );
      report.fixture = { before_release: await status(origin) };
      stage('release_old_http');
      const release = await control(origin, 'release-old');
      report.fixture.release_http_status = release.status;
      report.fixture.after_release = await status(origin);
      assert.equal(
        report.fixture.before_release.old_pending ||
          report.fixture.before_release.old_response_aborted,
        true,
        'old_request_lifecycle_missing',
      );
      assert.equal(
        report.fixture.after_release.current_response_sent,
        true,
        'current_http_response_missing',
      );
      assert.equal(
        report.fixture.after_release.old_response_finished ||
          report.fixture.after_release.old_response_aborted,
        true,
        'old_http_terminal_missing',
      );
      assert.equal(
        release.status,
        report.fixture.after_release.old_response_finished ? 200 : 409,
        'old_release_status_mismatch',
      );
      stage('saved_terminal_result');
      await waitFor(
        'saved_current_result',
        () => panelText(panel),
        (value) => value?.includes(`Last run: ${recipe}`) && value?.includes('Canyon Frequency'),
      );
      report.saved_result = {
        page_phase: await page.locator('#phase').textContent(),
        page_result: await page.locator('#result').textContent(),
        panel_current: (await panelText(panel))?.includes('Canyon Frequency') ?? false,
        panel_old: (await panelText(panel))?.includes('Moonlit Transit') ?? false,
      };
      assert.equal(report.saved_result.page_phase, 'current');
      assert.equal(report.saved_result.page_result, 'Canyon Frequency');
      assert.equal(report.saved_result.panel_old, false, 'old_row_visible');
      report.verdicts.current_saved_replay = report.saved_result.panel_current
        ? 'pass'
        : 'unverified';
      stage('binding_evidence');
      const observed = await readPassiveWorkerProbe(worker);
      assert.ok(Array.isArray(observed), 'worker_probe_lost');
      report.contexts = observed.filter((event) => event.kind !== 'binding');
      report.binding_events = observed.filter((event) => event.kind === 'binding');
      const handshakes = report.binding_events.filter((event) => event.handshake);
      const currentPackets = report.binding_events.filter(
        (event) => event.target_packet && event.current_payload,
      );
      assert.ok(
        handshakes.length > 0 && currentPackets.length > 0,
        'current_binding_positive_control_missing',
      );
      const current = currentPackets.at(-1);
      assert.equal(current.request_sequence, 1, 'current_first_request_sequence_missing');
      assert.ok(
        handshakes.some(
          (event) =>
            event.context_id === current.context_id &&
            event.binding_name === current.binding_name &&
            event.order < current.order,
        ),
        'current_binding_handshake_missing',
      );
      const context = report.contexts.find(
        (event) => event.kind === 'context_created' && event.id === current.context_id,
      );
      assert.ok(context?.unique_id && context.frame_id, 'current_context_identity_missing');
      assert.ok(
        report.contexts.some(
          (event) =>
            event.kind === 'frame_navigated' &&
            event.frame_id === context.frame_id &&
            event.current_fixture,
        ),
        'current_frame_commit_missing',
      );
      const old = report.contexts.find(
        (event) =>
          event.kind === 'context_created' &&
          event.id !== current.context_id &&
          event.frame_id === context.frame_id &&
          event.unique_id === oldPageContext.unique_id &&
          event.frame_id === oldPageContext.frame_id,
      );
      assert.ok(old && old.order < current.order, 'old_context_identity_missing');
      assert.ok(
        report.contexts.some(
          (event) =>
            event.kind === 'context_destroyed' &&
            event.id === old.id &&
            event.order < current.order,
        ),
        'old_context_destruction_missing',
      );
      assert.equal(
        report.binding_events.some((event) => event.target_packet && event.old_payload),
        false,
        'old_binding_payload_observed',
      );
      report.current_packet_before_commit =
        current.order <
        Math.min(
          ...report.contexts
            .filter(
              (event) =>
                event.kind === 'frame_navigated' &&
                event.frame_id === context.frame_id &&
                event.current_fixture,
            )
            .map((event) => event.order),
        );
      report.verdicts.delayed_old_binding = 'architecturally_excluded_observed';
      await removePassiveWorkerProbe(worker);
      await worker.detach();
    },
  });
  assert.equal(native.verified, true);
  report.status = 'observed_bounded';
} catch {
  report.failure_code = `${report.stage}_failed`;
  process.stderr.write(`UNVERIFIED showcase_d47 stage=${report.stage}\n`);
  process.exitCode = 1;
} finally {
  await stopFixture();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
