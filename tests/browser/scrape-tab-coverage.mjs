import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withClipboardReadPermission } from './clipboard-observation.mjs';
import { click, evaluate } from './settings-panel-driver.mjs';

export function captureExportFingerprint(value, { mode, url, title }) {
  assert.ok(typeof value === 'string' && value.length > 100, 'scrape_capture_export_missing');
  let identity;
  if (mode === 'admin') {
    let payload;
    try {
      payload = JSON.parse(value);
    } catch {
      throw new Error('scrape_capture_json_invalid');
    }
    assert.equal(payload?.url, url, 'scrape_capture_export_url_mismatch');
    assert.equal(payload?.article?.title, title, 'scrape_capture_export_title_mismatch');
    assert.ok(Number.isFinite(payload?.capturedAt), 'scrape_capture_export_identity_missing');
    identity = String(payload.capturedAt);
  } else {
    assert.ok(
      value.startsWith('The following is a full Matrx scrape result for a webpage.'),
      'scrape_capture_export_kind_mismatch',
    );
    assert.ok(value.includes(`- Source URL: ${url}`), 'scrape_capture_export_url_mismatch');
    assert.ok(value.includes(`- Title: ${title}`), 'scrape_capture_export_title_mismatch');
    assert.ok(value.includes('```markdown\n'), 'scrape_capture_export_body_missing');
    identity = value.match(/^- Captured: ([^\n]+)$/m)?.[1];
    assert.ok(
      identity && Number.isFinite(Date.parse(identity)),
      'scrape_capture_export_identity_missing',
    );
  }
  return {
    digest: createHash('sha256').update(value).digest('hex'),
    bytes: Buffer.byteLength(value),
    identity,
    format: mode === 'admin' ? 'full_capture_json' : 'full_capture_ai_markdown',
  };
}

export function assertCaptureExportUnchanged(before, after, phase) {
  if (after?.identity !== before?.identity)
    throw new Error(`scrape_${phase}_capture_identity_changed`);
  if (after?.digest !== before?.digest) throw new Error(`scrape_${phase}_capture_payload_changed`);
  return {
    export_format: before.format,
    bytes_compared: before.bytes,
    identity_unchanged: true,
    exported_payload_unchanged: true,
  };
}

export async function readCaptureExport({
  panel,
  browserSession,
  panelUrl,
  mode,
  url,
  title,
  resourceAction,
  requireResourceHealth,
}) {
  await requireResourceHealth();
  const sentinel = 'MATRX_QA_CAPTURE_EXPORT_SENTINEL';
  const seeded = await evaluate(
    panel,
    `(async () => { await navigator.clipboard.writeText(${JSON.stringify(sentinel)}); return true; })()`,
  );
  assert.equal(seeded, true, 'scrape_capture_export_seed_failed');
  await resourceAction(() => click(panel, 'title', 'Copy capture'));
  await resourceAction(() =>
    click(panel, 'scrape-copy-option', mode === 'admin' ? 'Full capture (JSON)' : 'For AI agent'),
  );
  const permissionEvidence = {};
  const value = await withClipboardReadPermission({
    browserSession,
    panel,
    panelUrl,
    evidence: permissionEvidence,
    read: () => evaluate(panel, '(async () => navigator.clipboard.readText())()'),
  });
  assert.equal(
    permissionEvidence.clipboardObservationPermissionRestored,
    true,
    'scrape_capture_export_permission_not_restored',
  );
  assert.notEqual(value, sentinel, 'scrape_capture_export_not_copied');
  await requireResourceHealth();
  return captureExportFingerprint(value, { mode, url, title });
}

export function capturePaneSnapshot(state) {
  assert.equal(state?.visible, true, 'scrape_capture_pane_hidden');
  assert.ok(typeof state.resultText === 'string', 'scrape_capture_pane_text_missing');
  return {
    selected: state.selected,
    title: state.title,
    text: state.resultText,
    tabs: state.tabs?.map(({ label, selected }) => ({ label, selected })),
    media: state.media && {
      tabCount: state.media.tabCount,
      imageItems: state.media.imageItems?.map(({ href, src, alt }) => ({ href, src, alt })),
      videoItems: state.media.videoItems,
      linkItems: state.media.linkItems,
    },
  };
}

export async function verifyCaptureUnchanged({
  panel,
  baseline,
  labels,
  click,
  resourceAction,
  requireResourceHealth,
  scrapeState,
  waitFor,
  phase,
}) {
  const observed = {};
  for (const label of labels) {
    await requireResourceHealth();
    await resourceAction(() => click(panel, 'scrape-result-tab', label));
    const state = await waitFor(
      `scrape_${phase}_${label}_invariance`,
      () => scrapeState(panel),
      (value) => value?.selected === label && value.visible && typeof value.resultText === 'string',
    );
    await requireResourceHealth();
    const snapshot = capturePaneSnapshot(state);
    assert.deepEqual(snapshot, baseline[label], `scrape_${phase}_${label}_capture_changed`);
    observed[label] = snapshot;
  }
  return { panes_compared: Object.keys(observed), unchanged: true };
}

export async function observeEmptyMediaPanes({
  panel,
  phase,
  click,
  resourceAction,
  requireResourceHealth,
  observeSelectedMedia,
  evaluate,
  scrapeState,
}) {
  const evidence = {};
  for (const label of ['Images', 'Video']) {
    await requireResourceHealth();
    await resourceAction(() => click(panel, 'scrape-result-tab', label));
    await requireResourceHealth();
    evidence[label.toLowerCase()] = await observeSelectedMedia({
      panel,
      label,
      items: [],
      name: `scrape_${phase}_empty_${label}_tab`,
      evaluate,
      scrapeState,
    });
  }
  return evidence;
}

export function assertCompleteTabCoverage({ warm, reload }) {
  for (const [phase, evidence] of Object.entries({ warm, reload })) {
    assert.equal(
      evidence?.invariance?.unchanged,
      true,
      `scrape_${phase}_capture_invariance_missing`,
    );
    assert.equal(
      evidence.invariance.export?.identity_unchanged,
      true,
      `scrape_${phase}_export_identity_invariance_missing`,
    );
    assert.equal(
      evidence.invariance.export?.exported_payload_unchanged,
      true,
      `scrape_${phase}_export_payload_invariance_missing`,
    );
    assert.deepEqual(
      evidence.invariance.panes_compared,
      ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'],
      `scrape_${phase}_capture_panes_missing`,
    );
    for (const label of ['images', 'video']) {
      assert.equal(
        evidence?.empty?.[label]?.pane,
        label === 'images' ? 'Images' : 'Video',
        `scrape_${phase}_${label}_empty_pane_missing`,
      );
      assert.equal(evidence.empty[label].state, 'empty', `scrape_${phase}_${label}_not_empty`);
      assert.equal(evidence.empty[label].count, 0, `scrape_${phase}_${label}_empty_count`);
    }
  }
  return true;
}
