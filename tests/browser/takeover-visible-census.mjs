#!/usr/bin/env node
/** Receipt-bound, read-only native visibility discovery for a fresh role profile. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
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
// The universally available non-Chat surfaces in src/config/sidepanel-visibility.ts.
// Missing navigation is a census gap even if an earlier surface bucket still exists.
const requiredEveryoneSurfaceTabs = new Set(['Scrape', 'Data', 'SEO']);
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
// These labels are emitted by exact source-rendered Settings rows in
// SettingsView.tsx. Selected values and action text remain fingerprinted.
// The paired input and button are two observed nodes of one inventory control.
const settingsRowControls = new Map([
  ['Appearance|Theme|combobox', 'EXT-F-1003-C02'],
  ['Chat|Default mode|combobox', 'EXT-F-1003-C04'],
  ['Chat|Default speed|combobox', 'EXT-F-1003-C05'],
  ['Scrape|Auto-scrape mode|combobox', 'EXT-F-1003-C29'],
  ['Desktop bridge|Pair code|input', 'EXT-F-1003-C15'],
  ['Desktop bridge|Pair code|button', 'EXT-F-1003-C15'],
  ['Desktop bridge|Local engine port|input', 'EXT-F-1003-C16'],
  ['Desktop bridge|Local engine port|button', 'EXT-F-1003-C16'],
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
  const structural = [];
  const rowCounts = new Map();
  if (scope === 'settings_control')
    for (const item of observations) {
      const { section, row_label: rowLabel } = item.provenance ?? {};
      if (!section || !rowLabel) continue;
      const key = `${section}|${rowLabel}|${item.kind}`;
      rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
    }
  for (const item of observations) {
    const { row_label: observedRowLabel, ...otherProvenance } = item.provenance ?? {};
    const observedRowKey = `${otherProvenance.section}|${observedRowLabel}|${item.kind}`;
    const provenance = item.provenance
      ? {
          ...otherProvenance,
          ...(settingsRowControls.has(observedRowKey) ? { row_label: observedRowLabel } : {}),
        }
      : undefined;
    if (item.classification === 'structural') {
      structural.push({
        kind: item.kind,
        provenance,
        ...(item.label_fingerprint ? { label_fingerprint: item.label_fingerprint } : {}),
      });
      continue;
    }
    const label = item.label;
    const { section, row_label: rowLabel } = provenance ?? {};
    const rowKey = `${section}|${rowLabel}|${item.kind}`;
    const rowId =
      scope === 'settings_control' && item.label_fingerprint && rowCounts.get(rowKey) === 1
        ? settingsRowControls.get(rowKey)
        : undefined;
    const id =
      scope === 'navigation' && item.classification === 'navigation' && isKnownTab(label)
        ? 'EXT-F-1001-C01'
        : scope === 'section' && item.classification === 'section' && settingsSections.has(label)
          ? 'EXT-F-1003-C10'
          : scope === 'settings_control'
            ? (controlsByLabel.get(label) ?? controlAliases.get(label) ?? rowId)
            : scope === 'surface_control'
              ? uniqueControlIds.get(label)
              : undefined;
    if (id) {
      const feature = featureById.get(id.split('-C')[0]);
      mapped.push({
        id,
        label: label ?? rowLabel,
        applicability: feature?.applicability?.[ROLE] ?? null,
        ...(item.classification ? { classification: item.classification } : {}),
        ...(provenance ? { provenance } : {}),
      });
    } else {
      if (item.label)
        assert.ok(
          scope === 'navigation'
            ? isKnownTab(item.label)
            : scope === 'section'
              ? settingsSections.has(item.label)
              : scope === 'settings_control'
                ? controlsByLabel.has(item.label) || controlAliases.has(item.label)
                : uniqueControlIds.has(item.label),
          'census_unkeyed_unknown_refused',
        );
      else
        assert.match(
          item.label_fingerprint ?? '',
          /^[a-f0-9]{64}$/,
          'census_unkeyed_unknown_refused',
        );
      unmapped.push({
        kind: item.kind,
        ...(item.label ? { label: item.label } : { label_fingerprint: item.label_fingerprint }),
        ...(item.classification ? { classification: item.classification } : {}),
        ...(provenance ? { provenance } : {}),
      });
    }
  }
  return {
    total: observations.length,
    mapped,
    unmapped_count: unmapped.length,
    unmapped,
    structural_count: structural.length,
    structural,
    action_count: observations.filter((item) => item.classification === 'action').length,
    unsupported_trigger_count: ['navigation', 'section'].includes(scope)
      ? observations.filter(
          (item) =>
            ['navigation', 'section'].includes(item.classification) && item.safe_to_open === false,
        ).length
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

// Only structural DOM facts and source-owned anchors leave the page. Attribute text,
// hrefs, input values, and generated IDs can contain private data.
const provenanceScript = `const safeRole = (el) => {
  const role = el.getAttribute('role');
  return /^(tablist|tab|tabpanel|button|link|switch|combobox|checkbox|radio|menuitem|option)$/.test(role ?? '') ? role : null;
};
const provenance = (el, order) => {
  const path = []; let node = el;
  while (node?.nodeType === 1 && path.length < 8) {
    const tag = node.tagName.toLowerCase();
    const siblings = [...(node.parentElement?.children ?? [])].filter(child => child.tagName === node.tagName);
    path.unshift(tag + ':' + siblings.indexOf(node));
    node = node.parentElement;
  }
  const region = el.closest('[role="tabpanel"]') ? 'tabpanel'
    : el.closest('[role="tablist"]') ? 'tablist'
      : el.closest('header') ? 'header' : 'outside_panel';
  const anchor = el.getAttribute('data-census-id');
  return { tag: el.tagName.toLowerCase(), role: safeRole(el),
    dom_order: order, region, dom_path: path.join('/'),
    ...(anchor && /^EXT-F-[0-9]{4}-C[0-9]{2}$/.test(anchor) ? { source_anchor: anchor } : {}) };
};`;

export function discoveryExpression(scope, fingerprintKey) {
  const captureTab = scope === 'navigation';
  const selector = CONTROL_SELECTOR;
  const knownLabels = captureTab ? [...knownTabs] : [...settingsSections];
  return `(async () => {
    const known = new Set(${JSON.stringify(knownLabels)});
    const captureTab = ${captureTab};
    ${fingerprintScript(fingerprintKey)}
    ${provenanceScript}
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
    return Promise.all(triggers.map(async (el, order) => { const label = (el.getAttribute('aria-label') || el.getAttribute('title') ||
          el.getAttribute('data-matrx-title') || el.textContent || '').trim().slice(0, 256);
        const nativeShape = captureTab
          ? el.matches('button[role="tab"][title][aria-controls]') && el.title === label
          : el.matches('button[aria-expanded][aria-controls]') && el.textContent.trim() === label;
        const sameLabel = triggers.filter(other =>
          (captureTab ? other.matches('[role="tab"]') : other.matches('[aria-expanded], summary')) &&
          (other.getAttribute('aria-label') ||
          other.getAttribute('title') || other.getAttribute('data-matrx-title') || other.textContent || '').trim().slice(0, 256) === label);
        const classification = captureTab
          ? el.matches('[role="tablist"]') ? 'structural'
            : el.matches('[role="tab"]') ? 'navigation' : 'action'
          : el.matches('[role="tabpanel"]') ? 'structural'
            : el.matches('[aria-expanded], summary') ? 'section' : 'action';
        return { kind: safeRole(el) || el.tagName.toLowerCase(),
          classification, provenance: provenance(el, order),
          safe_to_open: nativeShape && !el.disabled && sameLabel.length === 1 &&
            classification === (captureTab ? 'navigation' : 'section') &&
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

function receiptBoundary(stage, target, safe, cause) {
  const error = new Error('census_receipt_boundary_failed', { cause });
  error.receiptDiagnostic = { stage, target, ...safe };
  return error;
}

export async function readBrowserVersion(browserSession) {
  let version;
  try {
    version = await browserSession.send('Browser.getVersion');
  } catch (cause) {
    throw receiptBoundary(
      'browser_version_send',
      'owned_browser',
      { version_observed: false },
      cause,
    );
  }
  if (
    !/^(?:Chrome|HeadlessChrome)\/[0-9.]+$/.test(version?.product ?? '') ||
    !/^[0-9]+\.[0-9]+$/.test(version?.protocolVersion ?? '')
  )
    throw receiptBoundary('browser_version_validate', 'owned_browser', { version_observed: false });
  return { product: version.product, protocol_version: version.protocolVersion };
}

export async function frameGuestAccount(panel, authentication) {
  assert.equal(authentication?.signed_out_observed, true, 'census_guest_signed_out_unverified');
  let frame;
  try {
    frame = await evaluate(
      panel,
      `(() => {
      const pane = ${activeTabPanelExpression('Settings')};
      const headers = [...(pane?.querySelectorAll('button[aria-expanded="true"][aria-controls]') ?? [])]
        .filter(el => el.textContent.trim() === 'Account');
      const header = headers.length === 1 ? headers[0] : null;
      const content = header ? document.getElementById(header.getAttribute('aria-controls')) : null;
      const signIn = [...(pane?.querySelectorAll('button') ?? [])]
        .find(el => el.textContent.trim() === 'Sign in' && !el.disabled);
      if (header && content && signIn) header.scrollIntoView({ block: 'start', inline: 'nearest' });
      const inViewport = el => { if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
          r.top < innerHeight && r.left < innerWidth;
      };
      const fullyInViewport = el => { if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 &&
          r.bottom <= innerHeight && r.right <= innerWidth;
      };
      return { account_header_in_viewport: fullyInViewport(header),
        account_content_in_viewport: inViewport(content), sign_in_in_viewport: fullyInViewport(signIn) };
    })()`,
    );
  } catch (cause) {
    throw receiptBoundary(
      'guest_account_frame',
      'sidepanel_account',
      {
        signed_out_observed: true,
        account_header_in_viewport: false,
        account_content_in_viewport: false,
        sign_in_in_viewport: false,
      },
      cause,
    );
  }
  if (
    !frame?.account_header_in_viewport ||
    !frame.account_content_in_viewport ||
    !frame.sign_in_in_viewport
  )
    throw receiptBoundary('guest_account_viewport', 'sidepanel_account', {
      signed_out_observed: true,
      account_header_in_viewport: frame?.account_header_in_viewport === true,
      account_content_in_viewport: frame?.account_content_in_viewport === true,
      sign_in_in_viewport: frame?.sign_in_in_viewport === true,
    });
  return frame;
}

export async function captureGuestReadiness(panel, output, authentication) {
  const frame = await frameGuestAccount(panel, authentication);
  const safe = {
    signed_out_observed: true,
    ...frame,
    screenshot_received: false,
    bytes_decoded: 0,
  };
  let response;
  try {
    response = await panel.send('Page.captureScreenshot', { format: 'png' });
  } catch (cause) {
    throw receiptBoundary('guest_screenshot_send', 'sidepanel_account', safe, cause);
  }
  safe.screenshot_received = typeof response?.data === 'string';
  let bytes;
  try {
    if (
      !safe.screenshot_received ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(response.data) ||
      response.data.length % 4 !== 0
    )
      throw new Error('invalid_screenshot_data');
    bytes = Buffer.from(response.data, 'base64');
    if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('invalid_png_header');
    safe.bytes_decoded = bytes.length;
  } catch (cause) {
    throw receiptBoundary('guest_screenshot_decode', 'sidepanel_account', safe, cause);
  }
  const path = `${output}.guest-account-readiness.png`;
  let handle;
  try {
    handle = await open(path, 'a+', 0o600);
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(bytes);
  } catch (cause) {
    throw receiptBoundary('guest_screenshot_write', 'sidepanel_account', safe, cause);
  } finally {
    if (handle)
      await handle.close().catch((cause) => {
        throw receiptBoundary('guest_screenshot_close', 'sidepanel_account', safe, cause);
      });
  }
  return path;
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
    const staticPillRows = ${JSON.stringify({ Organization: ['Acting as'], Appearance: ['Theme'], Chat: ['Default mode', 'Default speed'], Scrape: ['Auto-scrape mode'] })};
    ${fingerprintScript(fingerprintKey)}
    ${provenanceScript}
    const header = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(section)});
    const id = header?.getAttribute('aria-controls');
    const content = id ? document.getElementById(id) : null;
    if (!content) return null;
    const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const candidateLabel = (el) => {
      const row = el.parentElement?.parentElement;
      if (!row) return null;
      const children = [...row.children];
      let label = null;
      if (el.matches('button[role="combobox"]') && children.length === 2 &&
          children[1] === el.parentElement && el.parentElement.children.length === 1) {
        const labelSpan = children[0].firstElementChild;
        if (labelSpan?.tagName === 'SPAN' && labelSpan.textContent === labelSpan.firstChild?.textContent &&
            (staticPillRows[${JSON.stringify(section)}] ?? []).includes(labelSpan.textContent))
          label = labelSpan.textContent;
      } else if (${JSON.stringify(section)} === 'Desktop bridge' &&
          ['INPUT', 'BUTTON'].includes(el.tagName)) {
        const direct = [...el.parentElement.children];
        if (direct[0]?.tagName === 'INPUT' && direct[0].getAttribute('placeholder') === 'Pair code' &&
            direct[1]?.tagName === 'BUTTON' && direct[1].textContent.trim() === 'Pair' &&
            direct.length === 2 && direct.includes(el)) label = 'Pair code';
        else if (direct[0]?.tagName === 'SPAN' && direct[0].textContent === 'Local engine port' &&
            direct[1]?.tagName === 'INPUT' && direct[1].getAttribute('placeholder') === 'auto' &&
            direct[2]?.tagName === 'BUTTON' && ['Set', 'Save'].includes(direct[2].textContent.trim()) &&
            (direct.length === 3 || (direct.length === 4 && direct[3].tagName === 'SPAN' &&
              direct[3].textContent === 'override')) && direct.slice(1, 3).includes(el))
          label = 'Local engine port';
      }
      return label;
    };
    const rowLabel = (el) => {
      const label = candidateLabel(el);
      if (!label) return null;
      // A copied static row is ambiguous; only the sole matching source shape can testify.
      const same = [...content.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)})]
        .filter(visible).filter(other => other !== el && other.parentElement !== el.parentElement &&
          candidateLabel(other) === label);
      return same.length === 0 ? label : null;
    };
    return Promise.all([...content.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)})]
      .filter(visible).map(async (el, order) => { const label = (el.getAttribute('aria-label') ||
        (el.tagName === 'A' ? el.textContent : null) || el.getAttribute('title') ||
        el.closest('label')?.textContent || el.textContent || '').trim().slice(0, 256);
        const staticRowLabel = rowLabel(el);
        const { source_anchor: _unverifiedAnchor, ...safeProvenance } = provenance(el, order);
        return { kind: safeRole(el) || el.tagName.toLowerCase(),
          provenance: { ...safeProvenance, section: ${JSON.stringify(section)},
            ...(staticRowLabel ? { row_label: staticRowLabel } : {}) },
          ...(known.has(label) ? { label } : { label_fingerprint: await fingerprint(label) }) };
      }));
  })()`;
}

async function settingsControls(panel, section, fingerprintKey) {
  return evaluate(panel, settingsControlsExpression(section, fingerprintKey));
}

export async function collectTabSurface(panel, tabLabel, fingerprintKey, timeoutMs = 10000) {
  const readinessLabels = {
    Scrape: ['Retry page check', 'Capture this page', 'Capture', 'Re-capture', 'Scroll & capture'],
    Data: ['Pick fields on this page', 'Picking on page…', 'Sign in to save'],
    SEO: ['Audit this page', 'Re-audit'],
  };
  let last = null;
  let stableCount = null;
  let stableReads = 0;
  const read = () =>
    evaluate(
      panel,
      `(async () => {
      const known = new Set(${JSON.stringify([...uniqueControlIds.keys()])});
      ${fingerprintScript(fingerprintKey)}
      ${provenanceScript}
      const tab = document.querySelector('button[role="tab"][title=${JSON.stringify(tabLabel)}]');
      const pane = tab?.getAttribute('aria-controls')
        ? document.getElementById(tab.getAttribute('aria-controls')) : null;
      if (!pane) return { pane_present: false, witness_visible: false, raw: null };
      const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
      const controls = [...pane.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)})].filter(visible);
      const witnesses = ${JSON.stringify(readinessLabels[tabLabel] ?? null)};
      const witness_visible = witnesses === null ? controls.length > 0 :
        controls.some(el => el.tagName === 'BUTTON' && witnesses.includes(el.textContent.trim()));
      const raw = await Promise.all(controls
        .map(async (el, order) => { const label = (el.getAttribute('aria-label') ||
          (el.tagName === 'A' ? el.textContent : null) || el.getAttribute('title') ||
          el.getAttribute('data-matrx-title') || el.textContent || '').trim().slice(0, 256);
          return { kind: safeRole(el) || el.tagName.toLowerCase(),
            provenance: { ...provenance(el, order), tab: ${JSON.stringify(tabLabel)} },
            ...(known.has(label) ? { label } : { label_fingerprint: await fingerprint(label) }) };
        }));
      return { pane_present: true, witness_visible, raw };
    })()`,
    );
  try {
    const settled = await waitFor(
      'census_surface_controls',
      async () => {
        last = await read();
        return last;
      },
      (state) => {
        if (!state?.pane_present || !state.witness_visible || !state.raw?.length) {
          stableReads = 0;
          stableCount = null;
          return false;
        }
        stableReads = stableCount === state.raw.length ? stableReads + 1 : 1;
        stableCount = state.raw.length;
        return stableReads >= 2;
      },
      timeoutMs,
    );
    return { raw: settled.raw, ready: true };
  } catch {
    return {
      raw: last?.raw ?? null,
      ready: false,
      diagnostic: {
        stage: 'surface_readiness',
        tab: tabLabel,
        pane_present: last?.pane_present === true,
        visible_control_count: last?.raw?.length ?? 0,
        witness_visible: last?.witness_visible === true,
      },
    };
  }
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
    if (tab.classification !== 'navigation') continue;
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
      const {
        raw: surfaceRaw,
        ready,
        diagnostic,
      } = await collectTabSurface(panel, tab.label, fingerprintKey);
      if (!surfaceRaw)
        inaccessible_regions.push({
          region: 'tab_content',
          label: tab.label,
          reason: 'panel_missing',
          ...(diagnostic ? { diagnostic } : {}),
        });
      else {
        surfaces[tab.label] = mapObservation('surface_control', surfaceRaw);
        if (!ready)
          inaccessible_regions.push({
            region: 'tab_content',
            label: tab.label,
            reason: 'controls_not_ready',
            diagnostic,
          });
      }
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
    if (section.classification !== 'section') continue;
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
  for (const tab of new Set([...visibleTabs, ...requiredEveryoneSurfaceTabs]))
    if (tab !== 'Settings' && (!visibleTabs.has(tab) || !observation.surfaces[tab]?.total))
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
  let observedBrowser;
  let guestReadinessScreenshot;
  const fingerprintKey = randomBytes(32).toString('base64');
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir: EXTENSION_DIR,
    localDevReceiptPath: RECEIPT,
    expectedRelease: { version: receipt.version, treeSha256: evidence.treeSha256 },
    expectedExtensionId: EXPECTED_ID,
    exercisePanel: async ({ page, panel, browserSession, activatePanel, attachWorker }) => {
      observedBrowser = await readBrowserVersion(browserSession);
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
        if (ROLE === 'guest') {
          authentication = await prepareGuestObservation(panel, fingerprintKey);
          guestReadinessScreenshot = await captureGuestReadiness(panel, OUTPUT, authentication);
        }
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
    observed_browser: observedBrowser,
    ...(guestReadinessScreenshot && {
      guest_account_readiness_screenshot: guestReadinessScreenshot,
    }),
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
        ...(error?.receiptDiagnostic ? { diagnostic: error.receiptDiagnostic } : {}),
      })}\n`,
    );
    process.exitCode = 2;
  });
