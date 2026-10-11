#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { panelIdentity, signInSettings } from './settings-native-auth-driver.mjs';
import {
  click,
  evaluate,
  profilePaneReady,
  profilePaneState,
  waitFor,
} from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const MODE = process.env.MATRX_ACCOUNT_POPOVER_ROLE;
const OUTPUT = join(REPO, 'test-results', `settings-account-popover-${MODE}.json`);
const CASES = {
  guest: ['T19', 'T22', 'T25'],
  member: ['T20', 'T23', 'T26'],
  admin: ['T21', 'T24', 'T27'],
};
assert.ok(Object.hasOwn(CASES, MODE), 'account_popover_role_invalid');

const report = {
  schema_version: 1,
  scope: 'receipt-bound disposable Chrome native side panel',
  role: MODE,
  status: 'unverified',
  cases: CASES[MODE].map((suffix) => ({
    id: `EXT-F-1001-${suffix}`,
    status: 'unverified',
    observations: [],
  })),
};
const caseAt = (index) => report.cases[index];

// Return only booleans/counts. Account text and credentials stay in the owned browser.
async function menuState(panel) {
  return evaluate(
    panel,
    `(() => {
    const triggers = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
      .filter((button) => button.title === 'Account' || button.title.includes('@'));
    const trigger = triggers.length === 1 ? triggers[0] : null;
    const content = trigger?.getAttribute('aria-controls')
      ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
    const open = trigger?.getAttribute('data-state') === 'open' &&
      content?.getAttribute('data-state') === 'open';
    const buttons = open ? [...content.querySelectorAll('button')] : [];
    const count = (label) => buttons.filter((button) => button.textContent.trim() === label).length;
    return { triggerCount: triggers.length, triggerState: trigger?.getAttribute('data-state') ?? null,
      contentState: content?.getAttribute('data-state') ?? null,
      openDialogCount: document.querySelectorAll('[role="dialog"][data-state="open"]').length,
      wrapperCount: open ? 1 : 0, profile: count('Profile'),
      preferences: count('Preferences'), signOut: count('Sign out'),
      guestHeader: open &&
        [...content.querySelectorAll('div')].some((node) =>
          node.children.length === 0 && node.textContent.trim() === 'Guest') };
  })()`,
  );
}

async function selectedTab(panel) {
  return evaluate(
    panel,
    `(() => {
    const selected = [...document.querySelectorAll('button[role="tab"][data-state="active"][title]')]
      .filter((button) => ['Chat', 'Profile', 'Settings'].includes(button.title));
    const tab = selected.length === 1 ? selected[0] : null;
    const pane = tab ? document.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
    return { count: selected.length, title: tab?.title ?? null,
      paneActive: pane?.matches('[role="tabpanel"][data-state="active"]') === true };
  })()`,
  );
}

async function openMenu(panel) {
  await waitFor(
    'account_avatar_ready',
    () =>
      evaluate(
        panel,
        `(() => {
    const buttons = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
      .filter((button) => button.title === 'Account' || button.title.includes('@'));
    return buttons.length === 1 && buttons[0].getBoundingClientRect().width > 0;
  })()`,
      ),
    (ready) => ready === true,
  );
  await click(panel, 'account-avatar', 'Account');
  return waitFor(
    'account_popover_open',
    () => menuState(panel),
    (s) => s?.triggerCount === 1 && s.wrapperCount === 1 && s.preferences === 1 && s.signOut === 1,
  );
}

async function closedMenu(panel) {
  return waitFor(
    'account_popover_closed',
    () => menuState(panel),
    (s) =>
      s?.triggerCount === 1 &&
      s.triggerState === 'closed' &&
      s.contentState !== 'open' &&
      s.openDialogCount === 0,
  );
}

async function retainedIdentity(panel, baseline) {
  const current = await panelIdentity(panel);
  assert.equal(current.accessTokenPresent, baseline.accessTokenPresent);
  assert.equal(current.profileId, baseline.profileId);
  assert.equal(current.isAdmin, baseline.isAdmin);
  return {
    accessTokenPresent: current.accessTokenPresent,
    profilePresent: Boolean(current.profileId),
    isAdmin: current.isAdmin,
  };
}

