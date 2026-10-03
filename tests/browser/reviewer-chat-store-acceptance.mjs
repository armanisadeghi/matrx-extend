#!/usr/bin/env node
/**
 * Receipt-bound Store reviewer acceptance for signed-in, non-admin Chat.
 * Credentials are read only at the web form; evidence contains fixed booleans,
 * hashes, and panel-only screenshots—never auth-form screenshots or values.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = join(REPO, 'test-results', `reviewer-chat-store-${randomUUID()}.json`);
const EXTENSION_DIR = resolve(
  process.env.MATRX_REVIEWER_EXTENSION_DIR ?? join(REPO, '.output', 'chrome-mv3-dev'),
);
const RECEIPT = resolve(
  process.env.MATRX_REVIEWER_RELEASE_RECEIPT ?? join(REPO, '.output', 'release-receipt.json'),
);
const CREDENTIALS = process.env.MATRX_REVIEWER_CREDENTIALS_FILE;
const MAGIC_LINK = process.env.MATRX_REVIEWER_MAGIC_LINK_FILE;
const INTERACTIVE_REVIEWER = process.env.MATRX_REVIEWER_INTERACTIVE === '1';
const INTERACTIVE_REVIEWER_EMAIL = process.env.MATRX_REVIEWER_EMAIL?.trim() || null;
const WEB_ORIGIN = 'https://www.aimatrx.com';
const DEMO_PATH = '/matrx-extend-demo';
const QUESTION = 'What are the three workflow stages on this page?';

let stage = 'not_started';
const report = {
  schema_version: 1,
  scope: 'fresh owned Chrome-for-Testing profile; real non-admin login; native signed-in Chat',
  status: 'unverified',
  build: null,
  account: null,
  authentication_method: null,
  chat: null,
  screenshots: null,
  failure_stage: null,
};

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function safeLocation(raw) {
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

async function credentials() {
  if (!CREDENTIALS) throw new Error('reviewer_credentials_file_required');
  const parsed = JSON.parse(await readFile(CREDENTIALS, 'utf8'));
  if (
    typeof parsed.email !== 'string' ||
    !parsed.email ||
    typeof parsed.password !== 'string' ||
    !parsed.password
  )
    throw new Error('reviewer_credentials_unavailable');
  return { email: parsed.email, password: parsed.password };
}

async function magicLink() {
  if (!MAGIC_LINK) throw new Error('reviewer_magic_link_file_required');
  const metadata = await stat(MAGIC_LINK);
  if ((metadata.mode & 0o077) !== 0) throw new Error('reviewer_magic_link_file_not_private');
  const parsed = JSON.parse(await readFile(MAGIC_LINK, 'utf8'));
  if (typeof parsed.email !== 'string' || !parsed.email || typeof parsed.action_link !== 'string')
    throw new Error('reviewer_magic_link_unavailable');
  const link = new URL(parsed.action_link);
  if (
    link.protocol !== 'https:' ||
    link.origin !== WEB_ORIGIN ||
    link.pathname !== '/auth/confirm' ||
    link.searchParams.get('type') !== 'magiclink' ||
    !link.searchParams.get('token_hash')
  )
    throw new Error('reviewer_magic_link_authority_unverified');
  return { email: parsed.email, url: link.href };
}

/** Assert the cookie-backed web identity through the first-party, credential-free whoami door. */
async function authenticatedWebEmail(page) {
  const location = safeLocation(page.url());
  if (location === `${WEB_ORIGIN}/login`) return null;
  const identity = await page.evaluate(async () => {
    const response = await fetch('/api/whoami', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    const result = await response.json();
    return result?.signed_in === true &&
      typeof result.email === 'string' &&
      result.email.includes('@')
      ? result.email
      : null;
  });
  if (
    identity &&
    INTERACTIVE_REVIEWER_EMAIL &&
    identity.toLowerCase() !== INTERACTIVE_REVIEWER_EMAIL.toLowerCase()
  ) {
    throw new Error('reviewer_web_identity_mismatch');
  }
  return identity;
}

async function capture(panel, artifacts, label) {
  const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
  const file = join(artifacts, `${label}.png`);
  await writeFile(file, Buffer.from(data, 'base64'), { mode: 0o600 });
  return file;
}

/** A panel-only Store candidate; functional acceptance is complete before resizing. */
async function captureStoreCandidate(panel, artifacts) {
  await panel.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 400,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    return await capture(panel, artifacts, 'reviewer-chat-store-640x400');
  } finally {
    await panel.send('Emulation.clearDeviceMetricsOverride');
  }
}

