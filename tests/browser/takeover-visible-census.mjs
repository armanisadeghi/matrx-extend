#!/usr/bin/env node
/** Receipt-bound, read-only native visibility discovery for a fresh role profile. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const ROLE = process.env.MATRX_CENSUS_ROLE;
const EXTENSION_DIR = process.env.MATRX_CENSUS_EXTENSION_DIR;
const RECEIPT = process.env.MATRX_CENSUS_RECEIPT;
const OUTPUT = process.env.MATRX_CENSUS_OUTPUT;
const EXPECTED_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const knownTabs = new Set([
  'Chat',
  'Pilot (admin only — sandboxed tab group)',
  'Plan & tasks',
  'Tasks',
  'Agenda',
  'Scrape',
  'Saved captures',
  'Capture',
  'Data',
  'SEO',
  'Highlights',
  'Guidance',
  'Notes',
  'Files',
  'Screenshots',
  'Vault',
  'Tools',
  'Settings',
  'Showcase (admin only)',
  'Token broker (admin only)',
  'Debug (admin only)',
  'Pages that need your browser',
]);
const captureCountLabel = /^[1-9][0-9]* pages? need your browser$/;
const isKnownTab = (label) => knownTabs.has(label) || captureCountLabel.test(label ?? '');
const inventory = JSON.parse(
  await readFile(join(ROOT, 'docs/stabilization/inventory.json'), 'utf8'),
);
const settings = inventory.features.find((feature) => feature.id === 'EXT-F-1003');
const controlsByLabel = new Map(settings.controls.map((control) => [control.label, control.id]));
const featureById = new Map(inventory.features.map((feature) => [feature.id, feature]));
const globalControlLabels = new Map();
for (const feature of inventory.features)
  for (const control of feature.controls ?? []) {
    const ids = globalControlLabels.get(control.label) ?? [];
    ids.push(control.id);
    globalControlLabels.set(control.label, ids);
  }
const uniqueControlIds = new Map(
  [...globalControlLabels]
    .filter(([, ids]) => ids.length === 1)
    .map(([label, ids]) => [label, ids[0]]),
);
const controlAliases = new Map([
  ['Offer to save logins to the Vault', 'EXT-F-1003-C07'],
  ['Local engine port', 'EXT-F-1003-C16'],
  ['Clear local data on this device', 'EXT-F-1003-C17'],
  ['Check for extension update', 'EXT-F-1003-C31'],
]);
const settingsSections = new Set([
  'Account',
  'Organization',
  'Appearance',
  'Chat',
  'Privacy',
  'Scrape',
  'Data',
  'SEO',
  'Desktop bridge',
  'Data & reset',
  'About',
  'Advanced agent capabilities',
]);

export function mapObservation(scope, observations) {
  assert.ok(['navigation', 'section', 'settings_control', 'surface_control'].includes(scope));
  const mapped = [];
  const unmapped = [];
  for (const item of observations) {
    const label = item.label;
    const id =
      scope === 'navigation' && isKnownTab(label)
        ? 'EXT-F-1001-C01'
        : scope === 'section' && settingsSections.has(label)
          ? 'EXT-F-1003-C10'
          : scope === 'settings_control'
            ? (controlsByLabel.get(label) ?? controlAliases.get(label))
            : scope === 'surface_control'
              ? uniqueControlIds.get(label)
              : undefined;
    if (id) {
      const feature = featureById.get(id.split('-C')[0]);
      mapped.push({ id, label, applicability: feature?.applicability?.[ROLE] ?? null });
    } else
      unmapped.push({
        kind: item.kind,
        label_sha256:
          item.label_sha256 ??
          createHash('sha256')
            .update(String(label ?? ''))
            .digest('hex'),
        label_length: item.label_length ?? String(label ?? '').length,
      });
  }
  return { total: observations.length, mapped, unmapped_count: unmapped.length, unmapped };
}

const digestInPage = `async (label) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(label)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')`;

async function visible(panel, selector, knownLabels = [], captureTab = false) {
  return evaluate(
    panel,
    `(async () => {
    const known = new Set(${JSON.stringify(knownLabels)});
    const captureTab = ${captureTab};
    const digest = ${digestInPage};
    const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' &&
        s.visibility !== 'hidden' && !el.closest('[inert]'); };
    return Promise.all([...document.querySelectorAll(${JSON.stringify(selector)})].filter(visible)
      .map(async (el) => { const label = (el.getAttribute('aria-label') || el.getAttribute('title') ||
          el.getAttribute('data-matrx-title') || el.textContent || '').trim().slice(0, 256);
        return { kind: el.getAttribute('role') || el.tagName.toLowerCase(),
          ...(known.has(label) || (captureTab && /^[1-9][0-9]* pages? need your browser$/.test(label))
            ? { label } : { label_sha256: await digest(label), label_length: label.length }) };
      }));
  })()`,
  );
}

export async function mutationGuard(panel) {
  let attempts = 0;
  const blocked = {};
  const off = panel.on('Fetch.requestPaused', (event) => {
    try {
      const url = new URL(event.request.url);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method?.toUpperCase())
      ) {
        attempts++;
        const boundary =
          url.hostname === 'db.matrxserver.com'
            ? 'database'
            : url.hostname === 'server.app.matrxserver.com'
              ? 'aidream'
              : 'other_http';
        const kind = url.pathname.startsWith('/rest/v1/rpc/')
          ? 'rpc_post_unclassified'
          : 'nonread_method';
        const key = `${boundary}:${kind}`;
        blocked[key] = (blocked[key] ?? 0) + 1;
        void panel.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Aborted',
        });
        return;
      }
    } catch {
      /* Extension and data URLs continue. */
    }
    void panel.send('Fetch.continueRequest', { requestId: event.requestId });
  });
  await panel.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  return {
    count: () => attempts,
    blocked: () => ({ ...blocked }),
    close: async () => {
      off();
      await panel.send('Fetch.disable');
    },
  };
}

