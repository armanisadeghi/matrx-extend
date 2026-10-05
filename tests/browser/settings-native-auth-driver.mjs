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

export function settingsOrganizationSelectionRequired(value) {
  return !value?.organizationSelected || value.organizationLabel !== MEMBER_TEST_ORGANIZATION_NAME;
}

async function privateJson(file, code) {
  assert.ok(file, `${code}_file_required`);
  const metadata = await stat(file);
  assert.equal(metadata.mode & 0o077, 0, `${code}_file_not_private`);
  return JSON.parse(await readFile(file, 'utf8'));
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

async function accountIdentity(panel, email) {
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
  const organizationMatches =
    organizationId === null
      ? !requireSelectedOrganization &&
        value?.organizationId === null &&
        !value?.organizationSelected
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

async function selectOrganization(panel) {
  await click(panel, 'organization', '');
  const target = await evaluate(
    panel,
    `(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const matches = [...document.querySelectorAll('[role="option"]')]
      .filter(visible).filter((option) => option.textContent.trim() === ${JSON.stringify(MEMBER_TEST_ORGANIZATION_NAME)});
    if (matches.length !== 1) return null;
    const rect = matches[0].getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return hit === matches[0] || matches[0].contains(hit) ? { x, y } : null;
  })()`,
  );
  assert.ok(target, 'd87_member_organization_option_unavailable');
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...target,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...target,
    button: 'left',
    clickCount: 1,
  });
}

/** Select and verify the approved device organization for an acceptance that requires it. */
export async function selectRequiredSettingsOrganization({
  panel,
  mode,
  email,
  profileId,
  onBranch,
}) {
  assert.ok(['admin', 'member'].includes(mode), 'd87_auth_mode_invalid');
  await openSection(panel, 'Organization');
  const org = await waitFor(
    'd87_required_organization_picker',
    () => accountIdentity(panel, email),
    (value) => value?.organizationSelected || value?.organizationPickerAvailable,
    30_000,
  );
  const selectionRequired = settingsOrganizationSelectionRequired(org);
  await onBranch?.(selectionRequired ? 'organization_select' : 'organization_skip');
  if (selectionRequired) await selectOrganization(panel);
  const selected = await waitFor(
    'd87_required_organization_storage',
    () => panelIdentity(panel),
    (value) =>
      UUID.test(value?.organizationId ?? '') &&
      value?.organizationName === MEMBER_TEST_ORGANIZATION_NAME,
    30_000,
  );
  const rendered = await verifyCurrentSettingsIdentity({
    panel,
    mode,
    email,
    profileId,
    organizationId: selected.organizationId,
    requireSelectedOrganization: true,
    requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
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
  onStage,
  observeBoundary = async () => {},
}) {
  assert.ok(['admin', 'member'].includes(mode), 'd87_auth_mode_invalid');
  if (mode === 'admin') {
    const diagnostic = { stage: 'admin_credentials', signin_observations: {} };
    const stage = (value) => {
      diagnostic.stage = value;
      onStage(value);
    };
    const identity = await signInAdminSettings({
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
    const stored = await panelIdentity(panel);
    assert.equal(stored.profileId, identity.userId, 'd87_admin_profile_mismatch');
    assert.equal(stored.isAdmin, true, 'd87_admin_role_unverified');
    const rendered = await verifyCurrentSettingsIdentity({
      panel,
      mode,
      email: identity.email,
      profileId: identity.userId,
      organizationId: stored.organizationId,
    });
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
    onStage('member_magic_link');
    const secret = requireSettingsCredential(
      'member',
      JSON.stringify(await privateJson(memberLinkFile, 'd87_member_link')),
    );
    const link = new URL(secret.action_link);
    await web.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const email = secret.email;
    onStage(`${mode}_web_identity`);
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
    onStage(`${mode}_extension_signin`);
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
      canonical = await adminCheck.verify(identity.userId);
      const org = await waitFor(
        'd87_member_organization',
        () => accountIdentity(panel, email),
        (value) => value?.organizationSelected || value?.organizationPickerAvailable,
        30_000,
      );
      if (!org.organizationSelected || org.organizationLabel !== "Matrx's Org")
        await selectOrganization(panel);
      await waitFor(
        'd87_member_organization_selected',
        () => accountIdentity(panel, email),
        (value) => value?.organizationSelected && value.organizationLabel === "Matrx's Org",
        30_000,
      );
      const selected = await panelIdentity(panel);
      assert.ok(
        UUID.test(selected.organizationId ?? ''),
        'd87_member_organization_uuid_unverified',
      );
      assert.equal(
        selected.organizationName,
        "Matrx's Org",
        'd87_member_organization_name_unverified',
      );
      const rendered = await verifyCurrentSettingsIdentity({
        panel,
        mode,
        email: identity.email,
        profileId: identity.userId,
        organizationId: selected.organizationId,
      });
      return {
        mode,
        profileId: identity.userId,
        email: identity.email,
        organizationId: selected.organizationId,
        account_fingerprint: fingerprint(identity.email),
        web_signed_in: true,
        extension_signed_in: true,
        admin_role: account.adminRole,
        canonical_nonadmin_check: canonical,
        organization_selected: true,
        rendered_identity: rendered,
      };
    } finally {
      await adminCheck.stop();
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
