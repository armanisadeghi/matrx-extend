#!/usr/bin/env node
/** Receipt-bound, read-only native visibility discovery for a fresh role profile. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { signInSettings } from './settings-native-auth-driver.mjs';
import {
  activeTabPanelExpression,
  click,
  evaluate,
  openSection,
  waitFor,
} from './settings-panel-driver.mjs';

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
const requiredSettingsSections = new Set(
  [...settingsSections].filter((label) => label !== 'Advanced agent capabilities'),
);
export const CONTROL_SELECTOR = [
  'button',
  'summary',
  '[tabindex]',
  '[aria-expanded]',
  '[aria-controls]',
  '[role="tab"]',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(', ');

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
    } else {
      assert.match(
        item.label_fingerprint ?? '',
        /^[a-f0-9]{64}$/,
        'census_unkeyed_unknown_refused',
      );
      unmapped.push({
        kind: item.kind,
        label_fingerprint: item.label_fingerprint,
      });
    }
  }
  return {
    total: observations.length,
    mapped,
    unmapped_count: unmapped.length,
    unmapped,
    unsupported_trigger_count: ['navigation', 'section'].includes(scope)
      ? observations.filter((item) => item.safe_to_open === false).length
      : 0,
  };
}

function fingerprintScript(key) {
  assert.match(key ?? '', /^[A-Za-z0-9+/]{43}=$/, 'census_fingerprint_key_required');
  return `const keyPromise = crypto.subtle.importKey('raw',
    Uint8Array.from(atob(${JSON.stringify(key)}), (char) => char.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const fingerprint = async (label) => [...new Uint8Array(await crypto.subtle.sign('HMAC',
    await keyPromise, new TextEncoder().encode(label)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');`;
}

export function discoveryExpression(scope, fingerprintKey) {
  const captureTab = scope === 'navigation';
  const selector = CONTROL_SELECTOR;
  const knownLabels = captureTab ? [...knownTabs] : [...settingsSections];
  return `(async () => {
    const known = new Set(${JSON.stringify(knownLabels)});
    const captureTab = ${captureTab};
    ${fingerprintScript(fingerprintKey)}
    const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' &&
        s.visibility !== 'hidden' && !el.closest('[inert]'); };
    const scopeRoot = captureTab ? document : ${activeTabPanelExpression('Settings')};
    if (!scopeRoot) return [];
    // Inventory every semantic interactive trigger outside content regions, not only
    // the markup our trusted click driver happens to support. Unknowns never click.
    const candidates = [...scopeRoot.querySelectorAll(${JSON.stringify(selector)})].filter(visible);
    const sectionContents = [...scopeRoot.querySelectorAll('[aria-expanded][aria-controls]')]
      .map(el => document.getElementById(el.getAttribute('aria-controls'))).filter(Boolean);
    const triggers = candidates.filter(el => captureTab
      ? !el.closest('[role="tabpanel"]')
      : !el.closest('[role="tablist"]') &&
        !sectionContents.some(content => content.contains(el)) &&
        (!el.closest('details') || el.tagName === 'SUMMARY'));
    return Promise.all(triggers.map(async (el) => { const label = (el.getAttribute('aria-label') || el.getAttribute('title') ||
          el.getAttribute('data-matrx-title') || el.textContent || '').trim().slice(0, 256);
        const nativeShape = captureTab
          ? el.matches('button[role="tab"][title][aria-controls]') && el.title === label
          : el.matches('button[aria-expanded][aria-controls]') && el.textContent.trim() === label;
        const sameLabel = triggers.filter(other => (other.getAttribute('aria-label') ||
          other.getAttribute('title') || other.getAttribute('data-matrx-title') || other.textContent || '').trim().slice(0, 256) === label);
        return { kind: el.getAttribute('role') || el.tagName.toLowerCase(),
          safe_to_open: nativeShape && !el.disabled && sameLabel.length === 1 &&
            (known.has(label) || (captureTab && /^[1-9][0-9]* pages? need your browser$/.test(label))),
          ...(known.has(label) || (captureTab && /^[1-9][0-9]* pages? need your browser$/.test(label))
            ? { label } : { label_fingerprint: await fingerprint(label) }) };
      }));
  })()`;
}

export async function observeGuestAuthentication(panel) {
  const state = await evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get([
      'matrx.auth.accessToken', 'matrx.auth.refreshTokenEnc', 'matrx.auth.refreshTokenIv',
      'matrx.user.profile', 'matrx.user.isAdmin',
    ]);
    const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !el.closest('[inert]'); };
    const settingsPane = ${activeTabPanelExpression('Settings')};
    const headers = [...(settingsPane?.querySelectorAll('button[aria-expanded="true"][aria-controls]') ?? [])]
      .filter(el => visible(el) && el.textContent.trim() === 'Account');
    const content = headers.length === 1 ? document.getElementById(headers[0].getAttribute('aria-controls')) : null;
    const buttons = [...(settingsPane?.querySelectorAll('button') ?? [])].filter(visible);
    return {
      access_token_present: stored['matrx.auth.accessToken'] != null,
      refresh_token_present: stored['matrx.auth.refreshTokenEnc'] != null || stored['matrx.auth.refreshTokenIv'] != null,
      profile_present: stored['matrx.user.profile'] != null,
      admin_role: stored['matrx.user.isAdmin'] === true,
      account_visible: Boolean(content && visible(content)),
      sign_in_visible: buttons.some(el => el.textContent.trim() === 'Sign in' && !el.disabled),
      sign_out_visible: buttons.some(el => el.textContent.trim() === 'Sign out'),
    };
  })()`,
  );
  assert.ok(
    state &&
      state.account_visible === true &&
      state.sign_in_visible === true &&
      state.sign_out_visible === false &&
      state.access_token_present === false &&
      state.refresh_token_present === false &&
      state.profile_present === false &&
      state.admin_role === false,
    'census_guest_signed_out_unverified',
  );
  return { role: 'guest', signed_out_observed: true, ...state };
}

async function prepareGuestObservation(panel, fingerprintKey) {
  const tabs = await evaluate(panel, discoveryExpression('navigation', fingerprintKey));
  assert.ok(
    tabs.some((tab) => tab.label === 'Settings' && tab.safe_to_open),
    'census_guest_settings_unavailable',
  );
  await click(panel, 'title', 'Settings');
  const sections = await waitFor(
    'census_guest_account_ready',
    () => evaluate(panel, discoveryExpression('section', fingerprintKey)),
    (items) =>
      Array.isArray(items) &&
      items.some((section) => section.label === 'Account' && section.safe_to_open),
  );
  assert.ok(
    sections.some((section) => section.label === 'Account' && section.safe_to_open),
    'census_guest_account_unavailable',
  );
  await openSection(panel, 'Account');
  return waitFor(
    'census_guest_signed_out',
    () => observeGuestAuthentication(panel),
    (state) => state?.signed_out_observed === true,
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

export function settingsControlsExpression(section, fingerprintKey) {
  return `(async () => {
    const known = new Set(${JSON.stringify([...controlsByLabel.keys(), ...controlAliases.keys()])});
    ${fingerprintScript(fingerprintKey)}
    const header = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(section)});
    const id = header?.getAttribute('aria-controls');
    const content = id ? document.getElementById(id) : null;
    if (!content) return null;
    const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    return Promise.all([...content.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)})]
      .filter(visible).map(async (el) => { const label = (el.getAttribute('aria-label') ||
        (el.tagName === 'A' ? el.textContent : null) || el.getAttribute('title') ||
        el.closest('label')?.textContent || el.textContent || '').trim().slice(0, 256);
        return { kind: el.getAttribute('role') || el.tagName.toLowerCase(),
          ...(known.has(label) ? { label } : { label_fingerprint: await fingerprint(label) }) };
      }));
  })()`;
}

async function settingsControls(panel, section, fingerprintKey) {
  return evaluate(panel, settingsControlsExpression(section, fingerprintKey));
}

async function census(panel, fingerprintKey) {
  const navigationRaw = await evaluate(panel, discoveryExpression('navigation', fingerprintKey));
  const navigation = mapObservation('navigation', navigationRaw);
  const surfaces = {};
  const navigation_actions = [];
  const inaccessible_regions = [];
  if (!navigationRaw.some((item) => item.label === 'Settings'))
    inaccessible_regions.push({ region: 'settings_tab', reason: 'absent' });
  // Trusted clicks only on direct tab triggers. Profile and action controls stay untouched.
  for (const tab of navigationRaw) {
    if (!isKnownTab(tab.label) || !tab.safe_to_open) {
      inaccessible_regions.push({
        region: 'unmapped_tab',
        ...(tab.label ? { label: tab.label } : { label_fingerprint: tab.label_fingerprint }),
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
      ${fingerprintScript(fingerprintKey)}
      const tab = document.querySelector('button[role="tab"][title=${JSON.stringify(tab.label)}]');
      const pane = tab?.getAttribute('aria-controls')
        ? document.getElementById(tab.getAttribute('aria-controls')) : null;
      if (!pane) return null;
      const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
      return Promise.all([...pane.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)})]
        .filter(visible).map(async (el) => { const label = (el.getAttribute('aria-label') ||
          (el.tagName === 'A' ? el.textContent : null) || el.getAttribute('title') ||
          el.getAttribute('data-matrx-title') || el.textContent || '').trim().slice(0, 256);
          return { kind: el.getAttribute('role') || el.tagName.toLowerCase(),
            ...(known.has(label) ? { label } : { label_fingerprint: await fingerprint(label) }) };
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
  let settingsAvailable = navigationRaw.some(
    (item) => item.label === 'Settings' && item.safe_to_open,
  );
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
    ? await evaluate(panel, discoveryExpression('section', fingerprintKey))
    : [];
  const sections = mapObservation('section', sectionRaw);
  const controls = {};
  for (const section of sectionRaw) {
    if (!settingsSections.has(section.label) || !section.safe_to_open) {
      inaccessible_regions.push({
        region: 'unmapped_expander',
        ...(section.label
          ? { label: section.label }
          : { label_fingerprint: section.label_fingerprint }),
        reason: 'not_opened_without_source_mapping',
      });
      continue;
    }
    navigation_actions.push({ kind: 'settings_section', label: section.label });
    try {
      await openSection(panel, section.label);
      const sectionRawControls = await settingsControls(panel, section.label, fingerprintKey);
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
  const unsupported = buckets.reduce(
    (sum, bucket) => sum + (bucket.unsupported_trigger_count ?? 0),
    0,
  );
  const unmapped = buckets.reduce((sum, bucket) => sum + bucket.unmapped_count, 0);
  const missingRequiredRegions = [];
  if (
    observation.authentication?.role === 'guest' &&
    (observation.authentication.signed_out_observed !== true ||
      observation.authentication_after?.signed_out_observed !== true)
  )
    missingRequiredRegions.push('guest_signed_out_evidence');
  if (!observation.navigation?.total) missingRequiredRegions.push('navigation');
  const visibleTabs = new Set(observation.navigation?.mapped.map((item) => item.label) ?? []);
  if (!visibleTabs.has('Settings')) missingRequiredRegions.push('settings_tab');
  for (const tab of visibleTabs)
    if (tab !== 'Settings' && !Object.hasOwn(observation.surfaces, tab))
      missingRequiredRegions.push(`tab:${tab}`);
  if (!observation.sections?.total) missingRequiredRegions.push('settings_sections');
  const visibleSections = new Set(observation.sections?.mapped.map((item) => item.label) ?? []);
  for (const section of requiredSettingsSections)
    if (!visibleSections.has(section)) missingRequiredRegions.push(`settings_section:${section}`);
  for (const section of visibleSections)
    if (!Object.hasOwn(observation.controls, section))
      missingRequiredRegions.push(`settings_content:${section}`);
  return {
    complete:
      blockedTotal === 0 &&
      unmapped === 0 &&
      unsupported === 0 &&
      observation.inaccessible_regions.length === 0 &&
      missingRequiredRegions.length === 0,
    unmapped_total: unmapped,
    unsupported_trigger_count: unsupported,
    inaccessible_count: observation.inaccessible_regions.length,
    blocked_request_count: blockedTotal,
    missing_required_regions: missingRequiredRegions,
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
  const fingerprintKey = randomBytes(32).toString('base64');
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir: EXTENSION_DIR,
    localDevReceiptPath: RECEIPT,
    expectedRelease: { version: receipt.version, treeSha256: evidence.treeSha256 },
    expectedExtensionId: EXPECTED_ID,
    exercisePanel: async ({ page, panel, activatePanel, attachWorker }) => {
      let authentication;
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
        if (ROLE === 'guest') authentication = await prepareGuestObservation(panel, fingerprintKey);
        observation = { authentication, ...(await census(panel, fingerprintKey)) };
        if (ROLE === 'guest') {
          await openSection(panel, 'Account');
          observation.authentication_after = await observeGuestAuthentication(panel);
        }
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