async function settingsControls(panel, section) {
  return evaluate(
    panel,
    `(async () => {
    const known = new Set(${JSON.stringify([...controlsByLabel.keys(), ...controlAliases.keys()])});
    const digest = ${digestInPage};
    const header = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(section)});
    const id = header?.getAttribute('aria-controls');
    const content = id ? document.getElementById(id) : null;
    if (!content) return null;
    const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    return Promise.all([...content.querySelectorAll('button, [role="switch"], [role="combobox"], input')]
      .filter(visible).map(async (el) => { const label = (el.getAttribute('aria-label') ||
        el.getAttribute('title') || el.closest('label')?.textContent || el.textContent || '').trim().slice(0, 256);
        return { kind: el.getAttribute('role') || el.tagName.toLowerCase(),
          ...(known.has(label) ? { label } : { label_sha256: await digest(label), label_length: label.length }) };
      }));
  })()`,
  );
}

async function census(panel) {
  const navigationRaw = await visible(panel, 'button[role="tab"][title]', [...knownTabs], true);
  const navigation = mapObservation('navigation', navigationRaw);
  const surfaces = {};
  const navigation_actions = [];
  const inaccessible_regions = [];
  if (!navigationRaw.some((item) => item.label === 'Settings'))
    inaccessible_regions.push({ region: 'settings_tab', reason: 'absent' });
  // Trusted clicks only on direct tab triggers. Profile and action controls stay untouched.
  for (const tab of navigationRaw) {
    if (!isKnownTab(tab.label)) {
      inaccessible_regions.push({
        region: 'unmapped_tab',
        label_sha256: tab.label_sha256,
        reason: 'not_opened_without_source_mapping',
      });
      continue;
    }
    if (tab.label === 'Settings') continue;
    navigation_actions.push({ kind: 'direct_tab', label: tab.label });
    try {
      await click(panel, 'title', tab.label);
      await waitFor(
        'census_tab_active',
        () =>
          evaluate(
            panel,
            `Boolean(document.querySelector('button[role="tab"][title=${JSON.stringify(tab.label)}][data-state="active"]'))`,
          ),
        Boolean,
      );
      const surfaceRaw = await evaluate(
        panel,
        `(async () => {
      const known = new Set(${JSON.stringify([...uniqueControlIds.keys()])});
      const digest = ${digestInPage};
      const tab = document.querySelector('button[role="tab"][title=${JSON.stringify(tab.label)}]');
      const pane = tab?.getAttribute('aria-controls')
        ? document.getElementById(tab.getAttribute('aria-controls')) : null;
      if (!pane) return null;
      const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
      return Promise.all([...pane.querySelectorAll('button, [role="switch"], [role="combobox"], input')]
        .filter(visible).map(async (el) => { const label = (el.getAttribute('aria-label') ||
          el.getAttribute('title') || el.getAttribute('data-matrx-title') || el.textContent || '').trim().slice(0, 256);
          return { kind: el.getAttribute('role') || el.tagName.toLowerCase(),
            ...(known.has(label) ? { label } : { label_sha256: await digest(label), label_length: label.length }) };
        }));
    })()`,
      );
      if (!surfaceRaw)
        inaccessible_regions.push({
          region: 'tab_content',
          label: tab.label,
          reason: 'panel_missing',
        });
      else surfaces[tab.label] = mapObservation('surface_control', surfaceRaw);
    } catch {
      inaccessible_regions.push({
        region: 'tab_content',
        label: tab.label,
        reason: 'inspection_failed',
      });
    }
  }
  let settingsAvailable = navigationRaw.some((item) => item.label === 'Settings');
  if (settingsAvailable)
    try {
      navigation_actions.push({ kind: 'direct_tab', label: 'Settings' });
      await click(panel, 'title', 'Settings');
      await waitFor(
        'census_settings_active',
        () =>
          evaluate(
            panel,
            'Boolean(document.querySelector(\'button[role="tab"][title="Settings"][data-state="active"]\'))',
          ),
        Boolean,
      );
    } catch {
      settingsAvailable = false;
      inaccessible_regions.push({ region: 'settings_tab', reason: 'inspection_failed' });
    }
  const sectionRaw = settingsAvailable
    ? await visible(panel, 'button[aria-expanded]', [...settingsSections])
    : [];
  const sections = mapObservation('section', sectionRaw);
  const controls = {};
  for (const section of sectionRaw) {
    if (!settingsSections.has(section.label)) {
      inaccessible_regions.push({
        region: 'unmapped_expander',
        label_sha256: section.label_sha256,
        reason: 'not_opened_without_source_mapping',
      });
      continue;
    }
    navigation_actions.push({ kind: 'settings_section', label: section.label });
    try {
      await openSection(panel, section.label);
      const sectionRawControls = await settingsControls(panel, section.label);
      if (!sectionRawControls)
        inaccessible_regions.push({
          region: 'settings_section',
          label: section.label,
          reason: 'content_missing',
        });
      else controls[section.label] = mapObservation('settings_control', sectionRawControls);
    } catch {
      inaccessible_regions.push({
        region: 'settings_section',
        label: section.label,
        reason: 'inspection_failed',
      });
    }
  }
  const identity = await evaluate(
    panel,
    '({ extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version })',
  );
  return {
    navigation,
    surfaces,
    sections,
    controls,
    navigation_actions,
    inaccessible_regions,
    identity,
  };
}

