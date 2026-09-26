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
  'Capture',
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
};

const target = (id, role, control, detail) =>
  report.targets.push({ id, role, control, status: 'pass', detail });

async function selected(panel, title, marker = null) {
  return evaluate(
    panel,
    `(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.title === ${JSON.stringify(title)});
    const pane = document.querySelector('[role="tabpanel"][data-state="active"]');
    return { count: tab ? 1 : 0, selected: tab?.getAttribute('aria-selected') === 'true',
      linkedPaneVisible: !!pane && pane.id === tab?.getAttribute('aria-controls')
        && pane.getAttribute('aria-labelledby') === tab?.id && pane.getBoundingClientRect().height > 0,
      markerPresent: ${JSON.stringify(marker)} === null ? null : [...(pane?.querySelectorAll('span, h1, h2') ?? [])]
        .some((el) => el.textContent.trim() === ${JSON.stringify(marker)}),
      fallback: !!pane?.querySelector('svg.animate-spin') && !pane?.innerText?.trim() };
  })()`,
  );
}

async function navigate(panel, title, role) {
  await click(panel, 'title', title);
  const state = await waitFor(
    `selected_${role}_${title}`,
    () => selected(panel, title),
    (s) => s?.count === 1 && s.selected && s.linkedPaneVisible,
  );
  target(`navigation:${role}:${title}`, role, 'EXT-F-1001-C01', state);
  const marker = LAZY_VIEW_MARKERS[title];
  if (marker) {
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
}

async function inventory(panel) {
  return evaluate(
    panel,
    `(() => [...document.querySelectorAll('[role="tab"]')]
    .map((el) => el.title).filter(Boolean))()`,
  );
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
    await click(panel, 'button', 'Profile');
    await waitFor(
      'profile_selected',
      () =>
        evaluate(
          panel,
          `(() => {
        const pane = document.querySelector('[role="tabpanel"][data-state="active"]');
        const text = pane?.innerText ?? '';
        return { profileHeader: [...(pane?.querySelectorAll('span') ?? [])]
            .some((el) => el.textContent.trim() === 'Profile'),
          identitySection: text.includes('Identity'), firstNameField: text.includes('First name'),
          backControl: !!pane?.querySelector('button[title="Back"]') };
      })()`,
        ),
      (v) => v?.profileHeader && v.identitySection && v.firstNameField && v.backControl,
    );
    target('profile:admin', role, 'EXT-F-1001-C01', {
      openedFromUserMenu: true,
      profileHeader: true,
      identitySection: true,
      firstNameField: true,
      backControl: true,
    });
  }
}

async function adminCredentials() {
  const source = await readFile(ADMIN_ENV, 'utf8');
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2];
    values[match[1]] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  assert.equal(values.AI_ADMIN_USERNAME, 'admin@admin.com');
  assert.ok(values.AI_ADMIN_PASSWORD);
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

async function realAdminSignin(page, panel) {
  const web = await page.context().newPage();
  try {
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    assert.equal(new URL(web.url()).origin, WEB_ORIGIN);
    assert.equal(new URL(web.url()).pathname, '/login');
    const { email, password } = await adminCredentials();
    await web.locator('input[name="email"]').fill(email);
    await web.locator('input[name="password"]').fill(password);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    await click(panel, 'button', 'Sign in');
    await waitFor(
      'real_admin_state',
      () =>
        evaluate(
          panel,
          `(() => {
      const text = document.body?.innerText ?? '';
      return text.includes('admin@admin.com') && text.includes('Advanced agent capabilities')
        && [...document.querySelectorAll('button')].some((el) => el.textContent.trim() === 'Sign out');
    })()`,
        ),
      (v) => v === true,
      90_000,
    );
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
      const guestTabs = await inventory(panel);
      assert.deepEqual(guestTabs.filter((title) => title !== 'Chat').sort(), [...GUEST].sort());
      target('guest-tab-inventory', 'guest', 'EXT-F-1001-C01', { titles: guestTabs });
      const guestAvatar = await evaluate(
        panel,
        `(() => !!document.querySelector('button[title="Account"]'))()`,
      );
      assert.equal(guestAvatar, true);
      await avatar(panel, 'guest', 'Account');
      for (const title of GUEST) await navigate(panel, title, 'guest');
      assert.equal(guestTabs.includes('Capture'), false);
      target('capture-absent:guest', 'guest', 'EXT-F-1001-C02', { triggerAbsent: true });
      const vaultShortcutAbsent = await evaluate(
        panel,
        `(() => !document.querySelector('button[title="Open Vault to review saved-login assistance"]'))()`,
      );
      assert.equal(vaultShortcutAbsent, true);
      target('vault-shortcut-absent:guest', 'guest', 'EXT-F-1001-C03', { shortcutAbsent: true });

      await realAdminSignin(page, panel);
      const adminTabs = await inventory(panel);
      const expected = [...GUEST, ...ADMIN, 'Chat', 'Pilot (admin only — sandboxed tab group)'];
      assert.deepEqual(adminTabs.sort(), expected.sort());
      target('admin-tab-inventory', 'admin', 'EXT-F-1001-C01', { titles: adminTabs });
      await avatar(panel, 'admin', 'admin@admin.com');
      for (const title of [...GUEST, ...ADMIN]) await navigate(panel, title, 'admin');
      // The badge is state-dependent; preserve observed accessible label and
      // visible count without inventing pending work or mutating server data.
      const capture = await evaluate(
        panel,
        `(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.title?.startsWith('Capture'));
        return { present: !!tab, label: tab?.getAttribute('aria-label') ?? null,
          badge: tab?.querySelector('.rounded-full')?.textContent?.trim() ?? null };
      })()`,
      );
      assert.equal(capture.present, true);
      report.targets.push({
        id: 'capture-observed:admin',
        role: 'admin',
        control: 'EXT-F-1001-C02',
        status: 'partial',
        detail: capture,
      });
    },
  });
  report.extension_id = harness.extensionId;
  report.status = 'partial';
} catch {
  report.status = 'unverified';
  report.failure_category = 'native_or_stage_unverified';
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} contained_navigation_native_batch\n`);
