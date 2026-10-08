import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { guestSettingsChecks, guestSettingsState } from './settings-panel-driver.mjs';

test('admin completion failure reaches the acceptance receipt as safe categories', async () => {
  let authenticatedState = false;
  let poisoned = false;
  const source = await readFile(
    new URL('./settings-native-auth-driver.mjs', import.meta.url),
    'utf8',
  );
  const implementation = source
    .slice(source.indexOf('export async function signInSettings('))
    .replace('export async function', 'async function');
  const signInSettings = new Function(
    'assert',
    'signInAdminSettings',
    'panelIdentity',
    'accountIdentity',
    `${implementation}; return signInSettings;`,
  )(
    assert,
    async ({ report, stage }) => {
      stage(
        poisoned ? 'https://private.invalid/?token=raw-url' : 'admin_extension_auth_completion',
      );
      report.signin_observations.web_dashboard_reached = poisoned ? 'raw-data' : true;
      report.signin_observations.extension_click_failure = {
        code: 'https://private.invalid/?token=raw-url',
        raw_error: 'raw-error',
      };
      report.signin_observations.raw_error = 'raw-error';
      report.signin_observations.url = 'https://private.invalid/?token=raw-url';
      report.signin_observations.body = 'raw-body';
      report.signin_observations.data = { token: 'raw-data' };
      report.signin_observations.extension_failure = {
        settings_panel_active: poisoned ? 'raw-body' : true,
        account_expanded: poisoned ? { token: 'raw-data' } : true,
        sign_in_count: poisoned ? { token: 'raw-data' } : authenticatedState ? 0 : 1,
        sign_out_present: poisoned ? 'raw-error' : authenticatedState,
        auth_error_present: poisoned ? { token: 'raw-data' } : !authenticatedState,
        auth_retry_present: false,
        loading_present: false,
        expected_admin_email: poisoned ? 'raw-body' : authenticatedState,
        admin_role: poisoned ? { token: 'raw-data' } : authenticatedState,
        secret: 'private-token',
        url: 'https://private.invalid/?token=raw-url',
        body: 'raw-body',
        data: { token: 'raw-data' },
      };
      throw new Error(poisoned ? 'raw-error' : 'admin_extension_auth_completion_failed');
    },
    async () => ({
      accessTokenPresent: poisoned ? 'raw-body' : authenticatedState,
      profileId: poisoned ? { token: 'raw-data' } : authenticatedState ? 'private-id' : null,
      isAdmin: poisoned ? 'raw-error' : authenticatedState ? true : null,
      raw_error: 'raw-error',
    }),
    async () => ({
      organizationPickerAvailable: poisoned ? 'raw-body' : authenticatedState,
      organizationLabel: 'private-org',
      body: 'raw-body',
    }),
  );
  let diagnostic;
  await assert.rejects(
    () =>
      signInSettings({
        mode: 'admin',
        page: {},
        panel: {},
        onStage: () => {},
        onAuthDiagnostic: (value) => {
          diagnostic = value;
        },
      }),
    /admin_extension_auth_completion_failed/,
  );
  assert.deepEqual(diagnostic, {
    phase: 'admin_extension_auth_completion',
    outcome: 'extension_completion_unobserved',
    web_dashboard_reached: true,
    extension_click_failure_code: null,
    settings_panel_active: true,
    account_expanded: true,
    sign_in_present: true,
    sign_out_present: false,
    auth_error_present: true,
    auth_retry_present: false,
    loading_present: false,
    rendered_admin_email: false,
    rendered_admin_role: false,
    organization_selector_present: false,
    storage_access_token_present: false,
    storage_profile_present: false,
    storage_admin_flag: null,
    http_category: 'unobserved',
  });
  assert.equal(JSON.stringify(diagnostic).includes('private-'), false);
  authenticatedState = true;
  await assert.rejects(
    () =>
      signInSettings({
        mode: 'admin',
        page: {},
        panel: {},
        onStage: () => {},
        onAuthDiagnostic: (value) => {
          diagnostic = value;
        },
      }),
    /admin_extension_auth_completion_failed/,
  );
  assert.equal(diagnostic.sign_in_present, false);
  assert.equal(diagnostic.sign_out_present, true);
  assert.equal(diagnostic.rendered_admin_email, true);
  assert.equal(diagnostic.storage_access_token_present, true);
  assert.equal(diagnostic.storage_profile_present, true);
  assert.equal(diagnostic.storage_admin_flag, true);
  assert.equal(diagnostic.organization_selector_present, true);
  assert.equal(JSON.stringify(diagnostic).includes('private-'), false);
  poisoned = true;
  const receipt = { auth_diagnostic: null };
  await assert.rejects(
    () =>
      signInSettings({
        mode: 'admin',
        page: {},
        panel: {},
        onStage: () => {},
        onAuthDiagnostic: (value) => {
          diagnostic = value;
          receipt.auth_diagnostic = value;
        },
      }),
    /raw-error/,
  );
  assert.deepEqual(diagnostic, {
    phase: 'unknown_admin_phase',
    outcome: 'other_admin_auth_failure',
    web_dashboard_reached: false,
    extension_click_failure_code: null,
    settings_panel_active: null,
    account_expanded: null,
    sign_in_present: null,
    sign_out_present: null,
    auth_error_present: null,
    auth_retry_present: false,
    loading_present: false,
    rendered_admin_email: null,
    rendered_admin_role: null,
    organization_selector_present: null,
    storage_access_token_present: null,
    storage_profile_present: null,
    storage_admin_flag: null,
    http_category: 'unobserved',
  });
  for (const marker of ['private-', 'raw-error', 'raw-url', 'raw-body', 'raw-data']) {
    assert.equal(JSON.stringify(diagnostic).includes(marker), false);
    assert.equal(JSON.stringify(receipt).includes(marker), false);
  }
});

