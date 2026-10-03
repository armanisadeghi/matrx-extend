import assert from 'node:assert/strict';
import {
  activeTabPanelExpression,
  click,
  evaluate,
  openSection,
  waitFor,
} from './settings-panel-driver.mjs';

const WEB_ORIGIN = 'https://www.aimatrx.com';

async function extensionAuthState(panel) {
  return evaluate(
    panel,
    `(() => {
      const settings = ${activeTabPanelExpression('Settings')};
      const account = [...(settings?.querySelectorAll('button[aria-expanded]') ?? [])]
        .find((button) => button.textContent.trim() === 'Account');
      const section = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
        .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      const email = row('Email');
      const role = row('Role');
      const buttons = [...(settings?.querySelectorAll('button') ?? [])];
      const signIn = buttons.filter((button) => button.textContent.trim() === 'Sign in');
      const retry = buttons.find((button) => button.textContent.trim() === 'Try again');
      return {
        settings_panel_active: Boolean(settings),
        account_present: Boolean(account),
        account_expanded: account?.getAttribute('aria-expanded') === 'true',
        email_row_present: email !== null,
        expected_admin_email: email === 'Emailadmin@admin.com',
        admin_role: role?.toLowerCase() === 'roleadmin',
        sign_in_count: signIn.length,
        sign_in_enabled: signIn.length === 1 && !signIn[0].disabled,
        sign_out_present: buttons.some((button) => button.textContent.trim() === 'Sign out'),
        auth_error_present: Boolean(document.querySelector('[role="alert"]')),
        auth_retry_present: Boolean(retry),
        auth_retry_disabled: retry?.disabled ?? false,
        loading_present: Boolean(document.querySelector('[role="progressbar"], [aria-busy="true"]')),
      };
    })()`,
  );
}

export async function signInAdminSettings({
  page,
  panel,
  report,
  stage,
  readCredentials,
  captureIdentity = false,
}) {
  const web = await page.context().newPage();
  try {
    stage('admin_web_navigation');
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    stage('admin_web_route');
    assert.equal(new URL(web.url()).pathname, '/login', 'prepare_web_login_path');
    stage('admin_credentials_read');
    const secret = await readCredentials();
    stage('admin_web_form_fill');
    await web.locator('input[name="email"]').fill(secret.email);
    await web.locator('input[name="password"]').fill(secret.password);
    stage('admin_web_submit');
    try {
      await Promise.all([
        web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
          timeout: 90_000,
        }),
        web.getByRole('button', { name: 'Sign in', exact: true }).click(),
      ]);
    } catch {
      report.signin_observations.web_after_submit = {
        route:
          new URL(web.url()).origin !== WEB_ORIGIN
            ? 'other_origin'
            : new URL(web.url()).pathname === '/login'
              ? 'login'
              : new URL(web.url()).pathname === '/dashboard'
                ? 'dashboard'
                : 'other_path',
        alert_present: await web
          .locator('[role="alert"]')
          .count()
          .then((count) => count > 0)
          .catch(() => null),
      };
      throw new Error('admin_web_submit_unverified');
    }
    report.signin_observations.web_dashboard_reached = true;
    stage('admin_extension_settings_click');
    await click(panel, 'title', 'Settings');
    stage('admin_extension_account_open');
    await openSection(panel, 'Account');
    report.signin_observations.extension_after_account_open = await extensionAuthState(panel);
    stage('admin_extension_signin_ready');
    try {
      report.signin_observations.extension_guest_ready = await waitFor(
        'prepare_extension_signin_ready',
        () => extensionAuthState(panel),
        (value) => value?.sign_in_count === 1 && value.sign_in_enabled,
      );
    } catch {
      report.signin_observations.extension_signin_last = await extensionAuthState(panel).catch(
        () => null,
      );
      throw new Error('prepare_extension_signin_not_ready');
    }
    stage('admin_extension_click');
    try {
      await click(panel, 'settings-button', 'Sign in');
    } catch (error) {
      const failure = error?.driverFailure;
      const knownCodes = new Set([
        'pointer_initial_evaluation_failed',
        'pointer_page_sample_failed',
        'pointer_target_not_unique',
        'pointer_followup_evaluation_failed',
        'pointer_stable_hit_not_observed',
        'pointer_press_dispatch_failed',
        'pointer_release_dispatch_failed',
      ]);
      report.signin_observations.extension_click_failure = {
        code: knownCodes.has(failure?.code) ? failure.code : 'other',
        matched_target_count: Number.isInteger(failure?.matchedTargetCount)
          ? failure.matchedTargetCount
          : null,
        visible_match_count: Number.isInteger(failure?.visibleMatchCount)
          ? failure.visibleMatchCount
          : null,
        hit_target: failure?.hitTarget === true,
        target_disabled: failure?.targetDisabled === true,
        center_hit_category: [
          'none',
          'target',
          'dialog',
          'listbox',
          'modal_overlay',
          'target_ancestor',
          'header_or_tabs',
          'other_element',
        ].includes(failure?.centerHitCategory)
          ? failure.centerHitCategory
          : 'unknown',
      };
      throw error;
    }
    stage('admin_extension_auth_completion');
    await waitFor(
      'prepare_admin_ready',
      async () => {
        const observed = await extensionAuthState(panel);
        report.signin_observations.extension_last = observed;
        return observed;
      },
      (value) => value?.expected_admin_email && value.admin_role,
      90_000,
    );
    if (captureIdentity) {
      const identity = await waitFor(
        'd87_admin_web_identity',
        () =>
          web.evaluate(async () => {
            const response = await fetch('/api/whoami', {
              credentials: 'include',
              cache: 'no-store',
            });
            if (!response.ok) return null;
            const value = await response.json();
            return value?.signed_in === true ? { email: value.email, userId: value.user_id } : null;
          }),
        (value) =>
          value?.email?.toLowerCase() === 'admin@admin.com' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value?.userId ?? '',
          ),
        30_000,
      );
      return identity;
    }
  } catch {
    if (report.stage.startsWith('admin_extension_')) {
      report.signin_observations.extension_failure = await extensionAuthState(panel).catch(
        () => null,
      );
    }
    throw new Error(`${report.stage}_failed`);
  } finally {
    await web.close();
    await page.bringToFront();
  }
}
