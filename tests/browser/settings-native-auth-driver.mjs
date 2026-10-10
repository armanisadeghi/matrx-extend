import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { signInAdminSettings } from './admin-settings-signin.mjs';
import {
  authenticatedWebIdentity,
  observeCanonicalAdminCheck,
  supabaseOrigin,
} from './member-native-auth-proof.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const ORIGIN = 'https://www.aimatrx.com';
const MEMBER_FINGERPRINT = '3d6137db6c081c07';
export const MEMBER_TEST_ORGANIZATION_NAME = "Matrx's Org";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Hosted credential preflight runs before package installation on a fresh runner.
export function isNativeUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function fingerprint(value) {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 16);
}

export function requireSettingsCredential(mode, raw) {
  assert.ok(['admin', 'member'].includes(mode), 'd87_auth_mode_invalid');
  let secret;
  try {
    secret = JSON.parse(raw);
  } catch {
    throw new Error('d87_auth_secret_invalid');
  }
  if (mode === 'admin') {
    assert.equal(secret?.email, 'admin@admin.com', 'd87_admin_identity_required');
    assert.ok(
      typeof secret.password === 'string' && secret.password,
      'd87_admin_password_required',
    );
  } else {
    assert.equal(
      fingerprint(secret?.email ?? ''),
      MEMBER_FINGERPRINT,
      'd87_member_fingerprint_mismatch',
    );
    let link;
    try {
      link = new URL(secret.action_link);
    } catch {
      throw new Error('d87_member_link_invalid');
    }
    assert.equal(link.protocol, 'https:', 'd87_member_link_invalid');
    assert.equal(link.origin, ORIGIN, 'd87_member_link_invalid');
    assert.equal(link.pathname, '/auth/confirm', 'd87_member_link_invalid');
    assert.equal(link.searchParams.get('type'), 'magiclink', 'd87_member_link_invalid');
    assert.ok(link.searchParams.get('token_hash'), 'd87_member_link_invalid');
  }
  return secret;
}

export function settingsShellReady(state, mode) {
  return state?.settingsAvailable === true && state.guest === (mode === 'guest');
}

export function settingsOrganizationSelectionRequired(
  value,
  requiredOrganizationName = MEMBER_TEST_ORGANIZATION_NAME,
) {
  return !value?.organizationSelected || value.organizationLabel !== requiredOrganizationName;
}

/** The product's load ladder can select an organization without a device-choice key. */
export function resolveMemberOrganizationSelection(
  stored,
  visibleLabel,
  allowLadder = false,
  expectedOrganizationId = null,
) {
  assert.equal(
    visibleLabel,
    MEMBER_TEST_ORGANIZATION_NAME,
    'd87_member_organization_label_unverified',
  );
  if (stored?.organizationId === null && stored.organizationName === null) {
    assert.equal(allowLadder, true, 'd87_member_organization_uuid_unverified');
    if (allowLadder)
      assert.match(
        expectedOrganizationId ?? '',
        UUID,
        'd87_member_expected_organization_unverified',
      );
    return 'load_ladder';
  }
  assert.ok(
    UUID.test(stored?.organizationId ?? '') &&
      stored.organizationName === MEMBER_TEST_ORGANIZATION_NAME,
    'd87_member_organization_storage_unverified',
  );
  if (expectedOrganizationId !== null)
    assert.equal(stored.organizationId, expectedOrganizationId, 'd87_member_organization_mismatch');
  return 'device_choice';
}

