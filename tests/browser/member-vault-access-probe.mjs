#!/usr/bin/env node
/**
 * Root-gated, read-only Vault access probe in the owned native Chrome harness.
 * Stops after masked inventory; it never signs the web account out or invokes
 * Fill/Sign in, Reveal, item editing, or a member credential materialization.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const require = createRequire(import.meta.url);
const { acquireVaultAcceptanceLease } = require('./vault-acceptance-lease.cjs');
const OUTPUT = resolve(
  import.meta.dirname,
  '..',
  '..',
  'test-results',
  'member-vault-access-probe.json',
);
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const EXPECTED_ADMIN = 'admin@admin.com';
const TARGET_MEMBER = 'test@test.com';
const APPROVED_ORGANIZATION = 'ZZZ APPROVAL-TAIL throwaway a2c8a05f — safe to delete';

let stage = 'admission';
const evidence = {
  schema_version: 1,
  status: 'unverified',
  scope:
    'owned disposable Chrome profile; real admin web and extension sign-in; masked Vault inventory',
  targetMember: TARGET_MEMBER,
  adminWebSignedIn: false,
  adminExtensionSignedIn: false,
  inventory: null,
  lastVaultObservation: null,
  failureCategory: null,
  limitations: [
    'A matching masked title is only a candidate, not proof of credential identity or member access.',
    'This probe stops before website sign-out, member Vault Fill, or member extension sign-in.',
  ],
};

function fail(category) {
  evidence.failureCategory = category;
  throw new Error('member_vault_probe_unverified');
}

async function readAdminCredentials() {
  let source;
  try {
    source = await readFile(ADMIN_ENV, 'utf8');
  } catch {
    fail('admin_credential_file_unavailable');
  }
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    values[match[1]] = value;
  }
  if (values.AI_ADMIN_USERNAME !== EXPECTED_ADMIN || !values.AI_ADMIN_PASSWORD)
    fail('admin_credential_variables_unavailable');
  return { email: values.AI_ADMIN_USERNAME, password: values.AI_ADMIN_PASSWORD };
}

async function signInOnRealWebPage(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_navigation';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const location = new URL(web.url());
    if (location.origin !== WEB_ORIGIN || location.pathname !== '/login')
      fail('web_login_origin_or_path');
    stage = 'web_signin';
    const { email, password } = await readAdminCredentials();
    await web.locator('input[name="email"]').fill(email);
    await web.locator('input[name="password"]').fill(password);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    evidence.adminWebSignedIn = true;
    return web;
  } catch {
    await web.close();
    fail('real_admin_web_signin_unverified');
  }
}

async function adminSettingsState(panel) {
  return evaluate(
    panel,
    `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    return {
      emailMatches: row('Email') === 'Email${EXPECTED_ADMIN}',
      adminRole: row('Role')?.toLowerCase() === 'roleadmin',
      signOutVisible: [...document.querySelectorAll('button')]
        .some((button) => button.textContent.trim() === 'Sign out'),
    };
  })()`,
  );
}

async function maskedInventory(panel) {
  // The page realm computes the summary. Item IDs, titles, field names, URLs,
  // notes, values, and page text never cross into Node or the evidence file.
  return evaluate(
    panel,
    `(() => {
    const vaultTab = document.querySelector('button[role="tab"][title="Vault"]');
    // Radix links this trigger to its own panel. A document-wide first active
    // tabpanel can belong to another mounted surface or a nested tab set.
    const active = document.getElementById(vaultTab?.getAttribute('aria-controls') ?? '');
    const rows = [...(active?.querySelectorAll('li.rounded-md.border.bg-card > button') ?? [])];
    const candidateRows = rows.filter((row) => {
      const title = row.querySelector('span.block.truncate.text-xs.font-medium')?.textContent?.trim() ?? '';
      return title.toLowerCase().includes('${TARGET_MEMBER}');
    });
    return {
      activePanelFound: Boolean(active),
      vaultTabActive: vaultTab?.getAttribute('data-state') === 'active',
      vaultPanelActive: active?.getAttribute('data-state') === 'active',
      firstActivePanelIsVault: document.querySelector('[role="tabpanel"][data-state="active"]') === active,
      vaultHeadingVisible: Boolean(active?.querySelector('span.text-sm.font-medium')) &&
        [...(active?.querySelectorAll('span') ?? [])].some((span) => span.textContent.trim() === 'Vault'),
      // Both the lazy view fallback and Vault's auth-checking branch render
      // this pre-content spinner; it is outside the inventory spinner selector.
      preContentSpinner: Boolean(active?.querySelector(':scope > div.flex.h-full.items-center.justify-center svg.animate-spin')),
      // Site matching and the password generator have independent spinners.
      // Neither is evidence that the Mine/Shared inventory is still loading.
      inventorySpinner: Boolean(active?.querySelector('div.h-20 .animate-spin')),
      refreshSpinner: Boolean(active?.querySelector('button[title="Refresh"] .animate-spin')),
      siteSpinner: Boolean(active?.querySelector('div.border-b .animate-spin')),
      signedOutPrompt: Boolean(active?.textContent?.includes('Sign in to open your Vault')),
      errorVisible: [...(active?.querySelectorAll('div') ?? [])]
        .some((node) => node.classList.contains('border-amber-500/40')),
      candidateCount: candidateRows.length,
      candidateFillOnCount: candidateRows.filter((row) => row.textContent.includes('Fill on')).length,
      sharedTabLabel: [...(active?.querySelectorAll('button[role="tab"]') ?? [])]
        .find((button) => /^Shared \\(\\d+\\)$/.test(button.textContent.trim()))?.textContent.trim() ?? null,
      activeScope: [...(active?.querySelectorAll('button[role="tab"][data-state="active"]') ?? [])]
        .map((button) => button.textContent.trim())
        .find((label) => /^Mine \\(\\d+\\)$/.test(label) || /^Shared \\(\\d+\\)$/.test(label)) ?? null,
    };
  })()`,
  );
}

async function observeInventory(panel) {
  const observed = await maskedInventory(panel);
  // Only fixed diagnostic booleans cross the page boundary. Never inspect
  // React hook state, organization identities, tokens, or Vault data here.
  const prerequisite = await evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get(['matrx.org.active', 'matrx.org.picker-pending']);
    const picker = [...document.querySelectorAll('[role="dialog"]')].find((node) =>
      node.textContent.includes('Which organization are you working in?'));
    return {
      organizationSelected: Boolean(stored['matrx.org.active']?.id),
      organizationPickerPending: stored['matrx.org.picker-pending'] === true,
      organizationPickerVisible: Boolean(picker),
      organizationPickerLoading: Boolean(picker?.querySelector('[aria-label="Loading organizations"]')),
      approvedOrganizationOffered: [...(picker?.querySelectorAll('[role="option"] span.truncate') ?? [])]
        .filter((node) => node.textContent.trim() === ${JSON.stringify(APPROVED_ORGANIZATION)}).length === 1,
    };
  })()`,
  );
  evidence.lastVaultObservation = {
    ...prerequisite,
    activePanelFound: observed.activePanelFound === true,
    vaultTabActive: observed.vaultTabActive === true,
    vaultPanelActive: observed.vaultPanelActive === true,
    firstActivePanelIsVault: observed.firstActivePanelIsVault === true,
    vaultHeadingVisible: observed.vaultHeadingVisible === true,
    preContentSpinner: observed.preContentSpinner === true,
    inventorySpinner: observed.inventorySpinner === true,
    refreshSpinner: observed.refreshSpinner === true,
    siteSpinner: observed.siteSpinner === true,
    signedOutPrompt: observed.signedOutPrompt === true,
    errorVisible: observed.errorVisible === true,
    activeScope: observed.activeScope?.startsWith('Mine (')
      ? 'mine'
      : observed.activeScope?.startsWith('Shared (')
        ? 'shared'
        : 'none',
    sharedTabAvailable: observed.sharedTabLabel !== null,
    designatedCandidateCount: observed.candidateCount,
    designatedCandidateFillOnCount: observed.candidateFillOnCount,
  };
  return { ...observed, ...prerequisite };
}

async function staleCaptureNoWorkspaceNoticeCount(panel) {
  // This notice can be raised by the mounted capture view before the person
  // chooses an organization. Compare fixed source copy inside the page only;
  // never transport a notice title, message, or technical detail into a receipt.
  return evaluate(
    panel,
    `(() => [...document.querySelectorAll('[role="alert"]')]
      .filter((alert) => alert.querySelector('.font-medium')?.textContent.trim() === 'Capture list unavailable'
        && alert.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent'))
      .length)()`,
  );
}

let lease;
try {
  // A direct invocation is refused until the root resource guard explicitly
  // admits this one run. The shared Vault lease also protects admin inventory.
  if (process.env.MATRX_MEMBER_VAULT_PROBE_RUN !== '1') fail('root_guard_not_admitted');
  lease = await acquireVaultAcceptanceLease({
    runId: randomUUID(),
    kind: 'member-vault-access-probe',
  });
  stage = 'owned_profile';
  await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      stage = 'guest_settings';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const guest = await adminSettingsState(panel);
      assert.equal(guest.signOutVisible, false);

      const web = await signInOnRealWebPage(page);
      try {
        stage = 'extension_signin';
        await click(panel, 'button', 'Sign in');
        await waitFor(
          'admin_extension_identity',
          () => adminSettingsState(panel),
          (state) => state?.emailMatches && state.adminRole && state.signOutVisible,
          90_000,
        );
        evidence.adminExtensionSignedIn = true;

        stage = 'vault_tab_click';
        await click(panel, 'title', 'Vault');
        stage = 'vault_prerequisite_observation';
        const prerequisite = await waitFor(
          'vault_prerequisite_or_content',
          () => observeInventory(panel),
          (state) => state?.vaultHeadingVisible || state?.organizationPickerVisible,
          30_000,
        );
        evidence.beforeOrganizationChoice = { ...evidence.lastVaultObservation };
        if (prerequisite.organizationPickerVisible) {
          stage = 'vault_organization_prerequisite';
          const offered = await waitFor(
            'organization_choices_loaded',
            () => observeInventory(panel),
            (state) => state?.organizationPickerVisible && !state.organizationPickerLoading,
            30_000,
          );
          if (!offered.approvedOrganizationOffered)
            fail('approved_organization_prerequisite_unavailable');
          if (offered.organizationSelected) fail('organization_prerequisite_state_inconsistent');
          await click(panel, 'organization-picker-choice', APPROVED_ORGANIZATION);
          await waitFor(
            'explicit_organization_selected',
            () => observeInventory(panel),
            (state) => state?.organizationSelected && !state.organizationPickerVisible,
            30_000,
          );
          evidence.afterOrganizationChoice = { ...evidence.lastVaultObservation };
        }
        stage = 'mine_inventory_wait';
        await waitFor(
          'masked_vault_inventory',
          () => observeInventory(panel),
          (state) =>
            state?.vaultPanelActive &&
            state?.vaultHeadingVisible &&
            !state.inventorySpinner &&
            !state.refreshSpinner &&
            !state.signedOutPrompt &&
            state.activeScope?.startsWith('Mine ('),
          30_000,
        );
        stage = 'mine_inventory_read';
        const mine = await observeInventory(panel);
        if (mine.errorVisible) fail('vault_inventory_error');
        if (!mine.sharedTabLabel) fail('shared_inventory_tab_missing');
        if (!mine.organizationSelected) fail('organization_prerequisite_not_selected');
        stage = 'stale_capture_notice_check';
        const staleCaptureNotices = await staleCaptureNoWorkspaceNoticeCount(panel);
        if (staleCaptureNotices > 1) fail('stale_capture_notice_ambiguous');
        if (staleCaptureNotices === 1) {
          // A previous capture read was refused before org selection. Its
          // remedy is now complete. Use the notice's real Dismiss button and
          // the same visible, hit-tested, stable, trusted pointer path.
          stage = 'stale_capture_notice_dismiss';
          await click(panel, 'capture-no-workspace-dismiss', 'Dismiss');
          await waitFor(
            'stale_capture_notice_dismissed',
            () => staleCaptureNoWorkspaceNoticeCount(panel),
            (count) => count === 0,
          );
          evidence.dismissedStaleCaptureNoWorkspaceNotice = true;
        }
        stage = 'shared_tab_click';
        await click(panel, 'vault-shared-tab', 'Shared');
        stage = 'shared_inventory_wait';
        await waitFor(
          'shared_vault_inventory',
          () => observeInventory(panel),
          (state) =>
            state?.vaultPanelActive &&
            state?.vaultHeadingVisible &&
            !state.inventorySpinner &&
            !state.refreshSpinner &&
            state.activeScope?.startsWith('Shared ('),
          30_000,
        );
        stage = 'shared_inventory_read';
        const shared = await observeInventory(panel);
        if (shared.errorVisible) fail('vault_inventory_error');
        evidence.inventory = {
          designatedCandidateVisible: mine.candidateCount + shared.candidateCount > 0,
          designatedCandidateCount: mine.candidateCount + shared.candidateCount,
          designatedCandidateFillOnCount: mine.candidateFillOnCount + shared.candidateFillOnCount,
        };
      } finally {
        await web.close();
      }
    },
  });
  evidence.status = 'inventory_observed_member_auth_unverified';
  stage = 'complete';
  process.stdout.write('OBSERVED member_vault_masked_inventory; member auth unverified\n');
} catch (error) {
  evidence.status = 'unverified';
  evidence.failureStage = stage;
  if (error?.driverFailure) evidence.driverFailure = error.driverFailure;
  evidence.failureCategory ??= 'stage_operation_failed';
  process.stderr.write(`UNVERIFIED member_vault_access_probe at ${stage}\n`);
  process.exitCode = 1;
} finally {
  try {
    await lease?.release();
  } catch {
    evidence.status = 'unverified';
    evidence.failureCategory = 'vault_lease_release_failed';
    process.exitCode = 1;
  }
  await mkdir(resolve(import.meta.dirname, '..', '..', 'test-results'), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
