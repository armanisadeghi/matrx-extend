#!/usr/bin/env node
/** Bounded guest census in the resource guard's owned native sidepanel harness. */
import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalDevReceipt } from '../../scripts/record-local-dev-build.mjs';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION_DIR = join(ROOT, '.output/chrome-mv3-dev');
const SCRATCH = '/Volumes/Samsung2TB/code/.stabilization-scratch';
const EXTENSION_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const NAV = [
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
];
const SECTIONS = [
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
];
const CONTROLS = [
  'Theme',
  'Default agent',
  'Default mode',
  'Default speed',
  'Share page identity & email content',
  'Offer to save logins to the Vault',
  'Offer saved logins on sign-in forms',
  'Show password suggestions on websites',
  'Deep clean',
  'Auto-scrape on load',
  'Auto-scrape mode',
  'Local engine port',
  'Clear local data on this device',
  'Check for extension update',
];

function refuse(code) {
  const error = new Error(code);
  error.censusCode = code;
  throw error;
}

async function preflight() {
  if (
    !/^[0-9a-f-]{36}$/.test(process.env.MATRX_RESOURCE_OWNER ?? '') ||
    !process.env.MATRX_RESOURCE_RUN_ID ||
    !process.env.MATRX_RESOURCE_STOP_FILE
  )
    refuse('CENSUS_RESOURCE_OWNER_REQUIRED');
  const callerTmpdir = process.env.TMPDIR;
  if (!callerTmpdir || !isAbsolute(callerTmpdir)) refuse('CENSUS_TMPDIR_REQUIRED');
  const scratch = await realpath(callerTmpdir).catch(() => refuse('CENSUS_SCRATCH_REFUSED'));
  if (scratch !== SCRATCH || !(await stat(scratch)).isDirectory()) refuse('CENSUS_SCRATCH_REFUSED');
  if ((await realpath(tmpdir())) !== scratch) refuse('CENSUS_TMPDIR_REFUSED');
  const callerReceipt = process.env.CENSUS_DEV_BUILD_RECEIPT;
  if (!callerReceipt || !isAbsolute(callerReceipt)) refuse('CENSUS_RECEIPT_PATH_REQUIRED');
  const receiptPath = await realpath(callerReceipt).catch(() => refuse('CENSUS_RECEIPT_REFUSED'));
  if (dirname(receiptPath) !== (await realpath(join(ROOT, 'test-results'))))
    refuse('CENSUS_RECEIPT_PATH_REFUSED');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const dev = requireLocalDevReceipt(receipt, EXTENSION_DIR);
  const manifest = JSON.parse(await readFile(join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  if (
    dev.version !== pkg.version ||
    manifest.version !== dev.version ||
    typeof manifest.key !== 'string' ||
    !manifest.key ||
    hashReleaseTree(EXTENSION_DIR) !== dev.treeSha256
  )
    refuse('CENSUS_RECEIPT_REFUSED');
  return { scratch, dev, receiptPath };
}

// Only fixed source labels and counts leave the real extension document.
async function knownVisible(panel, selector, labels) {
  return evaluate(
    panel,
    `(() => {
    const labels = ${JSON.stringify(labels)};
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && !el.closest('[inert]');
    };
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(visible);
    return {
      known: labels.filter((label) => nodes.some((el) =>
        (el.title || el.getAttribute('aria-label') || el.textContent.trim()) === label)),
      total: nodes.length,
    };
  })()`,
  );
}

async function sectionControls(panel, section) {
  return evaluate(
    panel,
    `(() => {
    const section = ${JSON.stringify(section)};
    const labels = ${JSON.stringify(CONTROLS)};
    const trigger = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === section);
    const content = trigger?.getAttribute('aria-controls')
      ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
    if (!content || trigger.getAttribute('aria-expanded') !== 'true')
      return { open: false, animating: false, known: [], total: 0 };
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && !el.closest('[inert]');
    };
    const nodes = [...content.querySelectorAll('button, [role="switch"], [role="combobox"], span')]
      .filter(visible);
    return {
      open: true,
      animating: content.getAnimations({ subtree: true })
        .some((animation) => animation.playState === 'running'),
      known: labels.filter((label) => nodes.some((el) =>
        (el.getAttribute('aria-label') || el.textContent.trim()) === label)),
      total: nodes.length,
    };
  })()`,
  );
}

async function censusGuest(panel, version) {
  const navigation = await knownVisible(panel, 'button[role="tab"][title]', NAV);
  if (!navigation.known.includes('Settings')) refuse('CENSUS_SETTINGS_TAB_MISSING');
  await click(panel, 'title', 'Settings');
  await waitFor(
    'census_settings_guest',
    () =>
      evaluate(
        panel,
        `(() => {
      const active = document.querySelector('button[title="Settings"][data-state="active"]');
      const text = document.body?.innerText ?? '';
      return { active: Boolean(active), guest: text.includes('Sign in to choose'),
        adminSection: [...document.querySelectorAll('button[aria-expanded]')]
          .some((el) => el.textContent.trim() === 'Advanced agent capabilities') };
    })()`,
      ),
    (state) => state?.active && state.guest && !state.adminSection,
  );
  const sections = await knownVisible(panel, 'button[aria-expanded]', SECTIONS);
  const controls = {};
  for (const section of SECTIONS) {
    if (!sections.known.includes(section)) continue;
    await openSection(panel, section); // Trusted pointer on a section header only.
    controls[section] = await waitFor(
      'census_section_settled',
      () => sectionControls(panel, section),
      (state) => state?.open && !state.animating,
    );
  }
  const identity = await evaluate(
    panel,
    `(() => ({
    extensionId: chrome.runtime.id,
    version: chrome.runtime.getManifest().version,
  }))()`,
  );
  assert.equal(identity.extensionId, EXTENSION_ID, 'CENSUS_EXTENSION_ID_MISMATCH');
  assert.equal(identity.version, version, 'CENSUS_VERSION_MISMATCH');
  return { navigation, sections, controls, identity };
}

async function main() {
  const { scratch, dev, receiptPath } = await preflight();
  let census;
  const native = await runNativeSidepanelQa({
    headed: true,
    extensionDir: EXTENSION_DIR,
    localDevReceiptPath: receiptPath,
    expectedRelease: { version: dev.version, treeSha256: dev.treeSha256 },
    expectedExtensionId: EXTENSION_ID,
    artifactRoot: scratch,
    exercisePanel: async ({ panel }) => {
      census = await censusGuest(panel, dev.version);
    },
  });
  if (!native.verified || native.extensionId !== EXTENSION_ID || !census)
    refuse('CENSUS_NATIVE_VERIFICATION_MISSING');
  process.stdout.write(
    `${JSON.stringify({
      schema_version: 1,
      code: 'CENSUS_GUEST_NATIVE_OBSERVED',
      at: new Date().toISOString(),
      role: 'guest',
      profile: 'fresh external scratch profile',
      artifact: { version: dev.version, tree_sha256: dev.treeSha256 },
      runtime_identity: census.identity,
      navigation: census.navigation,
      sections: census.sections,
      controls_by_section: census.controls,
      native_panel_verified: native.verified,
      member_admin: 'unverified',
    })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        code: error?.censusCode ?? 'CENSUS_FAILED',
        at: new Date().toISOString(),
        native_guest_observed: false,
      })}\n`,
    );
    process.exitCode = 2;
  });
}