async function privateJson(file, code) {
  assert.ok(file, `${code}_file_required`);
  const metadata = await stat(file);
  assert.equal(metadata.mode & 0o077, 0, `${code}_file_not_private`);
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function approvedAdminOrganizationName(file) {
  const config = await privateJson(file, 'd87_approved_admin_organization');
  const name = config?.approved_organization_name;
  assert.ok(
    typeof name === 'string' && name.length > 0 && name.trim() === name,
    'd87_approved_admin_organization_invalid',
  );
  return name;
}

export async function approvedShowcaseOrganization(file) {
  const config = await privateJson(file, 'd87_approved_admin_organization');
  const name = config?.approved_organization_name;
  const id = config?.approved_organization_id;
  assert.ok(
    typeof name === 'string' && name.trim() === name && name.length > 0,
    'd87_approved_admin_organization_invalid',
  );
  assert.ok(isNativeUuid(id), 'd87_approved_admin_organization_id_invalid');
  return { name, id };
}

export async function panelIdentity(panel) {
  return evaluate(
    panel,
    `(() => chrome.storage.local.get([
    'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.user.isAdmin', 'matrx.org.active',
  ]).then((stored) => ({
    profileId: stored['matrx.user.profile']?.id ?? null,
    accessTokenPresent: typeof stored['matrx.auth.accessToken'] === 'string',
    isAdmin: stored['matrx.user.isAdmin'] === true ? true : stored['matrx.user.isAdmin'] === false ? false : null,
    organizationId: stored['matrx.org.active']?.id ?? null,
    organizationName: stored['matrx.org.active']?.name ?? null,
  })))()`,
  );
}

export async function accountIdentity(panel, email) {
  return evaluate(
    panel,
    `(() => {
    const account = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Account');
    const section = account?.parentElement?.nextElementSibling;
    const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
      .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
    const organization = [...document.querySelectorAll('button[aria-expanded]')]
      .find((button) => button.textContent.trim() === 'Organization');
    const orgSection = organization?.parentElement?.nextElementSibling;
    const orgButton = orgSection?.querySelector('button[role="combobox"]');
    const orgText = orgButton?.textContent?.trim() ?? '';
    return {
      emailMatches: row('Email') === ${JSON.stringify(`Email${email}`)},
      adminRole: row('Role')?.toLowerCase() === 'roleadmin',
      roleAbsent: row('Role') === null,
      signOutVisible: [...document.querySelectorAll('button')]
        .some((button) => button.textContent.trim() === 'Sign out'),
      signInEnabled: [...document.querySelectorAll('button')]
        .some((button) => button.textContent.trim() === 'Sign in' && !button.disabled),
      organizationSelected: Boolean(orgButton && orgText && orgText !== 'Choose…'),
      organizationLabel: orgButton && orgText && orgText !== 'Choose…' ? orgText : null,
      organizationPickerAvailable: Boolean(orgButton),
    };
  })()`,
  );
}

export function currentSettingsIdentityMatches(
  value,
  {
    mode,
    profileId,
    organizationId,
    requireSelectedOrganization = false,
    requiredOrganizationName,
  },
) {
  // A missing device choice is not a missing active organization: the shell's
  // load ladder can render one without persisting matrx.org.active. Identity
  // readiness must not claim approved-organization proof from that label.
  const organizationMatches =
    organizationId === null
      ? !requireSelectedOrganization &&
        value?.organizationId === null &&
        value?.organizationName === null
      : value?.organizationId === organizationId &&
        UUID.test(value?.organizationId ?? '') &&
        value?.organizationSelected &&
        value?.organizationLabel === value?.organizationName &&
        (!requireSelectedOrganization ||
          (typeof requiredOrganizationName === 'string' &&
            value?.organizationName === requiredOrganizationName &&
            value?.organizationLabel === requiredOrganizationName));
  return Boolean(
    value?.emailMatches &&
      value.signOutVisible &&
      value.accessTokenPresent &&
      value.profileId === profileId &&
      (mode === 'admin'
        ? value.adminRole && value.isAdmin === true
        : value.roleAbsent && !value.adminRole && value.isAdmin !== true) &&
      organizationMatches,
  );
}

export async function verifyCurrentSettingsIdentity({
  panel,
  mode,
  email,
  profileId,
  organizationId,
  requireSelectedOrganization = false,
  requiredOrganizationName,
}) {
  await openSection(panel, 'Account');
  await openSection(panel, 'Organization');
  const observed = await waitFor(
    'd87_rendered_identity',
    async () => ({ ...(await accountIdentity(panel, email)), ...(await panelIdentity(panel)) }),
    (value) =>
      currentSettingsIdentityMatches(value, {
        mode,
        profileId,
        organizationId,
        requireSelectedOrganization,
        requiredOrganizationName,
      }),
    30_000,
  );
  return {
    rendered_email_matches_first_party: observed.emailMatches,
    rendered_role_matches_mode: mode === 'admin' ? observed.adminRole : observed.roleAbsent,
    profile_matches_first_party: observed.profileId === profileId,
    selected_organization_matches_stored_uuid_and_name: requireSelectedOrganization
      ? observed.organizationId === organizationId &&
        UUID.test(observed.organizationId ?? '') &&
        observed.organizationSelected &&
        observed.organizationName === requiredOrganizationName &&
        observed.organizationLabel === requiredOrganizationName
      : organizationId === null ||
        (observed.organizationId === organizationId &&
          observed.organizationLabel === observed.organizationName),
  };
}

async function approveConsent(context) {
  for (const candidate of context.pages()) {
    let url;
    try {
      url = new URL(candidate.url());
    } catch {
      continue;
    }
    if (`${url.origin}${url.pathname}` !== `${ORIGIN}/oauth/consent`) continue;
    const authorize = candidate.getByRole('button', { name: 'Authorize', exact: true });
    assert.equal(await authorize.count(), 1, 'd87_member_consent_unavailable');
    await authorize.click();
    return;
  }
}

export async function observeOrganizationOption(panel, requiredOrganizationName) {
  return evaluate(
    panel,
    `(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const labels = [...document.querySelectorAll('span')].filter((el) => el.textContent.trim() === 'Acting as');
    const triggers = labels.flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
    const trigger = triggers.length === 1 ? triggers[0] : null;
    const menuId = trigger?.getAttribute('aria-controls');
    const menu = menuId ? document.getElementById(menuId) : null;
    const menuOpen = trigger?.getAttribute('aria-expanded') === 'true' &&
      menu?.getAttribute('role') === 'listbox' && menu.getAttribute('data-state') === 'open' && visible(menu);
    const options = menuOpen ? [...menu.querySelectorAll('[role="option"]')] : [];
    const exact = options.filter((option) => option.textContent.trim() === ${JSON.stringify(requiredOrganizationName)});
    const visibleOptions = options.filter(visible);
    const visibleExact = exact.filter(visible);
    const target = exact.length === 1 && visibleExact.length === 1 ? visibleExact[0] : null;
    const rect = target?.getBoundingClientRect();
    const x = rect ? rect.x + rect.width / 2 : null;
    const y = rect ? rect.y + rect.height / 2 : null;
    const inViewport = x !== null && y !== null && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const hit = inViewport ? document.elementFromPoint(x, y) : null;
    const filter = document.querySelector('[aria-label="Filter organizations by archive status"]');
    const pressed = [...(filter?.querySelectorAll('button[aria-pressed="true"]') ?? [])];
    const filterText = pressed.length === 1 ? pressed[0].textContent.trim() : '';
    return {
      menu_open: Boolean(menuOpen),
      visible_option_count: visibleOptions.length,
      exact_match_count: exact.length,
      exact_visible_match_count: visibleExact.length,
      target_in_viewport: target ? inViewport : null,
      target_center_hit: target ? Boolean(hit && (hit === target || target.contains(hit))) : null,
      archive_filter: filterText === 'Active only' ? 'active' : filterText === 'Archived only' ? 'archived' : filterText === 'Active + archived' ? 'all' : 'unknown',
      point: target && inViewport && hit && (hit === target || target.contains(hit)) ? { x, y } : null,
      candidate: target ? { x, y } : null,
    };
  })()`,
  );
}

export async function waitForOrganizationOption(panel, requiredOrganizationName, onObservation) {
  let previousPoint = null;
  let stablePoint = null;
  await waitFor(
    'd87_member_organization_option_unavailable',
    async () => {
      const observed = await observeOrganizationOption(panel, requiredOrganizationName);
      const { point, candidate, ...safeObservation } = observed;
      onObservation?.(safeObservation);
      const signature = candidate
        ? `${candidate.x}:${candidate.y}:${observed.visible_option_count}:${observed.exact_match_count}`
        : null;
      stablePoint = signature && signature === previousPoint ? candidate : null;
      previousPoint = signature;
      return safeObservation;
    },
    () => stablePoint !== null,
  );
  return stablePoint;
}

export async function selectOrganization(panel, requiredOrganizationName, onObservation) {
  await click(panel, 'organization', '');
  await waitForOrganizationOption(panel, requiredOrganizationName, onObservation);
  await click(panel, 'organization-option', requiredOrganizationName);
}

/** Select and verify the approved device organization for an acceptance that requires it. */
export async function selectRequiredSettingsOrganization({
  panel,
  mode,
  email,
  profileId,
  requiredOrganizationName = mode === 'member' ? MEMBER_TEST_ORGANIZATION_NAME : null,
  onBranch,
  onStage,
  onObservation,
}) {
  assert.ok(['admin', 'member'].includes(mode), 'd87_auth_mode_invalid');
  assert.ok(
    typeof requiredOrganizationName === 'string' &&
      requiredOrganizationName.trim() === requiredOrganizationName &&
      requiredOrganizationName.length > 0,
    'd87_approved_organization_required',
  );
  onStage?.('organization_section');
  await openSection(panel, 'Organization');
  onStage?.('organization_picker');
  onObservation?.({ picker_available: null, picker_has_selection: null });
  const org = await waitFor(
    'd87_required_organization_picker',
    async () => {
      const value = await accountIdentity(panel, email);
      onObservation?.({
        picker_available: value?.organizationPickerAvailable ?? null,
        picker_has_selection: value?.organizationSelected ?? null,
      });
      return value;
    },
    (value) => value?.organizationSelected || value?.organizationPickerAvailable,
    30_000,
  );
  const selectionRequired = settingsOrganizationSelectionRequired(org, requiredOrganizationName);
  onObservation?.({
    picker_available: org.organizationPickerAvailable === true,
    picker_has_selection: org.organizationSelected === true,
    selection_required: selectionRequired,
  });
  await onBranch?.(selectionRequired ? 'organization_select' : 'organization_skip');
  onStage?.(selectionRequired ? 'organization_select' : 'organization_skip');
  if (selectionRequired) await selectOrganization(panel, requiredOrganizationName, onObservation);
  onStage?.('organization_storage');
  onObservation?.({ storage_has_uuid: null, storage_name_matches: null });
  const selected = await waitFor(
    'd87_required_organization_storage',
    async () => {
      const value = await panelIdentity(panel);
      onObservation?.({
        storage_has_uuid: value ? UUID.test(value.organizationId ?? '') : null,
        storage_name_matches: value ? value.organizationName === requiredOrganizationName : null,
      });
      return value;
    },
    (value) =>
      UUID.test(value?.organizationId ?? '') &&
      value?.organizationName === requiredOrganizationName,
    30_000,
  );
  onObservation?.({
    storage_has_uuid: UUID.test(selected.organizationId ?? ''),
    storage_name_matches: selected.organizationName === requiredOrganizationName,
  });
  onStage?.('organization_rendered_identity');
  const rendered = await verifyCurrentSettingsIdentity({
    panel,
    mode,
    email,
    profileId,
    organizationId: selected.organizationId,
    requireSelectedOrganization: true,
    requiredOrganizationName,
  });
  onObservation?.({
    rendered_email_matches: rendered.rendered_email_matches_first_party,
    rendered_role_matches: rendered.rendered_role_matches_mode,
    rendered_profile_matches: rendered.profile_matches_first_party,
    rendered_organization_matches: rendered.selected_organization_matches_stored_uuid_and_name,
  });
  assert.equal(
    Object.values(rendered).every(Boolean),
    true,
    'd87_required_rendered_identity_unverified',
  );
  return {
    organizationId: selected.organizationId,
    organizationName: selected.organizationName,
    renderedIdentity: rendered,
  };
}

export async function signInSettings({
  mode,
  page,
  panel,
  repo,
  adminCredentialsFile,
  memberLinkFile,
  allowLadderOrganization = false,
  onStage,
  onAuthDiagnostic,
  onTrace,
  observeBoundary = async () => {},
}) {
  assert.ok(['admin', 'member'].includes(mode), 'd87_auth_mode_invalid');
  if (mode === 'admin') {
    const diagnostic = { stage: 'admin_credentials', signin_observations: {} };
    const stage = (value) => {
      diagnostic.stage = value;
      onStage?.(value);
    };
    let identity;
    try {
      identity = await signInAdminSettings({
        page,
        panel,
        report: diagnostic,
        stage,
        captureIdentity: true,
        readCredentials: async () => {
          const secret = await privateJson(adminCredentialsFile, 'd87_admin_credentials');
          return requireSettingsCredential('admin', JSON.stringify(secret));
        },
      });
    } catch (error) {
      const observed = diagnostic.signin_observations;
      const last = observed.extension_failure ?? observed.extension_last ?? null;
      const storage = await panelIdentity(panel).catch(() => null);
      const account = await accountIdentity(panel, 'admin@admin.com').catch(() => null);
      const booleanOrNull = (value) => (typeof value === 'boolean' ? value : null);
      const phases = new Set([
        'admin_credentials',
        'admin_web_navigation',
        'admin_web_route',
        'admin_credentials_read',
        'admin_web_form_fill',
        'admin_web_submit',
        'admin_extension_settings_click',
        'admin_extension_account_open',
        'admin_extension_signin_ready',
        'admin_extension_click',
        'admin_extension_auth_completion',
      ]);
      const clickCodes = new Set([
        'pointer_initial_evaluation_failed',
        'pointer_page_sample_failed',
        'pointer_target_not_unique',
        'pointer_followup_evaluation_failed',
        'pointer_stable_hit_not_observed',
        'pointer_press_dispatch_failed',
        'pointer_release_dispatch_failed',
        'other',
      ]);
      onAuthDiagnostic?.({
        phase: phases.has(diagnostic.stage) ? diagnostic.stage : 'unknown_admin_phase',
        outcome:
          error?.message === 'admin_extension_auth_completion_failed'
            ? 'extension_completion_unobserved'
            : 'other_admin_auth_failure',
        web_dashboard_reached: observed.web_dashboard_reached === true,
        extension_click_failure_code: clickCodes.has(observed.extension_click_failure?.code)
          ? observed.extension_click_failure.code
          : null,
        settings_panel_active: booleanOrNull(last?.settings_panel_active),
        account_expanded: booleanOrNull(last?.account_expanded),
        sign_in_present:
          Number.isInteger(last?.sign_in_count) && last.sign_in_count >= 0
            ? last.sign_in_count > 0
            : null,
        sign_out_present: booleanOrNull(last?.sign_out_present),
        auth_error_present: booleanOrNull(last?.auth_error_present),
        auth_retry_present: booleanOrNull(last?.auth_retry_present),
        loading_present: booleanOrNull(last?.loading_present),
        rendered_admin_email: booleanOrNull(last?.expected_admin_email),
        rendered_admin_role: booleanOrNull(last?.admin_role),
        organization_selector_present: booleanOrNull(account?.organizationPickerAvailable),
        storage_access_token_present: booleanOrNull(storage?.accessTokenPresent),
        storage_profile_present:
          storage?.profileId === null
            ? false
            : typeof storage?.profileId === 'string'
              ? true
              : null,
        storage_admin_flag: booleanOrNull(storage?.isAdmin),
        http_category: 'unobserved',
      });
      throw error;
    }
    const stored = await panelIdentity(panel);
    assert.equal(stored.profileId, identity.userId, 'd87_admin_profile_mismatch');
    assert.equal(stored.isAdmin, true, 'd87_admin_role_unverified');
    onStage?.('admin_rendered_identity');
    let rendered;
    try {
      rendered = await verifyCurrentSettingsIdentity({
        panel,
        mode,
        email: identity.email,
        profileId: identity.userId,
        organizationId: stored.organizationId,
      });
    } catch (error) {
      const account = await accountIdentity(panel, identity.email).catch(() => null);
      const latest = await panelIdentity(panel).catch(() => null);
      const booleanOrNull = (value) => (typeof value === 'boolean' ? value : null);
      onAuthDiagnostic?.({
        phase: 'admin_rendered_identity',
        outcome: error?.message?.startsWith('d87_rendered_identity_not_observed:')
          ? 'rendered_identity_unobserved'
          : 'rendered_identity_check_failed',
        web_identity_verified: true,
        storage_profile_matches_web: latest ? latest.profileId === identity.userId : null,
        storage_admin_flag: booleanOrNull(latest?.isAdmin),
        storage_access_token_present: booleanOrNull(latest?.accessTokenPresent),
        rendered_admin_email: booleanOrNull(account?.emailMatches),
        rendered_admin_role: booleanOrNull(account?.adminRole),
        rendered_sign_out: booleanOrNull(account?.signOutVisible),
        rendered_organization_selected: booleanOrNull(account?.organizationSelected),
        rendered_organization_matches_storage:
          account && latest
            ? account.organizationSelected &&
              account.organizationLabel === latest.organizationName &&
              latest.organizationId === stored.organizationId
            : null,
      });
      throw error;
    }
    return {
      mode,
      profileId: identity.userId,
      email: identity.email,
      organizationId: stored.organizationId,
      account_fingerprint: fingerprint(identity.email),
      web_signed_in: true,
      extension_signed_in: true,
      admin_role: true,
      canonical_nonadmin_check: null,
      organization_selected: null,
      rendered_identity: rendered,
    };
  }
  const web = await page.context().newPage();
  try {
    await observeBoundary('member_web_created').catch(() => {});
    onStage?.('member_magic_link');
    const secret = requireSettingsCredential(
      'member',
      JSON.stringify(await privateJson(memberLinkFile, 'd87_member_link')),
    );
    const expectedOrganizationId = allowLadderOrganization ? secret.organization_id : null;
    if (allowLadderOrganization)
      assert.match(
        expectedOrganizationId ?? '',
        UUID,
        'd87_member_expected_organization_unverified',
      );
    const link = new URL(secret.action_link);
    await web.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const email = secret.email;
    onStage?.(`${mode}_web_identity`);
    const identity = await waitFor(
      'd87_web_identity',
      () => authenticatedWebIdentity(web, MEMBER_FINGERPRINT),
      (value) =>
        UUID.test(value?.userId ?? '') && value.email?.toLowerCase() === email.toLowerCase(),
      90_000,
    );
    await web.goto(`${ORIGIN}/matrx-extend-demo`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    assert.equal(new URL(web.url()).pathname, '/matrx-extend-demo', 'd87_demo_route_unverified');
    onStage?.(`${mode}_extension_signin`);
    await click(panel, 'title', 'Settings');
    await openSection(panel, 'Account');
    await waitFor(
      'd87_extension_signin_ready',
      () => accountIdentity(panel, email),
      (value) => value?.signInEnabled,
    );
    const adminCheck = observeCanonicalAdminCheck(panel, await supabaseOrigin(repo));
    await adminCheck.start();
    let canonical = null;
    try {
      await click(panel, 'button', 'Sign in');
      await openSection(panel, 'Organization');
      const account = await waitFor(
        'd87_extension_identity',
        async () => {
          await approveConsent(page.context());
          return { ...(await accountIdentity(panel, email)), ...(await panelIdentity(panel)) };
        },
        (value) =>
          value?.emailMatches &&
          value.profileId === identity.userId &&
          value.accessTokenPresent &&
          value.signOutVisible &&
          value.isAdmin !== true,
        90_000,
      );
      await observeBoundary('member_oauth_completed').catch(() => {});
      await onTrace?.('auth_admin_before');
      canonical = await adminCheck.verify(identity.userId);
      await onTrace?.('auth_admin_after');
      await onTrace?.('auth_org_before');
      const org = await waitFor(
        'd87_member_organization',
        () => accountIdentity(panel, email),
        (value) => value?.organizationSelected || value?.organizationPickerAvailable,
        30_000,
      );
      const selectionRequired =
        !org.organizationSelected || org.organizationLabel !== "Matrx's Org";
      await onTrace?.(selectionRequired ? 'auth_org_select' : 'auth_org_skip');
      if (selectionRequired) await selectOrganization(panel, MEMBER_TEST_ORGANIZATION_NAME);
      await onTrace?.('auth_org_after');
      const visibleOrganization = await waitFor(
        'd87_member_organization_selected',
        () => accountIdentity(panel, email),
        (value) => value?.organizationSelected && value.organizationLabel === "Matrx's Org",
        30_000,
      );
      const selected = await panelIdentity(panel);
      const organizationResolution = resolveMemberOrganizationSelection(
        selected,
        visibleOrganization.organizationLabel,
        allowLadderOrganization,
        expectedOrganizationId,
      );
      await onTrace?.('auth_identity_before');
      const rendered = await verifyCurrentSettingsIdentity({
        panel,
        mode,
        email: identity.email,
        profileId: identity.userId,
        organizationId: selected.organizationId,
      });
      await onTrace?.('auth_identity_after');
      return {
        mode,
        profileId: identity.userId,
        email: identity.email,
        organizationId: expectedOrganizationId ?? selected.organizationId,
        organization_resolution: organizationResolution,
        account_fingerprint: fingerprint(identity.email),
        web_signed_in: true,
        extension_signed_in: true,
        admin_role: account.adminRole,
        canonical_nonadmin_check: canonical,
        organization_selected: true,
        rendered_identity: rendered,
      };
    } finally {
      await onTrace?.('auth_cleanup_before');
      await adminCheck.stop();
      await onTrace?.('auth_cleanup_after');
    }
  } finally {
    // Keep cleanup ordered even if an optional observer cannot read the browser.
    await observeBoundary('member_before_web_close').catch(() => {});
    await web.close();
    await observeBoundary('member_after_web_close').catch(() => {});
    await page.bringToFront();
    await observeBoundary('member_after_root_activation').catch(() => {});
  }
}