export function censusCompleteness(observation, blockedTotal) {
  const buckets = [
    observation.navigation,
    observation.sections,
    ...Object.values(observation.surfaces),
    ...Object.values(observation.controls),
  ];
  const unmapped = buckets.reduce((sum, bucket) => sum + bucket.unmapped_count, 0);
  return {
    complete: blockedTotal === 0 && unmapped === 0 && observation.inaccessible_regions.length === 0,
    unmapped_total: unmapped,
    inaccessible_count: observation.inaccessible_regions.length,
    blocked_request_count: blockedTotal,
  };
}

async function main() {
  assert.ok(['guest', 'member', 'admin'].includes(ROLE), 'census_role_required');
  assert.ok(EXTENSION_DIR && RECEIPT && OUTPUT, 'census_artifact_inputs_required');
  assert.ok(
    process.env.MATRX_RESOURCE_OWNER &&
      process.env.MATRX_RESOURCE_RUN_ID &&
      process.env.MATRX_RESOURCE_STOP_FILE,
    'census_resource_guard_required',
  );
  const evidence = await verifyImportedNativeEvidence(EXTENSION_DIR, RECEIPT);
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  assert.equal(evidence.eligibleStore, false, 'census_ci_development_only');
  assert.equal(evidence.sourceSha, process.env.MATRX_CENSUS_SOURCE_SHA, 'census_source_mismatch');
  assert.equal(evidence.runId, Number(process.env.MATRX_CENSUS_CI_RUN_ID), 'census_run_mismatch');
  assert.equal(
    evidence.artifactId,
    Number(process.env.MATRX_CENSUS_ARTIFACT_ID),
    'census_artifact_mismatch',
  );
  let observation;
  let interception;
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir: EXTENSION_DIR,
    localDevReceiptPath: RECEIPT,
    expectedRelease: { version: receipt.version, treeSha256: evidence.treeSha256 },
    expectedExtensionId: EXPECTED_ID,
    exercisePanel: async ({ page, panel, activatePanel, attachWorker }) => {
      let authentication = { role: 'guest' };
      if (ROLE !== 'guest') {
        const signedIn = await signInSettings({
          mode: ROLE,
          page,
          panel,
          repo: ROOT,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
          memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
          onStage: () => {},
        });
        authentication = {
          role: ROLE,
          web_signed_in: signedIn.web_signed_in,
          extension_signed_in: signedIn.extension_signed_in,
          admin_role: signedIn.admin_role,
          rendered_identity: signedIn.rendered_identity,
        };
        await activatePanel();
      }
      const worker = await attachWorker();
      let panelGuard;
      let workerGuard;
      try {
        panelGuard = await mutationGuard(panel);
        workerGuard = await mutationGuard(worker);
        observation = { authentication, ...(await census(panel)) };
        interception = {
          scope: ['sidepanel', 'extension_worker'],
          effect: 'HTTP(S) methods other than GET/HEAD/OPTIONS aborted during observation',
          blocked_request_count: panelGuard.count() + workerGuard.count(),
          sidepanel: panelGuard.blocked(),
          extension_worker: workerGuard.blocked(),
        };
      } finally {
        if (panelGuard) await panelGuard.close();
        if (workerGuard) await workerGuard.close();
        await worker.detach();
      }
    },
  });
  assert.equal(native.verified, true, 'census_native_unverified');
  assert.equal(observation.identity.extensionId, EXPECTED_ID, 'census_extension_id_mismatch');
  assert.equal(observation.identity.version, receipt.version, 'census_version_mismatch');
  const completeness = censusCompleteness(observation, interception.blocked_request_count);
  const report = {
    schema_version: 2,
    status: completeness.complete ? 'observed' : 'incomplete',
    role: ROLE,
    observation_only: true,
    build_channel: 'ci_development_test',
    artifact: {
      version: receipt.version,
      source_sha: evidence.sourceSha,
      ci_run_id: evidence.runId,
      artifact_id: evidence.artifactId,
      tree_sha256: evidence.treeSha256,
    },
    ...observation,
    completeness,
    interception,
    unmapped_total: completeness.unmapped_total,
    native_panel_verified: native.verified,
  };
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      role: ROLE,
      unmapped_total: report.unmapped_total,
      output: OUTPUT,
    })}\n`,
  );
  if (!completeness.complete) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        code: error?.message?.startsWith('census_') ? error.message : 'census_unverified',
        role: ROLE ?? 'unknown',
      })}\n`,
    );
    process.exitCode = 2;
  });
