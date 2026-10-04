#!/usr/bin/env node
/** Real guest answers followed by a bounded live allowance refusal and recovery message. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RECEIPT = process.env.MATRX_GUEST_CHAT_DEV_RECEIPT
  ? resolve(process.env.MATRX_GUEST_CHAT_DEV_RECEIPT)
  : null;
const EXTENSION_DIR = process.env.MATRX_GUEST_CHAT_EXTENSION_DIR
  ? resolve(process.env.MATRX_GUEST_CHAT_EXTENSION_DIR)
  : null;
const OUTPUT = join(REPO, 'test-results', `guest-allowance-native-${randomUUID()}.json`);
const ARTIFACT_MODE = process.env.MATRX_GUEST_CHAT_ARTIFACT_MODE;
const EXPECTED_SOURCE_SHA = process.env.MATRX_EXPECTED_CI_SOURCE_SHA;
const EXPECTED_RUN_ID = Number(process.env.MATRX_EXPECTED_CI_RUN_ID);
const EXPECTED_ARTIFACT_ID = Number(process.env.MATRX_EXPECTED_CI_ARTIFACT_ID);
const EXPECTED_ARTIFACT_DIGEST = process.env.MATRX_EXPECTED_CI_ARTIFACT_DIGEST;
const STORE_ZIP_PATH = process.env.MATRX_GUEST_CHAT_STORE_ZIP
  ? resolve(process.env.MATRX_GUEST_CHAT_STORE_ZIP)
  : null;
const LOCAL_ZIP_PATH = process.env.MATRX_GUEST_CHAT_LOCAL_ZIP
  ? resolve(process.env.MATRX_GUEST_CHAT_LOCAL_ZIP)
  : null;
const QUESTIONS = [
  'What is 17 plus 25? Answer with the number.',
  'What is 31 plus 46? Answer with the number.',
  'What is 58 plus 27? Answer with the number.',
  'What is 64 plus 19? Answer with the number.',
  'What is 28 plus 35? Answer with the number.',
  'What is 43 plus 29? Answer with the number.',
  'What is 26 plus 57? Answer with the number.',
];
const ANSWERS = ['42', '77', '85', '83', '63', '72', '83'];
const MAX_SENDS = Number(process.env.MATRX_GUEST_MAX_SENDS ?? QUESTIONS.length);
const SAFE_COPY = "You've used your free AI tries. Sign up free to keep chatting.";
const report = {
  schema_version: 1,
  scope:
    'nominated immutable extension artifact; one owned guest profile; real answer then bounded live allowance response',
  status: 'unverified',
  max_sends: MAX_SENDS,
  context_rule_observation_horizon:
    'panel observer attached before turn 1; offscreen observer attached after the first real answer',
  limitation:
    'owned unpacked Store payload proves candidate behavior, not a published Store installation',
  build: null,
  completed_turns: [],
  send_observations: [],
  exhausted_turn: null,
  live_allowance_http: null,
  returning_guest: null,
  owner_table_gets_after_observer_attachment: [],
  failure_stage: null,
};
let stage = 'receipt';
let relocatedReleaseReceipt = null;
const storePayloadEvidence = {};
let runtimeExtensionId;
const onStage = (next) => {
  stage = next;
};

async function fileInventory(root) {
  const files = new Map();
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile()) {
        const bytes = await readFile(absolutePath);
        files.set(relativePath, createHash('sha256').update(bytes).digest('hex'));
      } else {
        throw new Error('native_artifact_nonregular_entry');
      }
    }
  }
  await walk(root);
  return files;
}

try {
  assert.ok(RECEIPT && EXTENSION_DIR, 'exact receipt and unpacked artifact paths are required');
  assert.ok(
    Number.isInteger(MAX_SENDS) && MAX_SENDS >= 2 && MAX_SENDS <= QUESTIONS.length,
    'owned diagnostic send budget must be between 2 and the supplied questions',
  );
  assert.ok(
    ['ci-development', 'pushed-release-store-zip-adapted'].includes(ARTIFACT_MODE),
    'explicit CI or published release artifact mode is required',
  );
  const artifactReceipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  let provenance;
  let harnessOptions;
  if (ARTIFACT_MODE === 'ci-development') {
    assert.match(EXPECTED_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/, 'expected CI source SHA is required');
    assert.ok(
      Number.isSafeInteger(EXPECTED_RUN_ID) && EXPECTED_RUN_ID > 0,
      'expected CI run id is required',
    );
    assert.ok(
      Number.isSafeInteger(EXPECTED_ARTIFACT_ID) && EXPECTED_ARTIFACT_ID > 0,
      'expected CI artifact id is required',
    );
    assert.match(
      EXPECTED_ARTIFACT_DIGEST ?? '',
      /^sha256:[a-f0-9]{64}$/,
      'expected CI artifact digest is required',
    );
    provenance = await verifyImportedNativeEvidence(EXTENSION_DIR, RECEIPT);
    assert.equal(
      provenance.sourceSha,
      EXPECTED_SOURCE_SHA,
      'artifact source SHA must match nominated fix',
    );
    assert.equal(
      provenance.runId,
      EXPECTED_RUN_ID,
      'artifact run id must match nominated successful CI',
    );
    assert.equal(
      provenance.artifactId,
      EXPECTED_ARTIFACT_ID,
      'artifact id must match nominated CI artifact',
    );
    assert.equal(
      provenance.githubArtifactDigest,
      EXPECTED_ARTIFACT_DIGEST,
      'artifact bytes must match nominated GitHub digest',
    );
    harnessOptions = {
      extensionDir: EXTENSION_DIR,
      localDevReceiptPath: RECEIPT,
      expectedRelease: { version: artifactReceipt.version, treeSha256: artifactReceipt.treeSha256 },
    };
  } else {
    const expectedSourceSha = process.env.MATRX_EXPECTED_RELEASE_SOURCE_SHA;
    const expectedVersion = process.env.MATRX_EXPECTED_RELEASE_VERSION;
    const expectedStoreZipSha256 = process.env.MATRX_EXPECTED_STORE_ZIP_SHA256;
    const expectedStoreTreeSha256 = process.env.MATRX_EXPECTED_STORE_UNPACKED_TREE_SHA256;
    const expectedAdaptedTreeSha256 = process.env.MATRX_EXPECTED_ADAPTED_TREE_SHA256;
    const expectedLocalZipSha256 = process.env.MATRX_EXPECTED_LOCAL_ZIP_SHA256;
    const expectedReceiptSha256 = process.env.MATRX_EXPECTED_PUBLISHER_RECEIPT_SHA256;
    assert.match(
      expectedSourceSha ?? '',
      /^[a-f0-9]{40}$/,
      'expected release source SHA is required',
    );
    assert.match(expectedVersion ?? '', /^\d+\.\d+\.\d+$/, 'expected release version is required');
    assert.match(
      expectedStoreZipSha256 ?? '',
      /^[a-f0-9]{64}$/,
      'expected Store ZIP hash is required',
    );
    assert.match(
      expectedStoreTreeSha256 ?? '',
      /^[a-f0-9]{64}$/,
      'expected Store payload tree hash is required',
    );
    assert.match(
      expectedAdaptedTreeSha256 ?? '',
      /^[a-f0-9]{64}$/,
      'expected adapted tree hash is required',
    );
    assert.match(
      expectedLocalZipSha256 ?? '',
      /^[a-f0-9]{64}$/,
      'expected local ZIP hash is required',
    );
    assert.match(
      expectedReceiptSha256 ?? '',
      /^[a-f0-9]{64}$/,
      'expected publisher receipt hash is required',
    );
    assert.ok(STORE_ZIP_PATH, 'exact downloaded Store ZIP path is required');
    assert.ok(
      LOCAL_ZIP_PATH,
      'exact matching local ZIP is required to source the public identity key',
    );
    storePayloadEvidence.publisher_receipt_sha256 = createHash('sha256')
      .update(await readFile(RECEIPT))
      .digest('hex');
    assert.equal(
      storePayloadEvidence.publisher_receipt_sha256,
      expectedReceiptSha256,
      'publisher receipt bytes are pinned',
    );
    assert.equal(
      artifactReceipt.sourceSha,
      expectedSourceSha,
      'release source SHA must match nominated release',
    );
    assert.equal(
      artifactReceipt.version,
      expectedVersion,
      'release version must match nominated release',
    );
    assert.equal(
      artifactReceipt.publishState,
      'pushed',
      'release receipt must represent the hosted release',
    );
    assert.equal(
      artifactReceipt.storeZip?.sha256,
      expectedStoreZipSha256,
      'Store ZIP hash must match nominated artifact',
    );
    const zipBytes = await readFile(STORE_ZIP_PATH);
    assert.equal(
      createHash('sha256').update(zipBytes).digest('hex'),
      expectedStoreZipSha256,
      'Store ZIP bytes must match receipt',
    );
    assert.equal(
      artifactReceipt.localZip?.sha256,
      expectedLocalZipSha256,
      'matching local ZIP must match publisher receipt',
    );
    assert.equal(
      createHash('sha256')
        .update(await readFile(LOCAL_ZIP_PATH))
        .digest('hex'),
      expectedLocalZipSha256,
      'local ZIP bytes must match receipt',
    );
    const storeManifestPath = join(EXTENSION_DIR, 'manifest.json');
    const storeManifestBytes = await readFile(storeManifestPath);
    const storeManifest = JSON.parse(storeManifestBytes);
    const localManifest = JSON.parse(
      execFileSync('unzip', ['-p', LOCAL_ZIP_PATH, 'manifest.json'], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }),
    );
    assert.equal(storeManifest.version, expectedVersion, 'Store payload version');
    assert.equal(localManifest.version, expectedVersion, 'same-version local key source');
    assert.ok(
      typeof localManifest.key === 'string' && localManifest.key.length > 0,
      'matching local ZIP public key exists',
    );
    assert.equal(storeManifest.key, undefined, 'Store ZIP manifest has no unpacked key');
    assert.equal(
      hashReleaseTree(EXTENSION_DIR),
      expectedStoreTreeSha256,
      'Store payload tree is pinned',
    );
    const identityBytes = Buffer.from(localManifest.key, 'base64');
    assert.equal(
      identityBytes.toString('base64'),
      localManifest.key,
      'local public key encoding is canonical',
    );
    runtimeExtensionId = [...createHash('sha256').update(identityBytes).digest().subarray(0, 16)]
      .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15)))
      .join('');
    const beforeAdaptation = await fileInventory(EXTENSION_DIR);
    storePayloadEvidence.store_zip_sha256 = expectedStoreZipSha256;
    storePayloadEvidence.store_tree_sha256 = expectedStoreTreeSha256;
    storePayloadEvidence.publisher_source_tree_sha256 = artifactReceipt.treeSha256;
    storePayloadEvidence.local_zip_sha256 = expectedLocalZipSha256;
    storePayloadEvidence.manifest_before_sha256 = createHash('sha256')
      .update(storeManifestBytes)
      .digest('hex');
    storePayloadEvidence.manifest_key_adaptation =
      'public key copied from matching-version local ZIP; original Store ZIP unchanged';
    storePayloadEvidence.loaded_extension_id = runtimeExtensionId;
    await writeFile(
      storeManifestPath,
      `${JSON.stringify({ ...storeManifest, key: localManifest.key })}\n`,
      { mode: 0o600 },
    );
    const afterAdaptation = await fileInventory(EXTENSION_DIR);
    const changedPaths = [...new Set([...beforeAdaptation.keys(), ...afterAdaptation.keys()])]
      .filter((path) => beforeAdaptation.get(path) !== afterAdaptation.get(path))
      .sort();
    assert.deepEqual(
      changedPaths,
      ['manifest.json'],
      'identity adaptation changes only manifest.json',
    );
    const adaptedManifest = JSON.parse(await readFile(storeManifestPath, 'utf8'));
    const { key: adaptedKey, ...adaptedManifestRest } = adaptedManifest;
    assert.equal(adaptedKey, localManifest.key, 'only canonical local public key was added');
    assert.deepEqual(
      adaptedManifestRest,
      storeManifest,
      'adapted manifest equals original Store manifest after removing only key',
    );
    storePayloadEvidence.manifest_fields_after_removing_key_equal_original = true;
    storePayloadEvidence.modified_paths = changedPaths;
    storePayloadEvidence.adapted_tree_sha256 = hashReleaseTree(EXTENSION_DIR);
    assert.equal(
      storePayloadEvidence.adapted_tree_sha256,
      expectedAdaptedTreeSha256,
      'adapted tree is pinned',
    );
    storePayloadEvidence.manifest_after_sha256 = createHash('sha256')
      .update(await readFile(storeManifestPath))
      .digest('hex');
    await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
    relocatedReleaseReceipt = `${OUTPUT}.release-receipt.json`;
    await writeFile(
      relocatedReleaseReceipt,
      `${JSON.stringify({ ...artifactReceipt, kind: 'native_store_zip_candidate_key_adapted', treeSha256: expectedAdaptedTreeSha256, storeTreeSha256: expectedStoreTreeSha256, storeZip: { ...artifactReceipt.storeZip, path: STORE_ZIP_PATH } }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    provenance = {
      sourceSha: artifactReceipt.sourceSha,
      version: artifactReceipt.version,
      treeSha256: expectedAdaptedTreeSha256,
      storeZipSha256: artifactReceipt.storeZip.sha256,
      publishState: artifactReceipt.publishState,
    };
    harnessOptions = {
      extensionDir: EXTENSION_DIR,
      releaseReceiptPath: relocatedReleaseReceipt,
      expectedRelease: { version: artifactReceipt.version, treeSha256: expectedAdaptedTreeSha256 },
    };
  }
  const run = await runNativeSidepanelQa({
    ...harnessOptions,
    ...(runtimeExtensionId && { expectedExtensionId: runtimeExtensionId }),
    onStage,
    exercisePanel: async ({ panel, attachOffscreen, artifacts }) => {
      stage = 'guest_ready';
      const state = () =>
        evaluate(
          panel,
          `(() => {
        const tab = document.querySelector('button[role="tab"][title="Chat"]');
        const pane = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
        const visible = (node) => !!node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        const replies = pane ? [...pane.querySelectorAll('button[title="Copy reply"]')]
          .map((button) => [...(button.closest('div.group.space-y-2')?.querySelectorAll(':scope > div.min-w-0.text-foreground') ?? [])]
            .map((part) => part.innerText ?? '').join('\\n')) : [];
        return { guest: visible(document.querySelector('button[title="Account"]')),
          composer: visible(pane?.querySelector('textarea')), replyCount: replies.length,
          sendReady: [...(pane?.querySelectorAll('button[title="Send"], button:not([title])[data-matrx-title="Send"]') ?? [])].filter(b => visible(b) && !b.disabled).length === 1,
          latest: replies.at(-1) ?? '', streaming: !!pane?.querySelector('button[title="Stop"], button:not([title])[data-matrx-title="Stop"]'),
          retryVisible: pane ? [...pane.querySelectorAll('button')].some((b) => visible(b) && /^retry$/i.test(b.innerText.trim())) : false };
      })()`,
        );
      await waitFor('guest_chat_ready', state, (s) => s?.guest && s.composer, 30_000);
      const guestIdentity = () =>
        evaluate(
          panel,
          `(async () => {
        const values = await chrome.storage.local.get(['matrx.auth.accessToken', 'matrx.user.profile']);
        return { banner_present: document.body.innerText.includes("You're using Matrx as a guest."),
          access_token_absent: !values['matrx.auth.accessToken'], profile_absent: !values['matrx.user.profile'] };
      })()`,
        );
      report.guest_identity = await guestIdentity();
      assert.ok(
        Object.values(report.guest_identity).every((value) => value === true),
        'explicit signed-out guest identity',
      );

      const reads = new Map();
      await panel.send('Network.enable');
      const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
        try {
          const url = new URL(request?.url);
          if (url.pathname.endsWith('/rest/v1/user_surface_state'))
            reads.set(requestId, {
              method: request?.method === 'GET' ? 'GET' : 'other',
              status: null,
            });
        } catch {
          /* retain no unclassified request data */
        }
      });
      const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
        const item = reads.get(requestId);
        if (item) item.status = Number.isFinite(response?.status) ? response.status : null;
      });
      let offscreen = null;
      let stopOffscreen = [];
      const chatRequests = new Set();
      const chatStatuses = new Map();
      const allowanceResponses = new Map();
      const observeOffscreen = async () => {
        if (offscreen) return;
        offscreen = await attachOffscreen();
        await offscreen.send('Network.enable');
        stopOffscreen = [
          offscreen.on('Network.requestWillBeSent', ({ requestId, request }) => {
            try {
              if (new URL(request?.url).pathname.endsWith('/v2/ai/mandates/extend.browser_chat'))
                chatRequests.add(requestId);
            } catch {
              /* unrelated request */
            }
          }),
          offscreen.on('Network.responseReceived', ({ requestId, response }) => {
            if (chatRequests.has(requestId)) chatStatuses.set(requestId, response?.status ?? null);
          }),
          offscreen.on('Network.loadingFinished', ({ requestId }) => {
            if (chatStatuses.get(requestId) !== 402) return;
            void offscreen
              .send('Network.getResponseBody', { requestId })
              .then(({ body, base64Encoded }) => {
                const parsed = JSON.parse(
                  base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
                );
                const summary = {
                  status: 402,
                  exact_guest_allowance_code: parsed.error === 'guest_ai_allowance_used',
                  flat_error_field: typeof parsed.error === 'string',
                  ...(parsed.error === 'guest_ai_allowance_used' && {
                    error: 'guest_ai_allowance_used',
                  }),
                };
                allowanceResponses.set(requestId, summary);
                report.live_allowance_http ??= summary;
              })
              .catch(() => {
                const summary = { status: 402, body: 'unavailable' };
                allowanceResponses.set(requestId, summary);
                report.live_allowance_http ??= summary;
              });
          }),
        ];
      };

      try {
        for (let index = 0; index < MAX_SENDS; index += 1) {
          stage = `turn_${index + 1}`;
          const before = await state();
          const focused = await evaluate(
            panel,
            `(() => { const t = document.querySelector('button[role="tab"][title="Chat"]'); const p = document.getElementById(t?.getAttribute('aria-controls') ?? ''); const x = p?.querySelector('textarea'); x?.focus(); return document.activeElement === x; })()`,
          );
          assert.equal(focused, true, `turn_${index + 1} composer focused`);
          await panel.send('Input.insertText', { text: QUESTIONS[index] });
          await waitFor(
            `turn_${index + 1}_send_ready`,
            state,
            (s) => s?.replyCount === before.replyCount && !s.streaming && s.composer && s.sendReady,
            10_000,
          ).catch(async (error) => {
            report.send_wait_failure = await evaluate(
              panel,
              `(() => {
              const tab = document.querySelector('button[role="tab"][title="Chat"]');
              const pane = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
              return { buttons: [...(pane?.querySelectorAll('button') ?? [])].map(el => ({title: el.title, preserved_title: el.getAttribute('data-matrx-title'), label: el.getAttribute('aria-label'), disabled: el.disabled})), pane_present: !!pane };
            })()`,
            );
            throw error;
          });
          report.send_observations.push(
            await evaluate(
              panel,
              `(() => {
            const tabs = [...document.querySelectorAll('button[role="tab"][title="Chat"]')];
            const pane = document.getElementById(tabs[0]?.getAttribute('aria-controls') ?? '');
            const rect = (el) => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; };
            return { tabs: tabs.map(el => ({ selected: el.getAttribute('aria-selected'), state: el.getAttribute('data-state') })),
              paneState: pane?.getAttribute('data-state'),
              composers: [...(pane?.querySelectorAll('textarea') ?? [])].map(el => ({ ...rect(el), focused: el === document.activeElement, length: el.value.length })),
              sends: [...(pane?.querySelectorAll('button[title="Send"], button:not([title])[data-matrx-title="Send"]') ?? [])].map(el => ({ ...rect(el), disabled: el.disabled })),
              stops: pane?.querySelectorAll('button[title="Stop"], button:not([title])[data-matrx-title="Stop"]').length ?? 0 };
          })()`,
            ),
          );
          await click(panel, 'active-chat-send', 'Send');
          const finished = await waitFor(
            `turn_${index + 1}_terminal`,
            state,
            (s) => s?.replyCount > before.replyCount && !s.streaming,
            120_000,
          );
          const text = finished.latest;
          if (text.includes(SAFE_COPY)) {
            assert.ok(report.completed_turns.length >= 1, 'fresh guest completed a real answer');
            assert.ok(
              !/don't have access to this chat|do not have access to this chat/i.test(text),
              'allowance turn avoids generic access denial',
            );
            assert.equal(finished.retryVisible, false, 'allowance turn has no Retry action');
            report.exhausted_turn = {
              ordinal: index + 1,
              safe_allowance_copy_present: true,
              generic_access_denial_absent: true,
              retry_absent: true,
            };
            break;
          }
          assert.ok(
            text.includes(ANSWERS[index]),
            `real answer ${index + 1} contains expected arithmetic result`,
          );
          assert.ok(!/error\s*:/i.test(text), `turn ${index + 1} is not an error`);
          report.completed_turns.push({ ordinal: index + 1, expected_answer_present: true });
          if (!offscreen) await observeOffscreen();
        }
        assert.ok(report.exhausted_turn, 'bounded guest run reached the live allowance gate');
        await waitFor(
          'allowance_http_body',
          () => report.live_allowance_http,
          (body) => body?.status === 402 && body.exact_guest_allowance_code === true,
          10_000,
        );
        const firstAllowanceRequests = new Set(allowanceResponses.keys());
        assert.equal(firstAllowanceRequests.size, 1, 'first allowance turn has one observed 402');

        stage = 'returning_guest_reload';
        await panel.send('Page.enable');
        await panel.send('Page.reload', { ignoreCache: false });
        await waitFor('returning_guest_ready', state, (s) => s?.guest && s.composer, 30_000);
        const identityAfterReload = await guestIdentity();
        assert.ok(
          Object.values(identityAfterReload).every((value) => value === true),
          'same profile remains a signed-out guest after panel reload',
        );
        await click(panel, 'title', 'New chat');
        await waitFor(
          'returning_guest_new_chat_empty',
          state,
          (s) => s?.guest && s.composer && s.replyCount === 0 && !s.streaming,
          10_000,
        );
        stage = 'returning_guest_send';
        const focused = await evaluate(
          panel,
          `(() => { const t = document.querySelector('button[role="tab"][title="Chat"]'); const p = document.getElementById(t?.getAttribute('aria-controls') ?? ''); const x = p?.querySelector('textarea'); x?.focus(); return document.activeElement === x; })()`,
        );
        assert.equal(focused, true, 'returning guest composer focused');
        await panel.send('Input.insertText', { text: 'Hi' });
        await waitFor('returning_guest_send_ready', state, (s) => s?.sendReady, 10_000);
        const requestsBeforeSecondSend = new Set(chatRequests);
        await click(panel, 'active-chat-send', 'Send');
        const returningReply = await waitFor(
          'returning_guest_terminal',
          state,
          (s) => s?.replyCount === 1 && !s.streaming,
          120_000,
        );
        assert.ok(
          returningReply.latest.includes(SAFE_COPY),
          'returning guest sees free-account remedy',
        );
        assert.equal(returningReply.retryVisible, false, 'returning guest has no Retry action');
        const secondWire = await waitFor(
          'returning_guest_second_live_402',
          () => [...allowanceResponses].filter(([id]) => !requestsBeforeSecondSend.has(id)),
          (entries) => entries.length === 1 && entries[0][1].exact_guest_allowance_code === true,
          10_000,
        );
        assert.ok(
          !firstAllowanceRequests.has(secondWire[0][0]),
          'second 402 is a distinct request',
        );
        const remedyClip = await evaluate(
          panel,
          `(() => { const t = document.querySelector('button[role="tab"][title="Chat"]'); const p = document.getElementById(t?.getAttribute('aria-controls') ?? ''); const b = [...(p?.querySelectorAll('button[title="Copy reply"]') ?? [])].at(-1); const r = b?.closest('div.group.space-y-2')?.getBoundingClientRect(); return r && { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(innerWidth, r.right) - Math.max(0, r.x), height: Math.min(innerHeight, r.bottom) - Math.max(0, r.y), scale: 1 }; })()`,
        );
        assert.ok(
          remedyClip?.width > 0 && remedyClip.height > 0,
          'remedy screenshot crop is visible',
        );
        const screenshot = join(artifacts, 'returning-guest-allowance-remedy.png');
        const { data } = await panel.send('Page.captureScreenshot', {
          format: 'png',
          clip: remedyClip,
        });
        await writeFile(screenshot, Buffer.from(data, 'base64'), { mode: 0o600 });
        report.returning_guest = {
          panel_reloaded: true,
          signed_out_guest_after_reload: true,
          trusted_new_chat_clicked: true,
          second_distinct_live_402: true,
          second_exact_guest_allowance_code: true,
          safe_allowance_copy_present: true,
          retry_absent: true,
          cropped_remedy_screenshot: screenshot,
        };
        report.owner_table_gets_after_observer_attachment = [...reads.values()].filter(
          (r) => r.method === 'GET',
        );
        assert.equal(
          report.owner_table_gets_after_observer_attachment.length,
          0,
          'guest chat must not GET owner-only user_surface_state',
        );
      } finally {
        offRequest();
        offResponse();
        for (const stop of stopOffscreen) stop();
        await offscreen?.detach();
      }
    },
  });
  report.build = {
    kind: ARTIFACT_MODE,
    store_zip_verified: ARTIFACT_MODE === 'pushed-release-store-zip-adapted',
    store_installed: false,
    store_published: false,
    extension_id: run.extensionId,
    artifact_verified_by_harness: true,
    source_sha: provenance.sourceSha,
    run_id: provenance.runId,
    artifact_id: provenance.artifactId,
    tree_sha256:
      ARTIFACT_MODE === 'pushed-release-store-zip-adapted'
        ? storePayloadEvidence.adapted_tree_sha256
        : artifactReceipt.treeSha256,
    ...(ARTIFACT_MODE === 'ci-development' && {
      ci_run_id: provenance.runId,
      ci_artifact_id: provenance.artifactId,
      github_artifact_digest: provenance.githubArtifactDigest,
    }),
    ...(ARTIFACT_MODE === 'pushed-release-store-zip-adapted' && {
      version: provenance.version,
      store_zip_sha256: provenance.storeZipSha256,
      publish_state: provenance.publishState,
      store_payload: storePayloadEvidence,
    }),
  };
  report.status = 'pass';
} catch (error) {
  report.failure_stage = stage;
  report.driver_failure = error?.driverFailure ?? null;
  report.failure_code = String(error?.message ?? 'unknown_error')
    .split(':', 1)[0]
    .replace(/[^a-z0-9_]/gi, '_')
    .slice(0, 100);
}
if (relocatedReleaseReceipt) await unlink(relocatedReleaseReceipt).catch(() => {});
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} guest_allowance ${OUTPUT}\n`);
if (report.status !== 'pass') process.exitCode = 1;