async function runCases(panel, baseline) {
  const profile = caseAt(0);
  const tabBeforeMenu = await selectedTab(panel);
  const firstMenu = await openMenu(panel);
  profile.observations.push({ menu: firstMenu });
  if (MODE === 'guest') {
    assert.equal(firstMenu.profile, 0, 'guest_profile_menu_must_be_absent');
    assert.deepEqual(await selectedTab(panel), tabBeforeMenu, 'guest_menu_changed_selected_tab');
    await retainedIdentity(panel, baseline);
  } else {
    assert.equal(firstMenu.profile, 1, 'signed_in_profile_menu_missing');
    await click(panel, 'account-menu', 'Profile');
    await closedMenu(panel);
    const destination = await waitFor(
      'profile_pane_active',
      () => profilePaneState(panel),
      profilePaneReady,
    );
    profile.observations.push({ destination, identity: await retainedIdentity(panel, baseline) });
  }
  profile.status = 'pass';

  const preferences = caseAt(1);
  const settingsMenu = MODE === 'guest' ? firstMenu : await openMenu(panel);
  assert.equal(settingsMenu.preferences, 1);
  await click(panel, 'account-menu', 'Preferences');
  await closedMenu(panel);
  const settings = await waitFor(
    'settings_selected',
    () => selectedTab(panel),
    (s) => s?.title === 'Settings' && s.paneActive === true,
  );
  preferences.observations.push({
    selected: settings,
    identity: await retainedIdentity(panel, baseline),
  });
  preferences.status = 'pass';

  const signOut = caseAt(2);
  const signOutMenu = await openMenu(panel);
  assert.equal(signOutMenu.signOut, 1);
  await click(panel, 'account-menu', 'Sign out');
  await closedMenu(panel);
  const guest = await waitFor(
    'signed_out_identity',
    () => panelIdentity(panel),
    (s) => s?.accessTokenPresent === false && s.profileId === null && s.isAdmin !== true,
  );
  const reopened = await openMenu(panel);
  assert.equal(reopened.guestHeader, true, 'guest_identity_not_rendered');
  assert.equal(reopened.profile, 0, 'profile_visible_after_signout');
  signOut.observations.push({
    guest: {
      accessTokenPresent: guest.accessTokenPresent,
      profilePresent: Boolean(guest.profileId),
      isAdmin: guest.isAdmin,
    },
    reopenedMenu: reopened,
  });
  await panel.send('Page.reload', { ignoreCache: true });
  const persistedGuest = await waitFor(
    'persisted_guest_after_reload',
    () => panelIdentity(panel),
    (s) => s?.accessTokenPresent === false && s.profileId === null && s.isAdmin !== true,
  );
  const persistedMenu = await openMenu(panel);
  assert.equal(persistedMenu.guestHeader, true, 'guest_header_lost_after_reload');
  assert.equal(persistedMenu.profile, 0, 'profile_visible_after_guest_reload');
  signOut.observations.push({
    persistedGuest: {
      accessTokenPresent: persistedGuest.accessTokenPresent,
      profilePresent: Boolean(persistedGuest.profileId),
      isAdmin: persistedGuest.isAdmin,
    },
    persistedMenu,
  });
  signOut.status = 'pass';
}

let failure;
try {
  const extensionDir = process.env.MATRX_ACCOUNT_POPOVER_EXTENSION_DIR;
  const receiptPath = process.env.MATRX_ACCOUNT_POPOVER_RECEIPT;
  assert.ok(extensionDir && receiptPath, 'account_popover_artifact_inputs_required');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.kind, 'local_dev_unpacked', 'account_popover_development_receipt_required');
  report.build = { kind: receipt.kind, sourceSha: receipt.sourceSha ?? null };
  await runNativeSidepanelQa({
    extensionDir,
    expectedRelease: receipt,
    releaseReceiptPath: receiptPath,
    localDevReceiptPath: receiptPath,
    exercisePanel: async ({ page, panel, activatePanel }) => {
      if (MODE !== 'guest') {
        const auth = await signInSettings({
          mode: MODE,
          page,
          panel,
          repo: REPO,
          adminCredentialsFile: process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE,
          memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
          allowLadderOrganization: MODE === 'member',
        });
        assert.equal(auth.extension_signed_in, true, 'extension_signin_unverified');
        if (MODE === 'member') assert.equal(auth.canonical_nonadmin_check?.returned_rows, 0);
        await activatePanel();
      }
      const baseline = await panelIdentity(panel);
      assert.equal(baseline.accessTokenPresent, MODE !== 'guest', 'role_session_mismatch');
      assert.equal(Boolean(baseline.profileId), MODE !== 'guest', 'role_profile_mismatch');
      if (MODE !== 'guest') assert.equal(baseline.isAdmin, MODE === 'admin', 'role_gate_mismatch');
      report.identity_before = {
        accessTokenPresent: baseline.accessTokenPresent,
        profilePresent: Boolean(baseline.profileId),
        isAdmin: baseline.isAdmin,
      };
      await runCases(panel, baseline);
    },
  });
  report.status = 'pass';
} catch (error) {
  failure = error;
  report.status = 'fail';
  report.failure = String(error?.message ?? error).split(':', 1)[0];
} finally {
  await mkdir(join(REPO, 'test-results'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
}
if (failure) throw failure;