test('late rendered-identity failure records safe account and storage categories', async () => {
  const source = await readFile(
    new URL('./settings-native-auth-driver.mjs', import.meta.url),
    'utf8',
  );
  const implementation = source
    .slice(source.indexOf('export async function signInSettings('))
    .replace('export async function', 'async function');
  const signInSettings = new Function(
    'assert',
    'signInAdminSettings',
    'panelIdentity',
    'accountIdentity',
    'verifyCurrentSettingsIdentity',
    `${implementation}; return signInSettings;`,
  )(
    assert,
    async () => ({ email: 'admin@admin.com', userId: 'private-id' }),
    async () => ({
      profileId: 'private-id',
      isAdmin: true,
      accessTokenPresent: true,
      organizationId: 'private-organization-id',
      organizationName: 'private-org',
    }),
    async () => ({
      emailMatches: true,
      adminRole: true,
      signOutVisible: true,
      organizationSelected: false,
      organizationLabel: 'private-org',
    }),
    async () => {
      throw new Error('d87_rendered_identity_not_observed:{"organizationName":"private-org"}');
    },
  );
  const receipt = { auth_diagnostic: null };
  const stages = [];
  await assert.rejects(
    () =>
      signInSettings({
        mode: 'admin',
        panel: {},
        page: {},
        onStage: (value) => stages.push(value),
        onAuthDiagnostic: (value) => {
          receipt.auth_diagnostic = value;
        },
      }),
    /d87_rendered_identity_not_observed/,
  );
  assert.deepEqual(stages, ['admin_rendered_identity']);
  assert.deepEqual(receipt.auth_diagnostic, {
    phase: 'admin_rendered_identity',
    outcome: 'rendered_identity_unobserved',
    web_identity_verified: true,
    storage_profile_matches_web: true,
    storage_admin_flag: true,
    storage_access_token_present: true,
    rendered_admin_email: true,
    rendered_admin_role: true,
    rendered_sign_out: true,
    rendered_organization_selected: false,
    rendered_organization_matches_storage: false,
  });
  assert.equal(JSON.stringify(receipt).includes('private-'), false);
});

// A signed-out operator opens Settings to inspect the device account and
// organization controls. These counts match the source-rendered guest view.
const guest = {
  active: true,
  accessTokenPresent: false,
  profilePresent: false,
  organizationChoicePresent: false,
  accountSectionCount: 1,
  accountOpen: true,
  emailRowCount: 1,
  emailUnavailable: true,
  nameRowCount: 0,
  roleRowCount: 0,
  footerSignInCount: 1,
  footerSignOutCount: 0,
  organizationSectionCount: 1,
  organizationOpen: true,
  signInToChooseCount: 1,
  organizationOnlyGuestRow: true,
  archiveFilterCount: 0,
  actingAsRowCount: 0,
  archivedMarkerCount: 0,
  restorationActionCount: 0,
  archivedCopyPresent: false,
};

