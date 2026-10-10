#!/usr/bin/env node
/** Real member Save Source dialog, project edge, and exact owned-row cleanup. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHostedScrapeSaveAssociations } from '../../scripts/hosted-scrape-route.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { cleanupProjectFixture, projectFixtureRequest } from './scrape-save-project-fixture.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { activeTabPanelExpression, click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const extensionDir = process.env.MATRX_SCRAPE_EXTENSION_DIR;
const receiptPath = process.env.MATRX_SCRAPE_RECEIPT;
const supabaseUrl = new URL(process.env.WXT_SUPABASE_URL ?? '');
const publishableKey = process.env.WXT_SUPABASE_PUBLISHABLE_KEY;
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
const destinationMode = process.env.MATRX_SCRAPE_SAVE_DESTINATION ?? 'project';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const captureTitle = `Northline source intake ${runId}-${runAttempt}`;
const captureHeading = `Preparing a Northline appointment ${runId}-${runAttempt}`;
const sourceName = `Northline source acceptance ${runId}-${runAttempt}`;
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${captureTitle}</title>
<meta name="description" content="A controlled member Save Source acceptance page"></head><body>
<main><article><h1>${captureHeading}</h1><p>This controlled article has enough real text to become a Source. It describes the intake process, preparation steps, and the information a reader should keep available before an appointment.</p>
<h2>Preparation</h2><p>Review the appointment details, collect the required forms, and confirm the time before arriving. These instructions are part of the saved article body.</p>
<h2>Follow up</h2><p>Keep the confirmation with the visit notes so the next person can find the same source and its related project.</p></article></main></body></html>`;
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1007',
  defect_id: 'EXT-D-0187',
  case_ids: ['EXT-F-1007-T04', 'EXT-F-1007-T29'],
  auth_mode: 'member',
  destination_mode: destinationMode,
  status: 'unverified',
  stage: 'inputs',
  native_stage: null,
  artifact: null,
  authentication: null,
  observations: {},
  cleanup: null,
  failure_stage: null,
  limits: `Exact imported CI development artifact, real member sign-in, one custom-named Source saved with ${destinationMode === 'project' ? 'one disposable owned Project association' : 'no destination'}, independent reads, UI reopen of name/URL/captured text, and cleanup; Project display in UI is not covered; this does not cover admin, guest, Library, multiple destinations, retry, responsive timing, or full T04/T29 closure.`,
};

function safeFailureCode(error) {
  const candidate = String(error?.message ?? 'native_acceptance_error').split(/[:\n]/, 1)[0];
  return /^[a-z][a-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'native_acceptance_error';
}

const ARTICLE_EXTRACTORS = new Set(['defuddle', 'readability', 'fallback']);

function articleLayerEvidence(layer, expected) {
  const extractor = ARTICLE_EXTRACTORS.has(layer?.extractor) ? layer.extractor : null;
  return {
    article_layer_ready: typeof layer?.title === 'string' && typeof layer?.markdown === 'string',
    article_title_matches: layer?.title === expected.title,
    heading_matches:
      typeof layer?.markdown === 'string' && layer.markdown.includes(expected.heading),
    marker_matches: typeof layer?.markdown === 'string' && layer.markdown.includes(expected.marker),
    extractor,
  };
}

function renderedContentEvidence(text, expected) {
  return {
    heading_matches: typeof text === 'string' && text.includes(expected.heading),
    marker_matches: typeof text === 'string' && text.includes(expected.marker),
  };
}

async function readCaptureArticleLayer(panel, expected) {
  const observed = await evaluate(
    panel,
    `(() => {
      const pane = ${activeTabPanelExpression('Scrape')};
      const article = pane?.querySelector('[role="tabpanel"][data-state="active"]');
      const label = article?.querySelector('span.flex-1.truncate')?.textContent?.trim() ?? '';
      return {
        title: pane?.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim() ?? null,
        markdown: article?.textContent ?? null,
        extractor: label.match(/^(defuddle|readability|fallback)\\b/)?.[1] ?? null
      };
    })()`,
  );
  return articleLayerEvidence(observed, expected);
}

function restUrl(schema, table, filters = {}) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl.origin);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  return { url: url.href, schema };
}

async function panelRest(panel, request) {
  return evaluate(
    panel,
    `(async () => {
      const token = (await chrome.storage.local.get('matrx.auth.accessToken'))['matrx.auth.accessToken'];
      if (typeof token !== 'string' || !token) return { status: 0, rows: null };
      const response = await fetch(${JSON.stringify(request.url)}, {
        method: ${JSON.stringify(request.method ?? 'GET')},
        headers: {
          apikey: ${JSON.stringify(publishableKey)},
          Authorization: 'Bearer ' + token,
          'X-Organization-Id': ${JSON.stringify(request.organizationId)},
          'Accept-Profile': ${JSON.stringify(request.schema)},
          ...((${JSON.stringify(request.method ?? 'GET')}) !== 'GET' ? {
            'Content-Profile': ${JSON.stringify(request.schema)},
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          } : {})
        },
        ...((${JSON.stringify(request.body ?? null)}) !== null ? { body: JSON.stringify(${JSON.stringify(request.body ?? null)}) } : {}),
        cache: 'no-store'
      });
      if (response.status === 204 || response.status === 205) return { status: response.status, rows: null };
      const text = await response.text();
      let rows = null;
      try { rows = text ? JSON.parse(text) : null; } catch { rows = null; }
      return { status: response.status, rows: Array.isArray(rows) ? rows : rows };
    })()`,
  );
}

async function querySources(panel, identity, organizationId, name = sourceName) {
  const filters = {
    select:
      'id,name,organization_id,canonical_identity,origin_client,created_at,deleted_at,original_file_id',
    organization_id: `eq.${organizationId}`,
    canonical_identity: `eq.${identity}`,
    origin_client: 'eq.extension',
    deleted_at: 'is.null',
    limit: '3',
  };
  if (name) filters.name = `eq.${name}`;
  const request = restUrl('docproc', 'processed_documents', filters);
  return panelRest(panel, { ...request, organizationId });
}

async function queryProject(panel, projectName, organizationId) {
  const request = restUrl('projects', 'projects', {
    select: 'id,name,organization_id,deleted_at',
    organization_id: `eq.${organizationId}`,
    name: `eq.${projectName}`,
    deleted_at: 'is.null',
    limit: '3',
  });
  return panelRest(panel, { ...request, organizationId });
}

async function associationRpc(panel, name, organizationId, body) {
  const url = new URL(`/rest/v1/rpc/${name}`, supabaseUrl.origin).href;
  return evaluate(
    panel,
    `(async () => {
      const token = (await chrome.storage.local.get('matrx.auth.accessToken'))['matrx.auth.accessToken'];
      if (typeof token !== 'string' || !token) return { status: 0, value: null };
      const response = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        headers: {
          apikey: ${JSON.stringify(publishableKey)},
          Authorization: 'Bearer ' + token,
          'X-Organization-Id': ${JSON.stringify(organizationId)},
          'Content-Type': 'application/json',
          'Content-Profile': 'public',
          'Accept-Profile': 'public'
        },
        body: JSON.stringify(${JSON.stringify(body)}),
        cache: 'no-store'
      });
      const text = await response.text();
      let value = null;
      try { value = text ? JSON.parse(text) : null; } catch { value = null; }
      return { status: response.status, value };
    })()`,
  );
}

async function trustedType(panel, selector, text, evidence = {}) {
  const observe = () =>
    evaluate(
      panel,
      `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes.length === 1 ? nodes[0] : null;
    return { count: nodes.length, focused: !!node && document.activeElement === node,
      value_length: node?.value?.length ?? null,
      selection_start: node?.selectionStart ?? null, selection_end: node?.selectionEnd ?? null,
      all_selected: !!node && node.selectionStart === 0 && node.selectionEnd === node.value.length,
      matches_expected: !!node && node.value === ${JSON.stringify(text)} };
  })()`,
    );
  const point = await evaluate(
    panel,
    `(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const visible = nodes.filter((node) => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (visible.length !== 1) return { count: visible.length };
      const rect = visible[0].getBoundingClientRect();
      return { count: 1, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, value_length: visible[0].value?.length ?? null };
    })()`,
  );
  assert.equal(point?.count, 1, 'scrape_save_input_not_unique');
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
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    commands: ['selectAll'],
    key: 'A',
    code: 'KeyA',
    modifiers: process.platform === 'darwin' ? 4 : 2,
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'A',
    code: 'KeyA',
    modifiers: process.platform === 'darwin' ? 4 : 2,
  });
  evidence.before_insert = await observe();
  assert.equal(evidence.before_insert.focused, true, 'scrape_save_input_focus_missing');
  assert.equal(evidence.before_insert.all_selected, true, 'scrape_save_input_selection_missing');
  await panel.send('Input.insertText', { text });
  evidence.after_insert = await observe();
}

async function trustedTab(panel, shiftKey = false) {
  const modifiers = shiftKey ? 8 : 0;
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    modifiers,
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    modifiers,
  });
}

async function reopenSavedSourceUi(panel, expected, evidence) {
  await click(panel, 'title', 'Saved captures');
  await waitFor(
    'scrape_save_saved_captures_ready',
    () =>
      evaluate(
        panel,
        `(() => {
      const pane = ${activeTabPanelExpression('Saved captures')};
      return { search_count: pane?.querySelectorAll('input[placeholder="Search title or URL"]').length ?? 0 };
    })()`,
      ),
    (state) => state?.search_count === 1,
  );
  await trustedType(
    panel,
    '[role="tabpanel"][data-state="active"] input[placeholder="Search title or URL"]',
    expected.name,
  );
  const candidate = await waitFor(
    'scrape_save_reopen_owned_source_ready',
    () =>
      evaluate(
        panel,
        `(() => {
      const pane = ${activeTabPanelExpression('Saved captures')};
      const buttons = [...(pane?.querySelectorAll('article > button') ?? [])]
        .filter((button) => button.firstElementChild?.textContent?.trim() === ${JSON.stringify(expected.name)});
      const node = buttons.length === 1 ? buttons[0] : null;
      node?.scrollIntoView({ block: 'center' });
      const rect = node?.getBoundingClientRect();
      return { count: buttons.length, x: rect ? rect.left + rect.width / 2 : null,
        y: rect ? rect.top + rect.height / 2 : null, visible: !!rect && rect.width > 0 && rect.height > 0 };
    })()`,
      ),
    (state) => state?.count === 1 && state.visible === true,
  );
  for (const type of ['mousePressed', 'mouseReleased']) {
    await panel.send('Input.dispatchMouseEvent', {
      type,
      x: candidate.x,
      y: candidate.y,
      button: 'left',
      clickCount: 1,
    });
  }
  const detail = await waitFor(
    'scrape_save_reopened_detail_ready',
    () =>
      evaluate(
        panel,
        `(() => {
          const pane = ${activeTabPanelExpression('Saved captures')};
          const header = pane?.querySelector('header');
          return {
            detail_open: [...(header?.querySelectorAll('button') ?? [])].some((button) => button.textContent.trim() === 'Back to saved captures'),
            name_matches: header?.querySelector('.font-semibold')?.textContent.trim() === ${JSON.stringify(expected.name)},
            url_matches: [...(header?.querySelectorAll('div') ?? [])].some((node) => node.textContent.trim() === ${JSON.stringify(expected.url)})
          };
        })()`,
      ),
    (state) => state?.detail_open === true,
  );
  evidence.reopen_header = detail;
  assert.equal(detail.detail_open, true, 'scrape_save_ui_reopen_missing');

  await click(panel, 'button-text', 'Details');
  const originalReady = await waitFor(
    'scrape_save_original_read_ready',
    () =>
      evaluate(
        panel,
        `(() => {
          const pane = ${activeTabPanelExpression('Saved captures')};
          const rows = [...(pane?.querySelectorAll('[role="tabpanel"][data-state="active"] .grid') ?? [])];
          const original = rows.find((row) => row.firstElementChild?.textContent?.trim() === 'Original');
          return { ready: original?.lastElementChild?.textContent?.trim() === 'Saved in your files' };
        })()`,
      ),
    (state) => state?.ready === true,
  );
  evidence.saved_original_read_ready = originalReady.ready;

  await click(panel, 'button-text', 'Data');
  const original = await waitFor(
    'scrape_save_saved_original_content_ready',
    () =>
      evaluate(
        panel,
        `(() => {
          const pane = ${activeTabPanelExpression('Saved captures')};
          const raw = pane?.querySelector('[role="tabpanel"][data-state="active"] pre')?.textContent ?? '';
          try {
            const soup = JSON.parse(raw);
            return { title: soup?.article?.title ?? null, markdown: soup?.article?.content_markdown ?? null,
              extractor: soup?.article?.extractor ?? null, valid: typeof soup?.url === 'string' && Array.isArray(soup?.images) };
          } catch { return { valid: false }; }
        })()`,
      ),
    (state) => state?.valid === true,
  );
  evidence.saved_original = articleLayerEvidence(original, expected);

  await click(panel, 'button-text', 'Article');
  const rendered = await waitFor(
    'scrape_save_reopened_article_ready',
    () =>
      evaluate(
        panel,
        `(() => {
          const pane = ${activeTabPanelExpression('Saved captures')};
          const article = pane?.querySelector('[role="tabpanel"][data-state="active"]');
          return { text: article?.textContent ?? null, present: !!article };
        })()`,
      ),
    (state) => state?.present === true,
  );
  evidence.reopen_ui = renderedContentEvidence(rendered.text, expected);
  assert.equal(detail.name_matches, true, 'scrape_save_reopened_name_not_observed');
  assert.equal(detail.url_matches, true, 'scrape_save_reopened_url_not_observed');
  assert.equal(originalReady.ready, true, 'scrape_save_original_read_not_observed');
  assert.equal(original.valid, true, 'scrape_save_original_content_not_observed');
  assert.equal(
    evidence.capture.article_title_matches,
    true,
    'scrape_save_capture_title_not_observed',
  );
  assert.ok(evidence.capture.extractor, 'scrape_save_capture_extractor_not_allowlisted');
  assert.equal(
    evidence.saved_original.article_title_matches,
    true,
    'scrape_save_original_title_not_observed',
  );
  assert.ok(evidence.saved_original.extractor, 'scrape_save_original_extractor_not_allowlisted');
  assert.equal(evidence.capture.heading_matches, true, 'scrape_save_capture_heading_not_observed');
  assert.equal(evidence.capture.marker_matches, true, 'scrape_save_capture_marker_not_observed');
  assert.equal(
    evidence.saved_original.heading_matches,
    true,
    'scrape_save_original_heading_not_observed',
  );
  assert.equal(
    evidence.saved_original.marker_matches,
    true,
    'scrape_save_original_marker_not_observed',
  );
  assert.equal(
    evidence.reopen_ui.heading_matches,
    true,
    'scrape_save_reopened_content_verified_not_observed',
  );
  assert.equal(evidence.reopen_ui.marker_matches, true, 'scrape_save_reopened_marker_not_observed');
  evidence.saved_source_reopened_in_ui = true;
}

async function dialogState(panel) {
  return evaluate(
    panel,
    `(() => {
      const dialog = document.querySelector('[data-testid="save-source-form"]');
      const pane = ${activeTabPanelExpression('Scrape')};
      const chips = dialog?.querySelector(':scope > ul');
      return {
        open: dialog?.open === true,
        name: dialog?.querySelector('input[aria-label="Source name"]')?.value ?? null,
        focusedName: dialog?.querySelector('input[aria-label="Source name"]') === document.activeElement,
        focusInside: Boolean(dialog && document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)),
        saveButtonCount: dialog ? [...dialog.querySelectorAll('button')].filter((button) => button.textContent.trim() === 'Save Source').length : 0,
        targetChipCount: chips?.querySelectorAll(':scope > li').length ?? 0,
        targetLabel: chips?.querySelector(':scope > li span')?.textContent?.trim() ?? null,
        savedButton: [...(pane?.querySelectorAll('button') ?? [])].some((button) => button.textContent.trim() === 'Saved')
      };
    })()`,
  );
}

function verifySourceRows(result, identity, organizationId, expectedName) {
  assert.equal(result?.status, 200, 'scrape_save_source_lookup_http_failed');
  assert.ok(Array.isArray(result.rows), 'scrape_save_source_lookup_body_invalid');
  assert.equal(result.rows.length, 1, 'scrape_save_source_row_count_mismatch');
  const row = result.rows[0];
  assert.equal(row.canonical_identity, identity, 'scrape_save_source_identity_mismatch');
  assert.equal(row.organization_id, organizationId, 'scrape_save_source_organization_mismatch');
  assert.equal(row.name, expectedName, 'scrape_save_custom_name_mismatch');
  assert.equal(row.origin_client, 'extension', 'scrape_save_origin_mismatch');
  assert.equal(row.deleted_at, null, 'scrape_save_source_not_active');
  assert.match(row.original_file_id ?? '', UUID, 'scrape_save_original_file_missing');
  assert.match(row.id ?? '', UUID, 'scrape_save_source_id_invalid');
  return row;
}

try {
  assert.ok(extensionDir && receiptPath, 'scrape_save_artifact_inputs_missing');
  assert.match(runId ?? '', /^[1-9][0-9]*$/, 'scrape_save_run_id_missing');
  assert.match(runAttempt ?? '', /^[1-9][0-9]*$/, 'scrape_save_run_attempt_missing');
  assert.equal(
    process.env.MATRX_SCRAPE_ARTIFACT_CHANNEL,
    'development',
    'scrape_save_dev_channel_required',
  );
  assert.ok(['project', 'none'].includes(destinationMode), 'scrape_save_destination_invalid');
  assert.equal(
    process.env.MATRX_SCRAPE_AUTH_MODE,
    'member',
    'scrape_save_member_auth_mode_required',
  );
  assert.equal(
    supabaseUrl.origin,
    'https://db.matrxserver.com',
    'scrape_save_database_origin_refused',
  );
  assert.match(
    publishableKey ?? '',
    /^sb_publishable_[A-Za-z0-9_-]+$/,
    'scrape_save_publishable_key_missing',
  );
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const ciReceiptPath = process.env.MATRX_SCRAPE_CI_RECEIPT;
  assert.ok(ciReceiptPath, 'scrape_save_ci_receipt_path_required');
  const ciReceipt = JSON.parse(await readFile(ciReceiptPath, 'utf8'));
  const ciSourceSha = process.env.MATRX_SCRAPE_CI_SOURCE_SHA;
  const ciRunId = process.env.MATRX_SCRAPE_CI_RUN_ID;
  const ciArtifactId = process.env.MATRX_SCRAPE_CI_ARTIFACT_ID;
  assert.equal(receipt.kind, 'local_dev_unpacked', 'scrape_save_local_dev_receipt_required');
  assert.equal(receipt.publish_state, 'not_published', 'scrape_save_unpublished_receipt_required');
  assert.equal(ciReceipt?.schema_version, 1, 'scrape_save_ci_receipt_invalid');
  assert.equal(ciReceipt?.kind, 'ci_development_test', 'scrape_save_ci_receipt_required');
  assert.equal(ciReceipt?.eligibleStore, false, 'scrape_save_store_eligibility_refused');
  assert.equal(ciReceipt?.publish_state, 'not_published', 'scrape_save_published_artifact_refused');
  assert.match(ciSourceSha ?? '', /^[a-f0-9]{40}$/, 'scrape_save_ci_source_required');
  assert.match(ciRunId ?? '', /^[1-9][0-9]*$/, 'scrape_save_ci_run_required');
  assert.match(ciArtifactId ?? '', /^[1-9][0-9]*$/, 'scrape_save_ci_artifact_required');
  assert.equal(ciReceipt.sourceSha, ciSourceSha, 'scrape_save_ci_source_mismatch');
  assert.equal(ciReceipt.runId, Number(ciRunId), 'scrape_save_ci_run_mismatch');
  assert.equal(ciReceipt.artifactId, Number(ciArtifactId), 'scrape_save_ci_artifact_mismatch');
  assert.equal(ciReceipt.treeSha256, receipt.treeSha256, 'scrape_save_ci_tree_mismatch');
  assert.equal(ciReceipt.version, receipt.version, 'scrape_save_ci_version_mismatch');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'scrape_save_tree_hash_mismatch');
  const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, receipt.version, 'scrape_save_version_mismatch');
  // The selected CI artifact may predate the harness checkout. Bind it to its receipt.
  assert.match(
    process.env.GITHUB_SHA ?? '',
    /^[a-f0-9]{40}$/,
    'scrape_save_harness_checkout_sha_required',
  );
  report.harness_checkout_sha = process.env.GITHUB_SHA;
  report.artifact = {
    kind: 'ci_development_test',
    eligible_store: false,
    source_sha: ciSourceSha,
    run_id: Number(ciRunId),
    artifact_id: Number(ciArtifactId),
    tree_sha256: receipt.treeSha256,
    version: receipt.version,
  };

  await runNativeSidepanelQa({
    headed: true,
    extensionDir,
    localDevReceiptPath: receiptPath,
    expectedRelease: receipt,
    artifactRoot: join(process.env.RUNNER_TEMP ?? '/tmp', 'guest-acceptance'),
    ownedPages: { '/source-acceptance': fixture },
    onStage: (value) => {
      report.native_stage = value;
    },
    exercisePanel: async (native) => {
      const { page, requireResourceHealth, resourceAction } = native;
      const { panel } = native;
      let primaryError;
      let cleanupError;
      let sourceId = null;
      let projectId = null;
      let projectFixture = null;
      let selectedOrganizationId = null;
      const url = new URL(page.url());
      url.pathname = '/source-acceptance';
      url.searchParams.set('run', `${runId}-${runAttempt}`);
      const sourceUrl = url.href;
      const identityUrl = new URL(sourceUrl);
      identityUrl.hash = '';
      const canonicalIdentity = identityUrl.href;

      const cleanup = async () => {
        if (!selectedOrganizationId) return { verified: true, no_write_possible: true };
        const remaining = await querySources(
          panel,
          canonicalIdentity,
          selectedOrganizationId,
          null,
        ).catch(() => null);
        const rows = Array.isArray(remaining?.rows) ? remaining.rows : [];
        const matching = rows.filter(
          (row) =>
            row?.organization_id === selectedOrganizationId &&
            row?.canonical_identity === canonicalIdentity &&
            row?.origin_client === 'extension' &&
            UUID.test(row?.id ?? ''),
        );
        if (matching.length === 0)
          return {
            verified: remaining?.status === 200,
            no_active_run_row: remaining?.status === 200,
          };
        assert.equal(matching.length, 1, 'scrape_save_cleanup_row_ambiguous');
        sourceId = matching[0].id;
        const detached = await associationRpc(
          panel,
          'assoc_remove_for_entity',
          selectedOrganizationId,
          {
            p_type: 'processed_document',
            p_id: sourceId,
          },
        );
        assert.ok([200, 204].includes(detached.status), 'scrape_save_association_cleanup_failed');
        const deleteRequest = restUrl('docproc', 'processed_documents', {
          id: `eq.${sourceId}`,
          organization_id: `eq.${selectedOrganizationId}`,
          canonical_identity: `eq.${canonicalIdentity}`,
          origin_client: 'eq.extension',
          deleted_at: 'is.null',
        });
        const deleted = await panelRest(panel, {
          ...deleteRequest,
          organizationId: selectedOrganizationId,
          method: 'PATCH',
          body: { deleted_at: new Date().toISOString() },
        });
        assert.ok([204, 205].includes(deleted.status), 'scrape_save_source_soft_delete_failed');
        const after = await querySources(panel, canonicalIdentity, selectedOrganizationId, null);
        assert.equal(after.status, 200, 'scrape_save_cleanup_lookup_failed');
        assert.deepEqual(after.rows, [], 'scrape_save_active_row_residue');
        const edges = await associationRpc(panel, 'assoc_for_entity', selectedOrganizationId, {
          p_type: 'processed_document',
          p_id: sourceId,
        });
        assert.equal(edges.status, 200, 'scrape_save_association_cleanup_read_failed');
        assert.deepEqual(edges.value, [], 'scrape_save_association_residue');
        return {
          verified: true,
          run_owned_source_soft_deleted: true,
          source_associations_removed: true,
        };
      };

      try {
        report.stage = 'member_auth';
        await requireResourceHealth();
        const identity = await resourceAction(() =>
          signInSettings({
            mode: 'member',
            page,
            panel,
            repo: REPO,
            memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
            allowLadderOrganization: true,
          }),
        );
        selectedOrganizationId = identity.organizationId;
        assert.equal(identity.web_signed_in, true, 'scrape_save_member_web_signin_missing');
        assert.equal(
          identity.extension_signed_in,
          true,
          'scrape_save_member_extension_signin_missing',
        );
        assert.equal(identity.admin_role, false, 'scrape_save_member_role_unverified');
        assert.equal(
          identity.canonical_nonadmin_check?.returned_rows,
          0,
          'scrape_save_member_canonical_role_check_unverified',
        );
        assert.equal(
          identity.organization_selected,
          true,
          'scrape_save_member_organization_missing',
        );
        assert.match(selectedOrganizationId ?? '', UUID, 'scrape_save_member_organization_invalid');
        report.authentication = {
          mode: 'member',
          web_signed_in: true,
          extension_signed_in: true,
          non_admin_role_verified: true,
          selected_organization_verified: true,
          organization_resolution: identity.organization_resolution,
        };

        if (destinationMode === 'project') {
          report.stage = 'owned_project_fixture';
          projectFixture = {
            id: randomUUID(),
            organizationId: selectedOrganizationId,
            ownerId: identity.profileId,
            name: `Northline acceptance project ${runId}-${runAttempt}`,
          };
          const projectRequest = projectFixtureRequest(projectFixture, 'POST');
          const createdProject = await panelRest(panel, {
            ...restUrl('projects', 'projects'),
            ...projectRequest,
          });
          assert.equal(createdProject.status, 201, 'scrape_save_project_fixture_create_failed');
          const fixtureLookup = projectFixtureRequest(projectFixture);
          const fixtureReadback = await panelRest(panel, {
            ...restUrl('projects', 'projects', fixtureLookup.filters),
            ...fixtureLookup,
          });
          assert.equal(fixtureReadback.status, 200, 'scrape_save_project_fixture_readback_failed');
          assert.equal(
            fixtureReadback.rows?.length,
            1,
            'scrape_save_project_fixture_owner_unverified',
          );
          assert.equal(
            fixtureReadback.rows[0].id,
            projectFixture.id,
            'scrape_save_project_fixture_id_mismatch',
          );
          assert.equal(
            fixtureReadback.rows[0].organization_id,
            projectFixture.organizationId,
            'scrape_save_project_fixture_org_mismatch',
          );
          assert.equal(
            fixtureReadback.rows[0].created_by,
            projectFixture.ownerId,
            'scrape_save_project_fixture_actor_mismatch',
          );
          assert.equal(
            fixtureReadback.rows[0].name,
            projectFixture.name,
            'scrape_save_project_fixture_name_mismatch',
          );
          report.observations.owned_project_fixture_created = true;
        } else {
          assert.equal(destinationMode, 'none', 'scrape_save_destination_invalid');
          report.observations.owned_project_fixture_created = false;
        }

        report.stage = 'owned_fixture';
        await resourceAction(() => page.goto(sourceUrl));
        assert.equal(
          await page.locator('main article h1').textContent(),
          captureHeading,
          'scrape_save_fixture_not_loaded',
        );
        const absent = await querySources(panel, canonicalIdentity, selectedOrganizationId, null);
        assert.equal(absent.status, 200, 'scrape_save_precondition_lookup_failed');
        assert.deepEqual(absent.rows, [], 'scrape_save_fixture_identity_already_exists');

        report.stage = 'capture';
        await resourceAction(() => click(panel, 'title', 'Scrape'));
        const empty = await waitFor(
          'scrape_save_empty_state',
          () =>
            evaluate(
              panel,
              `(() => { const root = ${activeTabPanelExpression('Scrape')}; return root?.textContent?.includes('Capture this page to extract content.') === true; })()`,
            ),
          (value) => value === true,
        );
        assert.equal(empty, true, 'scrape_save_initial_state_missing');
        await resourceAction(() =>
          click(panel, 'title', 'Capture the page exactly as it is right now'),
        );
        await waitFor(
          'scrape_save_capture_ready',
          () =>
            evaluate(
              panel,
              `(() => { const root = ${activeTabPanelExpression('Scrape')}; return { title: root?.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim() ?? null, save: [...(root?.querySelectorAll('button') ?? [])].some((button) => button.textContent.trim() === 'Save') }; })()`,
            ),
          (state) => state?.title === captureTitle && state.save,
          30000,
        );

        await click(panel, 'button-text', 'Article');
        const captureLayer = await waitFor(
          'scrape_save_capture_content_ready',
          () =>
            readCaptureArticleLayer(panel, {
              title: captureTitle,
              heading: captureHeading,
              marker:
                'Review the appointment details, collect the required forms, and confirm the time before arriving.',
            }),
          (state) => state?.article_layer_ready === true,
          30000,
        );
        report.observations.capture = captureLayer;

        report.stage = 'save_dialog';
        await resourceAction(() => click(panel, 'button-text', 'Save'));
        const dialog = await waitFor(
          'scrape_save_dialog_open',
          () => dialogState(panel),
          (state) => state?.open === true,
        );
        assert.equal(dialog.name, captureTitle, 'scrape_save_prefilled_name_mismatch');
        assert.equal(dialog.focusedName, true, 'scrape_save_initial_focus_missing');
        assert.equal(dialog.targetChipCount, 0, 'scrape_save_unexpected_initial_destination');
        assert.equal(dialog.saveButtonCount, 1, 'scrape_save_primary_action_not_unique');
        report.observations.name_input = {};
        await trustedType(
          panel,
          '[data-testid="save-source-form"] input[aria-label="Source name"]',
          sourceName,
          report.observations.name_input,
        );
        const typed = await waitFor(
          'scrape_save_custom_name_entered',
          () => dialogState(panel),
          (state) => state?.name === sourceName,
        );
        assert.equal(typed.name, sourceName, 'scrape_save_custom_name_not_entered');
        await trustedTab(panel);
        const tabbed = await dialogState(panel);
        assert.equal(tabbed.focusInside, true, 'scrape_save_tab_escaped_dialog');
        await trustedTab(panel, true);
        const reverseTabbed = await dialogState(panel);
        assert.equal(reverseTabbed.focusInside, true, 'scrape_save_shift_tab_escaped_dialog');
        report.observations = {
          ...report.observations,
          dialog_opened_from_captured_article: true,
          prefilled_name_visible: true,
          input_focused_on_open: true,
          no_destination_selected_by_default: true,
          custom_name_entered_by_trusted_keyboard: true,
          tab_and_shift_tab_contained: true,
        };

        if (destinationMode === 'project') {
          report.stage = 'project_association_choice';
          await resourceAction(() => click(panel, 'button-text', 'Choose a place'));
          await resourceAction(() => click(panel, 'button-text', 'Projects'));
          const candidate = await waitFor(
            'scrape_save_project_candidate_ready',
            async () => {
              const state = await evaluate(
                panel,
                `(() => {
                  const root = document.querySelector('[data-testid="save-source-form"] [aria-label="Place results"]');
                  const inputs = root?.querySelectorAll('input[aria-label="Search Projects"]') ?? [];
                  const buttons = [...(root?.querySelectorAll('li > button') ?? [])];
                  const available = buttons.filter((button) => button.getAttribute('aria-pressed') === 'false'
                    && Boolean(button.querySelector('span.flex-1')?.textContent?.trim()));
                  return { input_count: inputs.length, candidate_count: buttons.length,
                    loading: root?.textContent?.includes('Loading…') === true,
                    load_error: root?.textContent?.includes('Could not load places.') === true,
                    empty: root?.textContent?.includes('No places found.') === true,
                    labels: available.map((button) => button.querySelector('span.flex-1').textContent.trim()) };
                })()`,
              );
              report.observations.project_picker = {
                search_input_count: state?.input_count ?? null,
                candidate_count: state?.candidate_count ?? null,
                unselected_candidate_count: state?.labels?.length ?? null,
                loading: state?.loading === true,
                load_error: state?.load_error === true,
                empty: state?.empty === true,
              };
              return state;
            },
            (state) =>
              state?.input_count === 1 &&
              state.labels?.filter((label) => label === projectFixture.name).length === 1,
            30000,
          );
          const projectName = projectFixture.name;
          assert.ok(
            candidate.labels.includes(projectName),
            'scrape_save_owned_project_not_visible',
          );
          assert.ok(projectName, 'scrape_save_project_candidate_name_missing');
          await resourceAction(() => click(panel, 'button-text', projectName));
          const selected = await waitFor(
            'scrape_save_project_staged',
            () => dialogState(panel),
            (state) => state?.targetChipCount === 1 && state.targetLabel === projectName,
          );
          assert.equal(selected.targetLabel, projectName, 'scrape_save_project_not_staged');
          const projects = await queryProject(panel, projectName, selectedOrganizationId);
          assert.equal(projects.status, 200, 'scrape_save_project_lookup_failed');
          assert.ok(Array.isArray(projects.rows), 'scrape_save_project_lookup_body_invalid');
          assert.equal(projects.rows.length, 1, 'scrape_save_project_candidate_not_unique');
          assert.equal(projects.rows[0].name, projectName, 'scrape_save_project_name_mismatch');
          assert.equal(
            projects.rows[0].organization_id,
            selectedOrganizationId,
            'scrape_save_project_organization_mismatch',
          );
          assert.equal(
            projects.rows[0].id,
            projectFixture.id,
            'scrape_save_owned_project_id_mismatch',
          );
          projectId = projects.rows[0].id;
          assert.match(projectId ?? '', UUID, 'scrape_save_project_id_invalid');
          report.observations.project_selected_in_save_dialog = true;
          report.observations.project_matches_selected_organization = true;
        } else {
          report.observations.no_destination_retained_before_save =
            (await dialogState(panel)).targetChipCount === 0;
          assert.equal(
            report.observations.no_destination_retained_before_save,
            true,
            'scrape_save_unexpected_destination',
          );
        }

        report.stage = 'save_submit';
        const openBeforeSave = await dialogState(panel);
        assert.equal(openBeforeSave.open, true, 'scrape_save_dialog_closed_before_submit');
        await resourceAction(() => click(panel, 'button-text', 'Save Source'));
        const afterSave = await waitFor(
          'scrape_save_confirmation_visible',
          () => dialogState(panel),
          (state) => state?.open === false && state.savedButton === true,
          30000,
        );
        assert.equal(afterSave.savedButton, true, 'scrape_save_confirmation_missing');
        report.observations.dialog_closed_after_save = true;
        report.observations.saved_confirmation_visible = true;

        report.stage = 'source_independent_read';
        const saved = await waitFor(
          'scrape_save_source_row_observed',
          () => querySources(panel, canonicalIdentity, selectedOrganizationId, null),
          (value) => value?.status === 200 && value.rows?.length === 1,
          30000,
          (value) => ({
            status: value?.status ?? null,
            row_count: Array.isArray(value?.rows) ? value.rows.length : null,
          }),
        );
        const row = verifySourceRows(saved, canonicalIdentity, selectedOrganizationId, sourceName);
        sourceId = row.id;
        report.observations.source_row_read_from_service = true;
        report.observations.custom_name_persisted = true;
        report.observations.organization_scope_persisted = true;
        report.observations.original_file_id_present = true;
        report.observations.source_id = sourceId;
        report.observations.project_id = projectId;

        report.stage = 'association_independent_read';
        const edgeResult = await associationRpc(panel, 'assoc_for_entity', selectedOrganizationId, {
          p_type: 'processed_document',
          p_id: sourceId,
        });
        assert.equal(edgeResult.status, 200, 'scrape_save_association_lookup_failed');
        assert.ok(Array.isArray(edgeResult.value), 'scrape_save_association_lookup_body_invalid');
        verifyHostedScrapeSaveAssociations(
          destinationMode,
          edgeResult.value,
          projectId,
          selectedOrganizationId,
        );
        if (destinationMode === 'project') {
          report.observations.selected_project_edge_persisted = true;
        } else {
          report.observations.no_destination_associations_persisted = true;
        }

        report.stage = 'source_ui_reopen';
        await resourceAction(() =>
          reopenSavedSourceUi(
            panel,
            {
              name: sourceName,
              url: sourceUrl,
              title: captureTitle,
              heading: captureHeading,
              marker:
                'Review the appointment details, collect the required forms, and confirm the time before arriving.',
            },
            report.observations,
          ),
        );
      } catch (error) {
        primaryError = error;
      } finally {
        if (selectedOrganizationId) {
          try {
            report.cleanup = await resourceAction(cleanup);
          } catch (error) {
            cleanupError = error;
            report.cleanup = { verified: false, error_code: safeFailureCode(error) };
          }
        } else report.cleanup = { verified: true, no_write_possible: true };
        if (projectFixture) {
          try {
            report.project_cleanup = await cleanupProjectFixture(projectFixture, (request) =>
              panelRest(panel, { ...restUrl('projects', 'projects', request.filters), ...request }),
            );
          } catch (error) {
            cleanupError = error;
            report.project_cleanup = { verified: false, error_code: safeFailureCode(error) };
          }
        }
      }
      if (primaryError) throw primaryError;
      if (cleanupError) throw new Error('scrape_save_cleanup_failed');
      assert.equal(report.cleanup?.verified, true, 'scrape_save_cleanup_unverified');
      report.observations.cleanup_verified = true;
    },
  });
  report.status = 'pass';
  report.stage = 'complete';
} catch (error) {
  report.status = 'fail';
  report.failure_stage = report.stage;
  report.error_code = safeFailureCode(error);
  process.exitCode = 1;
  process.stderr.write(
    `SCRAPE_SAVE_NATIVE_ACCEPTANCE_FAILED ${report.stage} ${report.error_code}\n`,
  );
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/scrape-save-native-acceptance.json',
    `${JSON.stringify(report, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
}
