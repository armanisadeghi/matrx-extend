#!/usr/bin/env node
/** Real guest Chat acceptance in a fresh, receipt-bound native side panel. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RECEIPT = resolve(
  process.env.MATRX_GUEST_CHAT_DEV_RECEIPT ??
    process.env.MATRX_GUEST_CHAT_RELEASE_RECEIPT ??
    join(REPO, '.output', 'release-receipt.json'),
);
const EXTENSION_DIR = resolve(
  process.env.MATRX_GUEST_CHAT_EXTENSION_DIR ?? join(REPO, '.output', 'chrome-mv3-dev'),
);
const OUTPUT = join(REPO, 'test-results', `guest-chat-store-${randomUUID()}.json`);
const WEB_ORIGIN = 'https://www.aimatrx.com';
const DEMO_PATH = '/matrx-extend-demo';
const FIRST_QUESTION =
  'Read the unique opening check code from the article on my current tab. What are the three workflow stages in order? Include the exact code.';
const FOLLOWUP_QUESTION =
  'Read the unique follow-up check code from the article on my current tab and quote the article\'s main heading (its H1) exactly. Include the exact code.';
const REQUIRED_ANSWER_TERMS = ['Capture', 'Understand', 'Use'];
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

let stage = 'receipt';
const report = {
  schema_version: 1,
  scope:
    'fresh owned guest profile; unpredictable page fixture; real Chat answer and post-reload guest follow-up',
  status: 'unverified',
  build: null,
  guest: null,
  chat: null,
  screenshot: null,
  followup_screenshot: null,
  failure_stage: null,
  failure_code: null,
  failure_reason: null,
};

async function observe(panel, expected = {}) {
  return evaluate(
    panel,
    `(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden';
      };
      const chat = [...document.querySelectorAll('button[role="tab"]')]
        .find((button) => button.title === 'Chat');
      const pane = chat ? document.getElementById(chat.getAttribute('aria-controls') ?? '') : null;
      const active = pane?.getAttribute('data-state') === 'active' && visible(pane);
      const replies = active ? [...pane.querySelectorAll('button[title="Copy reply"]')]
        .map((button) => button.closest('div.group.space-y-2')?.innerText ?? '') : [];
      const latestReply = replies.at(-1) ?? '';
      const stored = chrome.storage.local.get([
        'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.org.active',
      ]);
      return stored.then((values) => ({
        guestAccount: visible(document.querySelector('button[title="Account"]')),
        accessTokenAbsent: !values['matrx.auth.accessToken'],
        profileAbsent: !values['matrx.user.profile'],
        organizationAbsent: !values['matrx.org.active'],
        chatVisible: visible(chat),
        chatSelected: chat?.getAttribute('aria-selected') === 'true',
        paneVisible: Boolean(active),
        composerVisible: active && visible(pane.querySelector('textarea')),
        sendEnabled: active && [...pane.querySelectorAll('button[title="Send"]')]
          .some((button) => visible(button) && !button.disabled),
        streaming: active && Boolean(pane.querySelector('button[title="Stop"]')),
        replyCount: replies.length,
        answerContainsNonce: Boolean(${JSON.stringify(expected.nonce ?? null)}) &&
          latestReply.includes(${JSON.stringify(expected.nonce ?? '')}),
        answerContainsFixtureHeading: Boolean(${JSON.stringify(expected.fixtureHeading ?? null)}) &&
          latestReply.includes(${JSON.stringify(expected.fixtureHeading ?? '')}),
        answerMatchesPublicStages: ${JSON.stringify(REQUIRED_ANSWER_TERMS)}
          .every((term) => latestReply.includes(term)),
        answerIsRefusal: /(?:authentication (?:is )?required|you (?:must|need to) (?:sign.?in|log.?in|authenticate)|(?:sign.?in|log.?in) (?:to|before) (?:use|ask|send|continue)|upgrade|subscribe|payment required|unauthori[sz]ed|forbidden|\\b401\\b|\\b403\\b)/i
          .test(latestReply),
        errorNotice: active && Boolean(pane.querySelector('[role="alert"]')),
      }));
    })()`,
  );
}

async function installPageFixture(page) {
  const expectedOrigin = `${WEB_ORIGIN}`;
  const originalTitle = await page.title();
  const fixture = {
    fragment: `guest-chat-${randomUUID()}`,
    title: `Matrx guest Chat grounding fixture ${randomUUID()}`,
    openingCode: randomUUID().toUpperCase(),
    followupCode: randomUUID().toUpperCase(),
  };
  const installed = await page.evaluate((values) => {
    // The fixture goes INSIDE the page's own main article: the extension's article
    // extractor (like every reader-mode extractor) keeps one main article, so a second
    // <article> appended to <body> is never read and the guest could not see the codes.
    const article =
      document.querySelector('main article') ??
      document.querySelector('article') ??
      document.querySelector('main') ??
      document.body;
    const heading = article.querySelector('h1') ?? document.createElement('h1');
    heading.textContent = values.title;
    if (!heading.isConnected) article.prepend(heading);
    const opening = document.createElement('p');
    opening.textContent = `Opening check code: ${values.openingCode}`;
    const stages = document.createElement('p');
    stages.textContent = 'Workflow stages: Capture, Understand, Use.';
    const followup = document.createElement('p');
    followup.textContent = `Follow-up check code: ${values.followupCode}`;
    heading.after(opening, stages, followup);
    history.replaceState(null, '', `${location.pathname}#${values.fragment}`);
    return {
      url: location.href,
      title: document.title,
      text: article.innerText,
    };
  }, fixture);
  assert.equal(new URL(installed.url).origin, expectedOrigin);
  assert.equal(new URL(installed.url).pathname, DEMO_PATH);
  assert.equal(new URL(installed.url).hash, `#${fixture.fragment}`);
  assert.equal(installed.title, originalTitle);
  assert.ok(installed.text.includes(fixture.openingCode));
  assert.ok(installed.text.includes(fixture.followupCode));
  assert.ok(REQUIRED_ANSWER_TERMS.every((term) => installed.text.includes(term)));
  // The demo is a hydrating Next.js page: a late client render silently replaces the
  // DOM and erases the codes. Require them to survive before the guest is asked.
  await waitFor(
    'page_fixture_survives_hydration',
    () => page.locator('body').innerText(),
    (body) => body.includes(fixture.openingCode) && body.includes(fixture.followupCode),
    10_000,
  );
  return fixture;
}

async function submitQuestion(panel, question, label) {
  const focused = await evaluate(
    panel,
    `(() => {
      const chat = document.querySelector('button[role="tab"][title="Chat"]');
      const pane = document.getElementById(chat?.getAttribute('aria-controls') ?? '');
      const textarea = pane?.querySelector('textarea');
      textarea?.focus();
      return textarea !== null && document.activeElement === textarea;
    })()`,
  );
  assert.equal(focused, true, `${label} guest Chat composer must focus`);
  await panel.send('Input.insertText', { text: question });
  await waitFor(
    `${label}_send_ready`,
    () => observe(panel),
    (state) => state?.sendEnabled,
    10_000,
  );
  await click(panel, 'title', 'Send');
}

async function requireActiveFixtureTab(attachWorker, page, fixture) {
  const body = await page.locator('body').innerText();
  assert.ok(
    body.includes(fixture.openingCode) && body.includes(fixture.followupCode),
    'page_fixture_lost: the page re-rendered and erased the check codes before send',
  );
  const worker = await attachWorker();
  try {
    const result = await worker.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        (tabs) => resolve(tabs[0]?.url ?? null),
      ))`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(result.result?.value, page.url(), 'the nonce fixture tab must be active at send');
  } finally {
    await worker.detach();
  }
}

function safeFailure(error) {
  const message = error instanceof Error ? error.message : 'unknown_error';
  const reason = message
    .split(/\r?\n/, 1)[0]
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[nonce]')
    .slice(0, 120);
  const code =
    /^([a-z][a-z0-9_]{0,79})(?::|$)/i.exec(message)?.[1] ??
    (error instanceof Error ? error.name : 'error').toLowerCase();
  return { code, reason };
}

async function capture(panel, path) {
  const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
  return path;
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
    extensionDir: EXTENSION_DIR,
    expectedRelease: receipt,
    releaseReceiptPath: RECEIPT,
    ...(receipt.kind === 'local_dev_unpacked' && { localDevReceiptPath: RECEIPT }),
    exercisePanel: async ({ page, panel, artifacts, attachWorker }) => {
      stage = 'fresh_guest';
      const initial = await waitFor(
        'fresh_guest_chat_visible',
        () => observe(panel),
        (state) =>
          state?.guestAccount &&
          state.accessTokenAbsent &&
          state.profileAbsent &&
          state.organizationAbsent &&
          state.chatVisible,
        30_000,
      );
      report.guest = { fresh: true, chat_visible: initial.chatVisible, after_reload: false };

      const web = await page.context().newPage();
      try {
        stage = 'public_demo_page';
        await web.goto(`${WEB_ORIGIN}${DEMO_PATH}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        assert.equal(
          `${new URL(web.url()).origin}${new URL(web.url()).pathname}`,
          `${WEB_ORIGIN}${DEMO_PATH}`,
        );
        await web.waitForLoadState('networkidle', { timeout: 60_000 });
        await waitFor(
          'public_demo_content',
          () => web.locator('body').innerText(),
          (body) => REQUIRED_ANSWER_TERMS.every((term) => body.includes(term)),
          30_000,
        );

        stage = 'page_specific_fixture';
        const fixture = await installPageFixture(web);
        await web.bringToFront();

        stage = 'guest_chat_open';
        await click(panel, 'title', 'Chat');
        const before = await waitFor(
          'guest_chat_composer',
          () => observe(panel),
          (state) => state?.chatSelected && state.paneVisible && state.composerVisible,
          30_000,
        );
        assert.equal(before.replyCount, 0, 'fresh guest must have no prior reply');

        stage = 'guest_question';
        await requireActiveFixtureTab(attachWorker, web, fixture);
        await submitQuestion(panel, FIRST_QUESTION, 'opening_question');

        stage = 'real_guest_answer';
        const answered = await waitFor(
          'real_guest_answer_with_page_nonce',
          () => observe(panel, { nonce: fixture.openingCode }),
          (state) =>
            state?.replyCount > before.replyCount &&
            !state.streaming &&
            state.answerContainsNonce &&
            state.answerMatchesPublicStages &&
            !state.answerIsRefusal &&
            !state.errorNotice,
          180_000,
        );
        report.chat = {
          opening_question_fingerprint: digest(FIRST_QUESTION),
          fixture_fragment_fingerprint: digest(fixture.fragment),
          opening_code_fingerprint: digest(fixture.openingCode),
          completed_reply_count: answered.replyCount,
          answer_contains_unpredictable_page_code: answered.answerContainsNonce,
          answer_names_page_stages: answered.answerMatchesPublicStages,
          no_login_paywall_or_error: !answered.answerIsRefusal && !answered.errorNotice,
          followup_completed_after_reload: false,
        };
        report.screenshot = await capture(panel, join(artifacts, 'guest-chat-real-answer.png'));

        stage = 'real_panel_reload';
        const oldLoader = (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId;
        assert.ok(oldLoader, 'panel loader before reload');
        await panel.send('Page.reload', { ignoreCache: false });
        await waitFor(
          'guest_chat_new_document',
          async () => (await panel.send('Page.getFrameTree'))?.frameTree?.frame?.loaderId,
          (loader) => Boolean(loader && loader !== oldLoader),
          30_000,
        );
        const reloaded = await waitFor(
          'guest_chat_after_reload',
          () => observe(panel),
          (state) =>
            state?.guestAccount &&
            state.accessTokenAbsent &&
            state.profileAbsent &&
            state.organizationAbsent &&
            state.chatVisible,
          30_000,
        );
        report.guest.after_reload = reloaded.chatVisible;
        report.guest.session_absent_after_reload =
          reloaded.accessTokenAbsent && reloaded.profileAbsent && reloaded.organizationAbsent;

        stage = 'guest_followup_composer';
        await click(panel, 'title', 'Chat');
        const beforeFollowup = await waitFor(
          'guest_chat_followup_composer',
          () => observe(panel),
          (state) => state?.chatSelected && state.paneVisible && state.composerVisible,
          30_000,
        );
        stage = 'guest_followup_question';
        await requireActiveFixtureTab(attachWorker, web, fixture);
        await submitQuestion(panel, FOLLOWUP_QUESTION, 'followup_question');

        stage = 'real_guest_followup_answer';
        const followup = await waitFor(
          'real_guest_followup_answer_with_page_nonce',
          () => observe(panel, { nonce: fixture.followupCode, fixtureHeading: fixture.title }),
          (state) =>
            state?.replyCount > beforeFollowup.replyCount &&
            !state.streaming &&
            state.answerContainsNonce &&
            state.answerContainsFixtureHeading &&
            !state.answerIsRefusal &&
            !state.errorNotice,
          180_000,
        );
        report.chat.followup_question_fingerprint = digest(FOLLOWUP_QUESTION);
        report.chat.followup_code_fingerprint = digest(fixture.followupCode);
        report.chat.followup_reply_count = followup.replyCount;
        report.chat.followup_contains_unpredictable_page_code = followup.answerContainsNonce;
        report.chat.followup_names_fixture_heading = followup.answerContainsFixtureHeading;
        report.chat.followup_completed_after_reload = true;
        report.followup_screenshot = await capture(
          panel,
          join(artifacts, 'guest-chat-real-followup-answer.png'),
        );
      } finally {
        await web.close();
      }
    },
  });
  stage = 'artifact_unchanged';
  assert.equal(hashReleaseTree(EXTENSION_DIR), receipt.treeSha256);
  report.build.extension_id = run.extensionId;
  report.build.artifact_unchanged = true;
  report.status = 'pass';
} catch (error) {
  report.failure_stage = stage;
  const failure = safeFailure(error);
  report.failure_code = failure.code;
  report.failure_reason = failure.reason;
}
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} guest_chat_store ${OUTPUT}\n`);
if (report.status !== 'pass') process.exitCode = 1;