async function accountObservation(panel, expectedEmail) {
  return evaluate(
    panel,
    `(() => {
      const account = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Account');
      const section = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
        .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      const email = row('Email'), role = row('Role');
      const organization = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Organization');
      const orgSection = organization?.parentElement?.nextElementSibling;
      const orgButton = orgSection?.querySelector('button[role="combobox"]');
      const orgText = orgButton?.textContent?.trim() ?? '';
      return {
        emailMatchesReviewer: email === ${JSON.stringify(`Email${expectedEmail}`)},
        observedRoleCategory: role === null ? 'absent' : /admin/i.test(role) ? 'admin' : 'non_admin',
        signOutVisible: [...document.querySelectorAll('button')]
          .some((button) => button.textContent.trim() === 'Sign out'),
        signInVisible: [...document.querySelectorAll('button')]
          .some((button) => button.textContent.trim() === 'Sign in'),
        organizationSelected: Boolean(orgButton && orgText && orgText !== 'Choose…'),
        organizationPickerAvailable: Boolean(orgButton),
        organizationLoading: orgSection?.textContent?.includes('Loading…') === true,
        chatVisible: [...document.querySelectorAll('button[role="tab"]')]
          .some((button) => button.title === 'Chat' && button.getBoundingClientRect().width > 0),
      };
    })()`,
  );
}

async function storedSessionShape(panel) {
  return evaluate(
    panel,
    `(() => chrome.storage.local.get([
      'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.org.active',
    ]).then((stored) => ({
      accessTokenPresent: typeof stored['matrx.auth.accessToken'] === 'string',
      profilePresent: Boolean(stored['matrx.user.profile']?.id),
      activeOrganizationPresent: typeof stored['matrx.org.active'] === 'string',
    })))()`,
  );
}