test('native Settings observation reads the active panel and drops account content', async () => {
  const window = new Window();
  window.chrome = { storage: { local: { get: async () => ({}) } } };
  window.document.body.innerHTML = `
    <button role="tab" data-state="active" title="Settings" aria-controls="settings"></button>
    <div id="settings" role="tabpanel" data-state="active">
      <button aria-expanded="true" aria-controls="account">Account</button>
      <div id="account"><div class="flex items-center justify-between"><span>Email</span><div>—</div></div></div>
      <button aria-expanded="true" aria-controls="organization">Organization</button>
      <div id="organization"><div class="flex items-center justify-between"><span>Organization</span><div>Sign in to choose</div></div></div>
      <button>Sign in</button>
    </div>`;
  const panel = {
    send: async (_method, { expression }) => ({ result: { value: await window.eval(expression) } }),
  };
  const observed = await guestSettingsState(panel);
  assert.deepEqual(guestSettingsChecks(observed, 0), {
    signedOut: true,
    account: true,
    organization: true,
    archivedManagement: true,
  });
  window.document
    .querySelector('#account')
    .insertAdjacentHTML(
      'beforeend',
      '<div class="flex items-center justify-between"><span>Name</span><div>Existing member</div></div>',
    );
  assert.equal(guestSettingsChecks(await guestSettingsState(panel), 0).account, false);
  window.document
    .querySelector('#organization')
    .insertAdjacentHTML('beforeend', "<div><span>Matrx's Org</span></div>");
  const bareNameLeak = await guestSettingsState(panel);
  assert.equal(bareNameLeak.archivedMarkerCount, 0);
  assert.equal(bareNameLeak.restorationActionCount, 0);
  assert.equal(bareNameLeak.organizationOnlyGuestRow, false);
  assert.equal(guestSettingsChecks(bareNameLeak, 0).organization, false);
  assert.equal(guestSettingsChecks(bareNameLeak, 0).archivedManagement, false);
  window.document
    .querySelector('#organization')
    .insertAdjacentHTML(
      'beforeend',
      '<a>Open Organizations to restore an archived organization</a>',
    );
  assert.equal(guestSettingsChecks(await guestSettingsState(panel), 0).archivedManagement, false);
  window.happyDOM.abort();
});

test('guest account and organization verdicts require the signed-out native view', () => {
  assert.deepEqual(guestSettingsChecks(guest, 0), {
    signedOut: true,
    account: true,
    organization: true,
    archivedManagement: true,
  });
  for (const changed of [
    { emailUnavailable: false },
    { footerSignInCount: 0 },
    { footerSignOutCount: 1 },
    { active: false },
    { accessTokenPresent: true },
    { profilePresent: true },
    { organizationChoicePresent: true },
  ]) {
    const result = guestSettingsChecks({ ...guest, ...changed }, 0);
    assert.deepEqual(result, {
      signedOut: false,
      account: false,
      organization: false,
      archivedManagement: false,
    });
  }
});

test('each guest control rejects its own visible or network regression', () => {
  for (const changed of [{ nameRowCount: 1 }, { roleRowCount: 1 }, { accountOpen: false }]) {
    assert.equal(guestSettingsChecks({ ...guest, ...changed }, 0).account, false);
  }
  for (const changed of [
    { archiveFilterCount: 1 },
    { actingAsRowCount: 1 },
    { signInToChooseCount: 0 },
    { organizationOnlyGuestRow: false },
    { organizationOpen: false },
  ]) {
    assert.equal(guestSettingsChecks({ ...guest, ...changed }, 0).organization, false);
  }
  assert.equal(guestSettingsChecks(guest, 1).organization, false);
  assert.equal(guestSettingsChecks(guest, 0).organization, true);
  for (const changed of [
    { archivedMarkerCount: 1 },
    { restorationActionCount: 1 },
    { archivedCopyPresent: true },
  ]) {
    assert.equal(guestSettingsChecks({ ...guest, ...changed }, 0).archivedManagement, false);
  }
});
