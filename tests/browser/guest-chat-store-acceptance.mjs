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
const QUESTION = 'What are the three workflow stages on this page?';
const REQUIRED_ANSWER_TERMS = ['Capture', 'Understand', 'Use'];
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

let stage = 'receipt';
const report = {
  schema_version: 1,
  scope: 'fresh owned guest profile; public demo page; real native Chat answer and reload',
  status: 'unverified',
  build: null,
  guest: null,
  chat: null,
  screenshot: null,
  failure_stage: null,
};

async function observe(panel) {
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
        answerMatchesPublicPage: ${JSON.stringify(REQUIRED_ANSWER_TERMS)}
          .every((term) => latestReply.includes(term)),
        answerIsRefusal: /(?:sign in|log in|upgrade|subscribe|payment required|unauthorized|forbidden)/i
          .test(latestReply),
        errorNotice: active && Boolean(pane.querySelector('[role="alert"]')),
      }));
    })()`,
  );
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
    exercisePanel: async ({ page, panel, artifacts }) => {
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
        const location = new URL(web.url());
        assert.equal(`${location.origin}${location.pathname}`, `${WEB_ORIGIN}${DEMO_PATH}`);
        await waitFor(
          'public_demo_content',
          () => web.locator('body').innerText(),
          (body) => REQUIRED_ANSWER_TERMS.every((term) => body.includes(term)),
          30_000,
        );

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
        assert.equal(focused, true, 'guest Chat composer must focus');
        await panel.send('Input.insertText', { text: QUESTION });
        await waitFor(
          'guest_send_ready',
          () => observe(panel),
          (state) => state?.sendEnabled,
          10_000,
        );
        await click(panel, 'title', 'Send');

        stage = 'real_guest_answer';
        const answered = await waitFor(
          'real_guest_answer_from_public_page',
          () => observe(panel),
          (state) =>
            state?.replyCount > before.replyCount &&
            !state.streaming &&
            state.answerMatchesPublicPage &&
            !state.answerIsRefusal &&
            !state.errorNotice,
          180_000,
        );
        report.chat = {
          question_fingerprint: digest(QUESTION),
          demo_route: `${WEB_ORIGIN}${DEMO_PATH}`,
          completed_reply_count: answered.replyCount,
          answer_names_public_stages: answered.answerMatchesPublicPage,
          no_login_paywall_or_error: !answered.answerIsRefusal && !answered.errorNotice,
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
} catch {
  report.failure_stage = stage;
}
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} guest_chat_store ${OUTPUT}\n`);
if (report.status !== 'pass') process.exitCode = 1;
