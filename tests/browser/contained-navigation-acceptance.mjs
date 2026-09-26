#!/usr/bin/env node
/**
 * EXT-F-1001 contained native-panel batch. The root guard owns execution.
 * Records target evidence, never promotes a subset to full inventory cases.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(REPO, 'test-results', 'contained-navigation-acceptance.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const GUEST = ['Scrape', 'Data', 'SEO', 'Settings'];
const ADMIN = [
  'Plan & tasks',
  'Tasks',
  'Agenda',
  'Saved captures',
  'Highlights',
  'Guidance',
  'Notes',
  'Files',
  'Screenshots',
  'Vault',
  'Tools',
  'Showcase (admin only)',
  'Token broker (admin only)',
  'Debug (admin only)',
];
// The Capture trigger's title is a queue sentence, not the static tab name.
// Keep this narrow to the three forms in captureTabLabel().
function isCaptureTitle(title) {
  return (
    title === 'Pages that need your browser' ||
    /^\d+ pages? need your browser(?: — \d+ more waiting in another workspace)?$/.test(title) ||
    /^Nothing needs your browser here — \d+ waiting in another workspace$/.test(title)
  );
}
// App owns the one tablist outside a tabpanel. Force-mounted feature panels
// (notably Showcase's 12 text-labeled tabs) own separate, nested tablists.
// Never filter on title or visibility: an untitled or hidden main trigger must
// remain in the exact roster, while a hidden feature's tabs are not navigation.
const NAVIGATION_SCOPE = `
    const allTabs = [...document.querySelectorAll('[role="tab"]')];
    const lists = [...document.querySelectorAll('[role="tablist"]')]
      .filter((el) => !el.closest('[role="tabpanel"]'));
    const list = lists.length === 1 ? lists[0] : null;
    const tabs = allTabs.filter((el) => list && el.closest('[role="tablist"]') === list);
    const panes = [...document.querySelectorAll('[role="tabpanel"]')]
      .filter((el) => !el.parentElement?.closest('[role="tabpanel"]'));
    const activePanes = panes.filter((el) => el.getAttribute('data-state') === 'active');
    const pane = activePanes.length === 1 ? activePanes[0] : null;
`;
const LAZY_VIEW_MARKERS = {
  Data: 'Structured data',
  SEO: 'SEO audit',
  Settings: 'Settings',
};
const report = {
  schema_version: 1,
  feature_id: 'EXT-F-1001',
  status: 'unverified',
  scope: 'owned disposable Chrome profile, released artifact, real native sidepanel',
  targets: [],
  deferred: [
    { target: 'Chat and Pilot systematic actions', reason: 'separate ownership' },
    { target: 'member role', reason: 'no member credential in this batch' },
    {
      target: 'stale persisted selection',
      reason: 'requires a real role transition with selection preserved',
    },
    {
      target: 'lazy chunk failure and retry',
      reason: 'no natural chunk failure observed; no response interception',
    },
    {
      target: 'Vault assistance active',
      reason: 'requires naturally active credential assistance',
    },
  ],
  admin_prerequisite: {
    stage: 'not_started',
    web: {
      expectedOrigin: null,
      loginPath: null,
      credentialFileReadable: null,
      credentialVariablesAvailable: null,
      formAvailable: null,
      submitClickCompleted: false,
      dashboardReached: false,
    },
    extension: {
      accountReady: null,
      signInAvailable: null,
      beforeClick: null,
      signInClickCompleted: false,
      lastObserved: null,
      observationReadFailed: false,
    },
  },
  admin_tab_inventory: null,
  profile_attempt: null,
  navigation_surfaces: {},
};
let stage = 'owned_profile';
const advance = (next) => {
  stage = next;
  report.admin_prerequisite.stage = next;
};

const target = (id, role, control, detail) =>
  report.targets.push({ id, role, control, status: 'pass', detail });

async function selected(panel, title, marker = null) {
  return evaluate(
    panel,
    `(() => {
    ${NAVIGATION_SCOPE}
    const matches = tabs.filter((el) => el.title === ${JSON.stringify(title)});
    const tab = matches.length === 1 ? matches[0] : null;
    return { count: matches.length, navigationLists: lists.length, activePanels: activePanes.length, selected: tab?.getAttribute('aria-selected') === 'true',
      linkedPaneVisible: !!pane && pane.id === tab?.getAttribute('aria-controls')
        && pane.getAttribute('aria-labelledby') === tab?.id && pane.getBoundingClientRect().height > 0,
      markerPresent: ${JSON.stringify(marker)} === null ? null : [...(pane?.querySelectorAll('span, h1, h2') ?? [])]
        .some((el) => el.textContent.trim() === ${JSON.stringify(marker)}),
      fallback: !!pane?.querySelector('svg.animate-spin') && !pane?.innerText?.trim() };
  })()`,
  );
}

async function navigate(panel, title, role) {
  report.navigation_attempt = { role, title, stage: 'click' };
  await click(panel, 'title', title);
  report.navigation_attempt.stage = 'selection';
  const state = await waitFor(
    `selected_${role}_${title}`,
    () => selected(panel, title),
    (s) => s?.count === 1 && s.selected && s.linkedPaneVisible,
  );
  target(`navigation:${role}:${title}`, role, 'EXT-F-1001-C01', state);
  const marker = LAZY_VIEW_MARKERS[title];
  if (marker) {
    report.navigation_attempt.stage = 'lazy_view';
    const loaded = await waitFor(
      `loaded_${role}_${title}`,
      () => selected(panel, title, marker),
      (s) => s?.selected && s.linkedPaneVisible && s.markerPresent && !s.fallback,
    );
    target(`lazy-load:${role}:${title}`, role, 'EXT-F-1001-C05', {
      viewMarker: marker,
      markerPresent: loaded.markerPresent,
      linkedPaneVisible: loaded.linkedPaneVisible,
      suspenseFallbackAbsent: !loaded.fallback,
    });
  }
  report.navigation_attempt.stage = 'complete';
}

async function inventory(panel, role) {
  const observed = await evaluate(
    panel,
    `(() => {
    ${NAVIGATION_SCOPE}
    return { navigationLists: lists.length, allTabCount: allTabs.length,
      nestedTabCount: allTabs.filter((el) => el.closest('[role="tabpanel"]')).length,
      unownedTabCount: allTabs.filter((el) => !el.closest('[role="tabpanel"]') && !tabs.includes(el)).length,
      tabs: tabs.map((el) => ({ title: el.getAttribute('title') ?? '',
        captureIdentity: el.getAttribute('aria-controls')?.endsWith('-content-capture') === true })) };
    })()`,
  );
  report.navigation_surfaces[role] = observed;
  assert.equal(observed.navigationLists, 1, 'one owning navigation tablist');
  assert.equal(observed.unownedTabCount, 0, 'no unowned top-level tab controls');
  return observed.tabs;
}

async function avatar(panel, role, title) {
  await click(panel, 'title', title);
  const state = await waitFor(
    `avatar_${role}`,
    () =>
      evaluate(
        panel,
        `(() => {
    const popover = document.querySelector('[data-state="open"][role="dialog"]')
      ?? [...document.querySelectorAll('[data-state="open"]')].find((el) => el.textContent?.includes('Desktop:'));
    const text = popover?.textContent ?? '';
    return { open: !!popover, desktop: /Desktop:\\s*(Not connected|Connected)/i.test(text),
      identityMatches: ${JSON.stringify(role)} === 'guest'
        ? [...(popover?.querySelectorAll('.font-semibold') ?? [])].some((el) => el.textContent.trim() === 'Guest')
        : text.includes('admin@admin.com'),
      profile: [...(popover?.querySelectorAll('button') ?? [])]
        .some((el) => el.textContent.trim() === 'Profile') };
  })()`,
      ),
    (s) => s?.open && s.desktop && s.identityMatches,
  );
  assert.equal(state.profile, role === 'admin');
  target(`avatar:${role}`, role, 'EXT-F-1001-C04', state);
  if (role === 'admin') {
    advance('admin_profile_click');
    report.profile_attempt = { stage: 'click', lastObserved: null };
    await click(panel, 'button', 'Profile');
    advance('admin_profile_wait');
    report.profile_attempt.stage = 'view_wait';
    await waitFor(
      'profile_selected',
      async () => {
        const observed = await evaluate(
          panel,
          `(() => {
        ${NAVIGATION_SCOPE}
        const text = pane?.innerText ?? '';
        return { profileHeader: [...(pane?.querySelectorAll('span') ?? [])]
            .some((el) => el.textContent.trim() === 'Profile'),
          identitySection: text.includes('Identity'), firstNameField: text.includes('First name'),
          backControl: !!pane?.querySelector('button[title="Back"]') };
      })()`,
        );
        report.profile_attempt.lastObserved = observed;
        return observed;
      },
      (v) => v?.profileHeader && v.identitySection && v.firstNameField && v.backControl,
    );
    target('profile:admin', role, 'EXT-F-1001-C01', {
      openedFromUserMenu: true,
      profileHeader: true,
      identitySection: true,
      firstNameField: true,
      backControl: true,
    });
    report.profile_attempt.stage = 'complete';
  }
}

async function adminCredentials() {
  advance('credential_file_read');
  let source;
  try {
    source = await readFile(ADMIN_ENV, 'utf8');
    report.admin_prerequisite.web.credentialFileReadable = true;
  } catch {
    report.admin_prerequisite.web.credentialFileReadable = false;
    throw new Error('credential_file_unreadable');
  }
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2];
    values[match[1]] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  report.admin_prerequisite.web.credentialVariablesAvailable =
    values.AI_ADMIN_USERNAME === 'admin@admin.com' && Boolean(values.AI_ADMIN_PASSWORD);
  assert.equal(report.admin_prerequisite.web.credentialVariablesAvailable, true);
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

async function safeAdminState(panel) {
  return evaluate(
    panel,
    `(() => {
    const section = [...document.querySelectorAll('button[aria-expanded]')]
      .find((el) => el.textContent.trim() === 'Account');
    const content = section?.parentElement?.nextElementSibling;
    const row = (label) => [...(content?.querySelectorAll('span') ?? [])]
      .find((el) => el.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    const buttons = [...document.querySelectorAll('button')].map((el) => el.textContent.trim());
    return { accountPresent: !!section, accountExpanded: section?.getAttribute('aria-expanded') === 'true',
      emailRowPresent: row('Email') !== null, expectedEmailMatch: row('Email') === 'Emailadmin@admin.com',
      roleRowPresent: row('Role') !== null, adminRoleMatch: row('Role')?.toLowerCase() === 'roleadmin',
      signInAvailable: buttons.includes('Sign in'), signOutPresent: buttons.includes('Sign out'),
      advancedPresent: buttons.includes('Advanced agent capabilities'),
      authAlertPresent: !!document.querySelector('[role="alert"]') };
  })()`,
  );
}

async function realAdminSignin(page, panel) {
  advance('web_page_open');
  const web = await page.context().newPage();
  try {
    advance('web_login_navigation');
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    advance('web_login_location_check');
    report.admin_prerequisite.web.expectedOrigin = new URL(web.url()).origin === WEB_ORIGIN;
    report.admin_prerequisite.web.loginPath = new URL(web.url()).pathname === '/login';
    assert.equal(report.admin_prerequisite.web.expectedOrigin, true);
    assert.equal(report.admin_prerequisite.web.loginPath, true);
    const { email, password } = await adminCredentials();
    advance('web_form_ready');
    report.admin_prerequisite.web.formAvailable =
      (await web.locator('input[name="email"]').count()) === 1 &&
      (await web.locator('input[name="password"]').count()) === 1 &&
      (await web.getByRole('button', { name: 'Sign in', exact: true }).count()) === 1;
    assert.equal(report.admin_prerequisite.web.formAvailable, true);
    advance('web_form_fill');
    await web.locator('input[name="email"]').fill(email);
    await web.locator('input[name="password"]').fill(password);
    advance('web_submit_dashboard_wait');
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web
        .getByRole('button', { name: 'Sign in', exact: true })
        .click()
        .then(() => {
          report.admin_prerequisite.web.submitClickCompleted = true;
        }),
    ]);
    report.admin_prerequisite.web.dashboardReached = true;
    advance('extension_settings_open');
    await click(panel, 'title', 'Settings');
    advance('extension_account_open');
    await openSection(panel, 'Account');
    const before = await safeAdminState(panel);
    report.admin_prerequisite.extension.beforeClick = before;
    report.admin_prerequisite.extension.accountReady =
      before.accountPresent && before.accountExpanded;
    report.admin_prerequisite.extension.signInAvailable = before.signInAvailable;
    assert.equal(report.admin_prerequisite.extension.accountReady, true);
    assert.equal(report.admin_prerequisite.extension.signInAvailable, true);
    advance('extension_signin_click');
    await click(panel, 'button', 'Sign in');
    report.admin_prerequisite.extension.signInClickCompleted = true;
    advance('extension_admin_wait');
    await waitFor(
      'real_admin_state',
      async () => {
        try {
          const observed = await safeAdminState(panel);
          report.admin_prerequisite.extension.lastObserved = observed;
          return observed;
        } catch {
          report.admin_prerequisite.extension.observationReadFailed = true;
          throw new Error('safe_admin_observation_failed');
        }
      },
      (v) => v?.expectedEmailMatch && v.adminRoleMatch && v.signOutPresent && v.advancedPresent,
      90_000,
    );
    advance('extension_admin_observed');
    target('real-admin-signin', 'admin', 'prerequisite', {
      webDashboard: true,
      extensionAccount: true,
    });
  } finally {
    await web.close();
  }
}

try {
  const harness = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      advance('guest_tab_inventory');
      const guestTabs = await inventory(panel, 'guest');
      const guestTitles = guestTabs.map((tab) => tab.title);
      assert.deepEqual(guestTitles.sort(), ['Chat', ...GUEST].sort());
      assert.equal(
        guestTabs.some((tab) => tab.captureIdentity),
        false,
      );
      target('guest-tab-inventory', 'guest', 'EXT-F-1001-C01', { titles: guestTitles });
      const guestAvatar = await evaluate(
        panel,
        `(() => !!document.querySelector('button[title="Account"]'))()`,
      );
      assert.equal(guestAvatar, true);
      advance('guest_avatar');
      await avatar(panel, 'guest', 'Account');
      advance('guest_navigation');
      for (const title of GUEST) await navigate(panel, title, 'guest');
      assert.equal(
        guestTabs.some((tab) => isCaptureTitle(tab.title)),
        false,
      );
      target('capture-absent:guest', 'guest', 'EXT-F-1001-C02', { triggerAbsent: true });
      const vaultShortcutAbsent = await evaluate(
        panel,
        `(() => !document.querySelector('button[title="Open Vault to review saved-login assistance"]'))()`,
      );
      assert.equal(vaultShortcutAbsent, true);
      target('vault-shortcut-absent:guest', 'guest', 'EXT-F-1001-C03', { shortcutAbsent: true });

      await realAdminSignin(page, panel);
      advance('admin_tab_inventory');
      const adminTabs = await inventory(panel, 'admin');
      const adminTitles = adminTabs.map((tab) => tab.title);
      const captureTabs = adminTabs.filter((tab) => tab.captureIdentity);
      report.admin_tab_inventory = {
        titles: adminTitles,
        capture_identity_count: captureTabs.length,
        capture_title: captureTabs[0]?.title ?? null,
      };
      assert.equal(captureTabs.length, 1);
      assert.equal(isCaptureTitle(captureTabs[0].title), true);
      const expected = [...GUEST, ...ADMIN, 'Chat', 'Pilot (admin only — sandboxed tab group)'];
      assert.deepEqual(
        adminTabs.map((tab) => (tab.captureIdentity ? 'Capture' : tab.title)).sort(),
        expected.concat('Capture').sort(),
      );
      target('admin-tab-inventory', 'admin', 'EXT-F-1001-C01', { titles: adminTitles });
      advance('admin_avatar');
      await avatar(panel, 'admin', 'admin@admin.com');
      advance('admin_navigation');
      for (const title of [...GUEST, ...ADMIN]) await navigate(panel, title, 'admin');
      // The badge is state-dependent; preserve observed accessible label and
      // visible count without inventing pending work or mutating server data.
      const capture = await evaluate(
        panel,
        `(() => {
        ${NAVIGATION_SCOPE}
        const matches = tabs.filter((el) => el.getAttribute('aria-controls')?.endsWith('-content-capture'));
        const tab = matches.length === 1 ? matches[0] : null;
        return { present: !!tab, label: tab?.getAttribute('aria-label') ?? null,
          badge: tab?.querySelector('.rounded-full')?.textContent?.trim() ?? null };
      })()`,
      );
      assert.equal(capture.present, true);
      assert.equal(isCaptureTitle(capture.label), true);
      advance('admin_capture_navigation');
      await navigate(panel, capture.label, 'admin');
      report.targets.push({
        id: 'capture-observed:admin',
        role: 'admin',
        control: 'EXT-F-1001-C02',
        status: 'partial',
        detail: capture,
      });
      advance('complete');
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'partial';
} catch (error) {
  report.status = 'unverified';
  report.failure_stage = stage;
  report.failure_category =
    stage === 'owned_profile' ? 'native_profile_unverified' : `${stage}_unverified`;
  // Never persist a raw browser error: CDP and assertion messages can include
  // page content, URLs, or auth material. These fixed codes and the click
  // driver's geometry-only diagnostic identify the failed operation safely.
  const message = String(error?.message ?? '');
  report.failure_detail = {
    code: message.startsWith('stable hit target for ')
      ? 'target_not_stable'
      : message.startsWith('unique visible ')
        ? 'target_not_unique'
        : message.startsWith('pointer_sample_failed for ')
          ? 'pointer_sample_failed'
          : message.startsWith('profile_selected_not_observed:')
            ? 'profile_view_not_observed'
            : message === 'panel_runtime_exception'
              ? 'panel_runtime_exception'
              : 'unclassified',
    ...(stage === 'admin_profile_click' &&
      error?.pointerDiagnostic && {
        pointerDiagnostic: error.pointerDiagnostic,
      }),
  };
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} contained_navigation_native_batch\n`);