async function selectReviewerOrganization(panel) {
  await click(panel, 'organization', '');
  const target = await evaluate(
    panel,
    `(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
      const options = [...document.querySelectorAll('[role="option"]')].filter(visible);
      const labels = options.map((option) => option.textContent.trim());
      const matches = options.filter((option) => option.textContent.trim() === "Matrx's Org");
      if (matches.length !== 1) return { labels, matchedCount: matches.length, target: null };
      const option = matches[0], rect = option.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { labels, matchedCount: 1, target: hit === option || option.contains(hit), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
  );
  if (target?.matchedCount !== 1 || target.target !== true) {
    const error = new Error('reviewer_organization_option_unavailable');
    error.safeOptions = target?.labels ?? [];
    throw error;
  }
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: target.x,
    y: target.y,
    button: 'left',
    clickCount: 1,
  });
}

/** Approve only the owned extension OAuth consent page; no URL query or body leaves the browser. */
async function approveOwnedOauthConsent(context) {
  for (const candidate of context.pages()) {
    let location;
    try {
      location = safeLocation(candidate.url());
    } catch {
      continue;
    }
    if (location !== `${WEB_ORIGIN}/oauth/consent`) continue;
    const authorize = candidate.getByRole('button', { name: 'Authorize', exact: true });
    if ((await authorize.count()) !== 1) return 'consent_button_unavailable';
    await authorize.click();
    return 'authorized';
  }
  return 'not_present';
}

async function chatObservation(panel) {
  return evaluate(
    panel,
    `(() => {
      const chat = [...document.querySelectorAll('button[role="tab"]')]
        .find((button) => button.title === 'Chat');
      const pane = chat ? document.getElementById(chat.getAttribute('aria-controls') ?? '') : null;
      const textarea = pane?.querySelector('textarea') ?? null;
      const send = pane?.querySelector('button[title="Send"]') ?? null;
      const stop = pane?.querySelector('button[title="Stop"]') ?? null;
      const replyCopy = [...(pane?.querySelectorAll('button[title="Copy reply"]') ?? [])];
      return {
        selected: chat?.getAttribute('aria-selected') === 'true',
        paneVisible: Boolean(pane && pane.getAttribute('data-state') === 'active' && pane.getBoundingClientRect().height > 0),
        composerReady: textarea !== null && textarea.getBoundingClientRect().height > 0,
        sendEnabled: Boolean(send && !send.disabled),
        streaming: stop !== null,
        completedReplyCount: replyCopy.length,
        answerNamesWorkflowStages: ['Capture', 'Understand', 'Use'].every((term) =>
          (pane?.innerText ?? '').includes(term),
        ),
      };
    })()`,
  );
}

try {
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  report.build = {
    version: receipt.version,
    tree_sha256: receipt.treeSha256,
    receipt_kind: receipt.kind ?? 'release',
  };
  stage = 'owned_profile';
  const run = await runNativeSidepanelQa({
    headed: INTERACTIVE_REVIEWER,
    extensionDir: EXTENSION_DIR,
    expectedRelease: receipt,
    ...(receipt.kind === 'local_dev_unpacked' && { localDevReceiptPath: RECEIPT }),
    exercisePanel: async ({ page, panel, artifacts }) => {
      stage = MAGIC_LINK ? 'open_reviewer_magic_link' : 'open_reviewer_web_login';
      const web = await page.context().newPage();
      try {
        if (!MAGIC_LINK) {
          await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          if (safeLocation(web.url()) !== `${WEB_ORIGIN}/login`)
            throw new Error('reviewer_login_route_unverified');
        }
        let email;
        if (MAGIC_LINK) {
          const auth = await magicLink();
          email = auth.email;
          report.authentication_method = 'existing_user_magic_link';
          report.account = { reviewer_fingerprint: hash(email), web_signed_in: false };
          await web.goto(auth.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          email = await waitFor(
            'reviewer_magic_link_web_session',
            () => authenticatedWebEmail(web),
            (value) => value?.toLowerCase() === auth.email.toLowerCase(),
            90_000,
          );
        } else if (INTERACTIVE_REVIEWER) {
          report.authentication_method = 'manual_password_login';
          stage = 'ready_manual_reviewer_login';
          process.stdout.write('STAGE ready_manual_reviewer_login\n');
          email = await waitFor(
            'reviewer_manual_web_session',
            () => authenticatedWebEmail(web),
            (value) => typeof value === 'string' && value.includes('@'),
            180_000,
          );
        } else {
          report.authentication_method = 'password_login';
          const auth = await credentials();
          email = auth.email;
          report.account = { reviewer_fingerprint: hash(email), web_signed_in: false };
          stage = 'fill_reviewer_web_login';
          await web.locator('input[name="email"]').fill(auth.email);
          await web.locator('input[name="password"]').fill(auth.password);
          stage = 'submit_reviewer_web_login';
          await web.getByRole('button', { name: 'Sign in', exact: true }).click();
          await waitFor(
            'reviewer_real_web_session',
            () => safeLocation(web.url()),
            (location) => location.startsWith(WEB_ORIGIN) && location !== `${WEB_ORIGIN}/login`,
            90_000,
          );
        }
        report.account = { reviewer_fingerprint: hash(email), web_signed_in: false };
        report.account.web_signed_in = true;
        stage = 'open_demo_page';
        await web.goto(`${WEB_ORIGIN}${DEMO_PATH}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        if (safeLocation(web.url()) !== `${WEB_ORIGIN}${DEMO_PATH}`)
          throw new Error('reviewer_demo_route_unverified');

        stage = 'extension_settings_open';
        await click(panel, 'title', 'Settings');
        stage = 'extension_account_open';
        await openSection(panel, 'Account');
        stage = 'extension_signin_click';
        await click(panel, 'button', 'Sign in');
        stage = 'extension_organization_open';
        await openSection(panel, 'Organization');
        stage = 'extension_identity_wait';
        let account;
        try {
          account = await waitFor(
            'reviewer_non_admin_identity',
            async () => {
              const consent = await approveOwnedOauthConsent(page.context());
              if (consent === 'authorized') report.account.oauth_consent = 'authorized';
              return accountObservation(panel, email);
            },
            (state) =>
              state?.emailMatchesReviewer &&
              state.observedRoleCategory !== 'admin' &&
              state.signOutVisible &&
              state.chatVisible,
            90_000,
          );
        } catch {
          const observed = await accountObservation(panel, email).catch(() => null);
          const storage = await storedSessionShape(panel).catch(() => null);
          report.account = {
            ...report.account,
            timeout_observation: observed,
            storage_shape: storage,
          };
          report.screenshots = {
            timeout_panel: await capture(panel, artifacts, 'reviewer-chat-timeout'),
          };
          throw new Error('reviewer_extension_identity_unverified');
        }
        stage = 'reviewer_organization_resolve';
        account = await waitFor(
          'reviewer_organization_resolved',
          () => accountObservation(panel, email),
          (state) => state?.organizationSelected || state?.organizationPickerAvailable,
          30_000,
        );
        if (!account.organizationSelected) {
          stage = 'select_reviewer_default_organization';
          try {
            await selectReviewerOrganization(panel);
          } catch (error) {
            report.account = {
              reviewer_fingerprint: hash(email),
              extension_signed_in: account.emailMatchesReviewer,
              observed_role_category: account.observedRoleCategory,
              sign_out_visible: account.signOutVisible,
              organization_picker_available: account.organizationPickerAvailable,
              organization_options: error.safeOptions ?? [],
              storage_shape: await storedSessionShape(panel),
            };
            report.screenshots = {
              organization_picker: await capture(panel, artifacts, 'reviewer-organization-picker'),
            };
            throw error;
          }
          stage = 'reviewer_default_organization_wait';
          account = await waitFor(
            'reviewer_default_organization_selected',
            () => accountObservation(panel, email),
            (state) => state?.organizationSelected === true,
            30_000,
          );
        }
        report.account = {
          reviewer_fingerprint: hash(email),
          web_signed_in: true,
          extension_signed_in: account.emailMatchesReviewer,
          observed_role_category: account.observedRoleCategory,
          sign_out_visible: account.signOutVisible,
          default_organization_selected: account.organizationSelected,
          organization_picker_available: account.organizationPickerAvailable,
          storage_shape: await storedSessionShape(panel),
        };

        stage = 'open_chat';
        await click(panel, 'title', 'Chat');
        await waitFor(
          'reviewer_chat_visible',
          () => chatObservation(panel),
          (state) => state?.selected && state.paneVisible && state.composerReady,
          30_000,
        );
        report.screenshots = {
          before: await capture(panel, artifacts, 'reviewer-chat-before'),
          action: null,
          result: null,
        };

        stage = 'enter_three_stage_question';
        const focused = await evaluate(
          panel,
          `(() => { const el = document.querySelector('textarea'); if (!el) return false; el.focus(); return document.activeElement === el; })()`,
        );
        assert.equal(focused, true, 'chat composer must receive trusted input');
        await panel.send('Input.insertText', { text: QUESTION });
        await waitFor(
          'reviewer_chat_send_ready',
          () => chatObservation(panel),
          (state) => state?.sendEnabled,
          10_000,
        );
        report.screenshots.action = await capture(panel, artifacts, 'reviewer-chat-action');

        stage = 'send_three_stage_question';
        await click(panel, 'title', 'Send');
        const completed = await waitFor(
          'reviewer_real_chat_answer',
          () => chatObservation(panel),
          (state) =>
            state?.composerReady &&
            !state.streaming &&
            state.completedReplyCount >= 1 &&
            state.answerNamesWorkflowStages,
          180_000,
        );
        report.screenshots.result = await capture(panel, artifacts, 'reviewer-chat-result');
        report.screenshots.store_candidate_640x400 = await captureStoreCandidate(panel, artifacts);
        report.chat = {
          visible: true,
          question_fingerprint: hash(QUESTION),
          accepted: true,
          completed_real_answer: completed.completedReplyCount >= 1 && !completed.streaming,
          completed_reply_count: completed.completedReplyCount,
          answer_names_capture_understand_use: completed.answerNamesWorkflowStages,
          demo_route: `${WEB_ORIGIN}${DEMO_PATH}`,
        };
      } finally {
        await web.close();
      }
    },
  });
  report.build.extension_id = run.extensionId;
  report.status = 'pass';
} catch {
  report.failure_stage = stage;
  report.status = 'unverified';
}
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} reviewer_chat_store\n`);
if (report.status !== 'pass') process.exitCode = 1;
