import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { stageProfileOrganizationConfig } from '../../scripts/hosted-profile-route.mjs';
import {
  requireMemberChatSequence,
  requireMemberOrganizationBinding,
} from './member-chat-completion-oracle.mjs';
import { requireOpeningMemberTransport } from './member-chat-original-repro.mjs';

const source = await readFile(
  new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);
const hostedSource = await readFile(
  new URL('../../scripts/hosted-guest-acceptance.mjs', import.meta.url),
  'utf8',
);

test('hosted member path stages the actual private approved organization before child execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'member-approved-org-'));
  const path = join(directory, 'approved-member-organization-private.json');
  const start = hostedSource.indexOf(
    '  if (needsApprovedAdminOrganization)\n    await stageProfileOrganizationConfig(',
  );
  const end = hostedSource.indexOf('  const childEnv = {', start);
  assert.ok(start >= 0 && end > start);
  const stage = hostedSource.slice(start, end);
  const envStart = hostedSource.indexOf('    MATRX_REVIEWER_EXTENSION_DIR: extensionDir,', end);
  const envEnd = hostedSource.indexOf('    ...(tabGroupsRoute?.env ?? {}),', envStart);
  assert.ok(envStart >= 0 && envEnd > envStart);
  const childEnvFields = hostedSource.slice(envStart, envEnd);
  const env = {
    MATRX_HOSTED_PROFILE_ORGANIZATION_JSON: JSON.stringify({
      approved_organization_name: 'Matrx Review Organization',
      approved_organization_id: '72336a38-f816-442f-ad48-18610128fb67',
    }),
  };
  const execute = async (body) =>
    runInNewContext(`(async () => { ${body} })()`, {
      acceptanceCase: 'member-chat',
      needsApprovedAdminOrganization: false,
      approvedMemberOrganizationPath: path,
      stageProfileOrganizationConfig,
      process: { env },
    });
  try {
    await execute(stage);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await readFile(path, 'utf8')).approved_organization_id,
      '72336a38-f816-442f-ad48-18610128fb67',
    );
    const forwarded = (fields) =>
      runInNewContext(`({ ${fields} })`, {
        acceptanceCase: 'member-chat',
        approvedMemberOrganizationPath: path,
        extensionDir: '/private/extension',
        relocatedReceipt: '/private/receipt',
      });
    assert.equal(forwarded(childEnvFields).MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE, path);
    const withoutForwarding = childEnvFields.replace(
      / {4}\.\.\.\(acceptanceCase === 'member-chat'[\s\S]*? {6}: \{\}\),\n/,
      '',
    );
    assert.notEqual(withoutForwarding, childEnvFields);
    assert.throws(
      () =>
        assert.equal(forwarded(withoutForwarding).MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE, path),
      /undefined/,
      'removed child env forwarding must turn the path proof red',
    );
    await rm(path);
    const withoutMemberStaging = stage.replace(
      / {2}if \(acceptanceCase === 'member-chat'\)\n {4}await stageProfileOrganizationConfig\(approvedMemberOrganizationPath, process\.env\);\n/,
      '',
    );
    assert.notEqual(withoutMemberStaging, stage);
    await execute(withoutMemberStaging);
    await assert.rejects(
      async () => assert.equal((await stat(path)).mode & 0o777, 0o600),
      { code: 'ENOENT' },
      'removed member staging must turn the file proof red',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('member driver loads the staged config and requires the selected UI organization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'member-org-load-'));
  const path = join(directory, 'approved.json');
  const id = '72336a38-f816-442f-ad48-18610128fb67';
  const fingerprint = createHash('sha256').update(id).digest('hex').slice(0, 16);
  const loadStart = source.indexOf('async function approvedOrganizationConfig() {');
  const loadEnd = source.indexOf('async function approvedOrganizationObservation(', loadStart);
  const entryStart = source.indexOf("  stage = 'approved_organization_config';");
  const entryEnd = source.indexOf('  const receipt = ', entryStart);
  const selectionStart = source.indexOf(
    '        if (!UNINTERRUPTED)\n          assert.equal(\n            selectedOrganizationFingerprint,',
  );
  const selectionEnd = source.indexOf(
    '        if (!UNINTERRUPTED)\n          requireOriginalMemberPanel(',
    selectionStart,
  );
  assert.ok(
    loadStart >= 0 &&
      loadEnd > loadStart &&
      entryStart >= 0 &&
      entryEnd > entryStart &&
      selectionStart >= 0 &&
      selectionEnd > selectionStart,
  );
  const entry = source.slice(entryStart, entryEnd);
  const runEntry = (body) =>
    runInNewContext(
      `(async () => { let approvedOrganization = null; let stage; ${source.slice(loadStart, loadEnd)} ${body} return approvedOrganization; })()`,
      {
        process: { env: { MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: path } },
        lstat: (value) => stat(value),
        readFile,
        join,
        REPO: directory,
        UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      },
    );
  try {
    await writeFile(
      path,
      JSON.stringify({
        approved_organization_name: 'Matrx Review Organization',
        approved_organization_id: id,
      }),
      { mode: 0o600 },
    );
    const loaded = await runEntry(entry);
    assert.equal(loaded.id, id);
    const selection = source.slice(selectionStart, selectionEnd);
    const requireSelected = (selectedOrganizationFingerprint) =>
      runInNewContext(selection, {
        UNINTERRUPTED: false,
        assert,
        selectedOrganizationFingerprint,
        approvedOrganization: loaded,
        hash: (value) => createHash('sha256').update(value).digest('hex').slice(0, 16),
      });
    requireSelected(fingerprint);
    assert.throws(
      () => requireSelected('a'.repeat(16)),
      /member_selected_organization_must_match_approved_config/,
    );
    const withoutLoad = entry.replace(
      '  approvedOrganization = await approvedOrganizationConfig();\n',
      '',
    );
    assert.notEqual(withoutLoad, entry);
    await assert.rejects(
      async () => assert.equal((await runEntry(withoutLoad))?.id, id),
      /undefined/,
      'removed runtime load must turn the loaded config proof red',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('actual transport report comparison refuses a different approved organization', () => {
  const start = source.indexOf('        organization_header_matches_approved: Boolean(');
  const end = source.indexOf('        actual_permission_mode:', start);
  assert.ok(start >= 0 && end > start);
  const expression = source.slice(start, end);
  const first = '72336a38-f816-442f-ad48-18610128fb67';
  const second = 'd92c4d3f-e723-4b80-a49d-659a6b69e572';
  const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);
  const compare = (property, approvedOrganization, header) =>
    runInNewContext(`({ ${property} })`, {
      approvedOrganization,
      start: { organizationHeader: header },
      hash,
    }).organization_header_matches_approved;
  assert.equal(compare(expression, { id: first }, hash(first)), true);
  assert.equal(compare(expression, { id: first }, hash(second)), false);
  assert.equal(compare(expression, null, hash(first)), false);
  assert.throws(
    () =>
      assert.equal(
        compare('organization_header_matches_approved: true,', { id: first }, hash(second)),
        false,
      ),
    /true !== false/,
    'hardcoded true mutant must turn the mismatch proof red',
  );
});

// Run the actual default-lane prerequisite, rather than a replica of its decision.
// A first-login member's account/startup ladder selection has no device override.
test('signed-in member reaches Chat without a persisted device organization override', async () => {
  const start = source.indexOf(
    '        if (UNINTERRUPTED) {\n          await exerciseApproval(native);',
  );
  const end = source.indexOf("        await waitFor(\n          'reviewer_chat_visible'", start);
  assert.ok(start > 0 && end > start, 'default Chat prerequisite must be located');
  for (const activeOrganizationPresent of [false, true]) {
    const clicks = [];
    const waits = [];
    const phases = [];
    await runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      assert,
      UNINTERRUPTED: false,
      storageShape: { activeOrganizationPresent },
      panel: {},
      email: 'member',
      report: { account: {} },
      stage: '',
      sampleAuthBoundary: async (phase) => phases.push(phase),
      createMemberPanelLifecycleGuard: () => ({ check: async () => {} }),
      WEB_ORIGIN: 'https://www.aimatrx.com',
      DEMO_PATH: '/matrx-extend-demo',
      web: {},
      page: {},
      native: {},
      evaluate: async () => {},
      OUTPUT: '/tmp/reviewer-boundary',
      waitFor: async (label, _read, accept) => {
        waits.push(label);
        assert.equal(accept({ swipeFileVisible: true }), true);
        assert.equal(accept({ swipeFileVisible: false }), false);
      },
      click: async (_panel, kind, label) => clicks.push([kind, label]),
    });
    assert.deepEqual(waits, ['reviewer_swipe_file_tab_visible']);
    assert.deepEqual(phases, []);
    assert.deepEqual(
      clicks,
      [['title', 'Chat']],
      'organization ladder must reach the actual send flow',
    );
  }
});

// This checks the harness verdict, not product behavior. Captured network metadata
// remains mandatory even when the UI has rendered a completed answer.
test('member Chat verdict refuses absent, rejected or uncorrelated organization transport', () => {
  const accepted = {
    start_count: 1,
    organization_header_fingerprint: 'observed-org-fingerprint',
    organization_header_matches_approved: true,
    start_http_status: 200,
    response_matches_request_conversation: true,
    backend_request_fingerprint: 'observed-request-fingerprint',
  };
  requireOpeningMemberTransport(accepted);
  for (const changed of [
    { start_count: 0 },
    { start_count: 2 },
    { organization_header_fingerprint: null },
    { organization_header_matches_approved: false },
    { start_http_status: 422 },
    { response_matches_request_conversation: false },
    { backend_request_fingerprint: null },
  ])
    assert.throws(() => requireOpeningMemberTransport({ ...accepted, ...changed }), {
      code: 'ERR_ASSERTION',
    });
  assert.throws(() => requireOpeningMemberTransport({}), { code: 'ERR_ASSERTION' });
});

// Break caught: two valid matching request headers can still target the wrong UI org.
test('actual two-turn member verdict binds both headers to the checked UI organization', () => {
  const start = source.indexOf('        const sequence = requireMemberChatSequence(');
  const end = source.indexOf('        await runMemberAnswerProofBoundary(', start);
  assert.ok(start > 0 && end > start, 'member two-turn verdict seam must exist');
  const selected = 'c61c7d9a9d805d4e';
  const transport = (fingerprint) => ({
    start_count: 1,
    member_turn_requests: [
      {
        kind: 'start',
        http_status: 200,
        organization_header_fingerprint: fingerprint,
        conversation_fingerprint: 'ec8c373c1df3c614',
      },
      {
        kind: 'followup',
        http_status: 200,
        organization_header_fingerprint: fingerprint,
        conversation_fingerprint: 'ec8c373c1df3c614',
      },
    ],
  });
  const requests = [
    {
      attempt: 'opening',
      is_new: true,
      status: 200,
      loading_finished: true,
      terminal_success: true,
      semantic_completion: 'success',
      pending_tool_count: 0,
      stream_error: false,
      path_class: 'canonical',
      conversation_fingerprint: 'ec8c373c1df3c614',
    },
    {
      attempt: 'same_conversation_followup',
      is_new: false,
      status: 200,
      loading_finished: true,
      terminal_success: true,
      semantic_completion: 'success',
      pending_tool_count: 0,
      stream_error: false,
      path_class: 'conversation',
      conversation_fingerprint: 'ec8c373c1df3c614',
    },
  ];
  const verdict = (fingerprint) => {
    const report = {};
    runInNewContext(source.slice(start, end), {
      assert,
      report,
      selectedOrganizationFingerprint: selected,
      requireMemberChatSequence,
      requireMemberOrganizationBinding,
      memberTransport: { turnRequests: () => requests, snapshot: () => transport(fingerprint) },
      network: { organization_header_fingerprint: fingerprint },
      turns: { opening: 'terminal_answer', same_conversation_followup: 'terminal_answer' },
      followup: { completedReplyCount: 2 },
    });
    return report.chat_sequence;
  };
  assert.equal(verdict(selected).both_headers_match_selection, true);
  assert.throws(() => verdict('5687839f735578e9'), /header_must_match_selected_organization/);
});
