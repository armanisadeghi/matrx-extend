#!/usr/bin/env node
/** Receipt-bound Store screenshot of a real guest answer on the unmodified demo page. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RECEIPT = join(REPO, '.output', 'release-receipt.json');
const OUTPUT = join(REPO, 'test-results', `guest-chat-store-screenshot-${randomUUID()}.json`);
const DEMO = 'https://www.aimatrx.com/matrx-extend-demo';
const QUESTION =
  'What are the three workflow stages shown in the article on my current tab? Answer with just their names in order.';
const STAGES = ['Capture', 'Understand', 'Use'];
let stage = 'receipt';
const report = {
  schema_version: 1,
  scope: 'normal public demo page; real signed-out Chat answer; panel-only Store candidate',
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
      const answer = replies.at(-1) ?? '';
      return chrome.storage.local.get([
        'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.org.active',
      ]).then((stored) => ({
        guestAccount: visible(document.querySelector('button[title="Account"]')),
        noSession: !stored['matrx.auth.accessToken'] && !stored['matrx.user.profile'] &&
          !stored['matrx.org.active'],
        chatVisible: visible(chat),
        chatSelected: chat?.getAttribute('aria-selected') === 'true',
        composerVisible: active && visible(pane.querySelector('textarea')),
        sendEnabled: active && [...pane.querySelectorAll('button[title="Send"]')]
          .some((button) => visible(button) && !button.disabled),
        streaming: active && Boolean(pane.querySelector('button[title="Stop"]')),
        replyCount: replies.length,
        stagesInOrder: /Capture[\\s\\S]*Understand[\\s\\S]*Use/.test(answer),
        refusal: /(?:sign.?in|log.?in|authentication required|upgrade|subscribe|payment required|unauthori[sz]ed|forbidden|\\b401\\b|\\b403\\b)/i.test(answer),
        error: /^\\s*Error\\s*:/i.test(answer) || Boolean(active && pane.querySelector('[role="alert"]')),
      }));
    })()`,
  );
}

async function assertDemoTabActive(attachWorker, page) {
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
    assert.equal(result.result?.value, page.url());
  } finally {
    await worker.detach();
  }
}

async function captureStoreCandidate(panel, artifacts) {
  await panel.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 400,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(data, 'base64');
    assert.equal(png.readUInt32BE(16), 640);
    assert.equal(png.readUInt32BE(20), 400);
    const file = join(artifacts, 'guest-chat-store-640x400.png');
    await writeFile(file, png, { mode: 0o600 });
    return file;
  } finally {
    await panel.send('Emulation.clearDeviceMetricsOverride');
  }
}

try {
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  report.build = { version: receipt.version, tree_sha256: receipt.treeSha256 };
  stage = 'owned_guest_profile';
  const run = await runNativeSidepanelQa({
    expectedRelease: receipt,
    releaseReceiptPath: RECEIPT,
    exercisePanel: async ({ page, panel, artifacts, attachWorker }) => {
      const initial = await waitFor(
        'signed_out_chat_available',
        () => observe(panel),
        (state) => state?.guestAccount && state.noSession && state.chatVisible,
        30_000,
      );
      report.guest = { fresh: initial.guestAccount, no_session: initial.noSession };
      const web = await page.context().newPage();
      try {
        stage = 'normal_public_demo_page';
        await web.goto(DEMO, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        assert.equal(web.url(), DEMO);
        await waitFor(
          'demo_article_loaded',
          () => web.locator('main[data-public-main="true"] article').innerText(),
          (text) => STAGES.every((term) => text.includes(term)),
          30_000,
        );
        await web.bringToFront();
        await assertDemoTabActive(attachWorker, web);

        stage = 'guest_chat_question';
        await click(panel, 'title', 'Chat');
        const before = await waitFor(
          'guest_chat_composer',
          () => observe(panel),
          (state) => state?.chatSelected && state.composerVisible,
          30_000,
        );
        assert.equal(before.replyCount, 0);
        assert.equal(
          await evaluate(
            panel,
            `(() => { const area = document.querySelector('textarea'); area?.focus(); return document.activeElement === area; })()`,
          ),
          true,
        );
        await panel.send('Input.insertText', { text: QUESTION });
        await waitFor(
          'guest_send_ready',
          () => observe(panel),
          (state) => state?.sendEnabled,
          10_000,
        );
        await assertDemoTabActive(attachWorker, web);
        await click(panel, 'title', 'Send');

        stage = 'real_guest_answer';
        const answered = await waitFor(
          'completed_guest_answer',
          () => observe(panel),
          (state) => state?.replyCount > before.replyCount && !state.streaming,
          180_000,
        );
        assert.equal(answered.stagesInOrder, true);
        assert.equal(answered.refusal, false);
        assert.equal(answered.error, false);
        report.chat = {
          completed_real_answer: true,
          answer_names_stages_in_order: true,
          no_account_or_payment_gate: true,
          demo_route: DEMO,
        };

        stage = 'capture_store_candidate';
        report.screenshot = await captureStoreCandidate(panel, artifacts);
      } finally {
        await web.close();
      }
    },
  });
  report.build.extension_id = run.extensionId;
  report.status = 'pass';
} catch (error) {
  report.failure_stage = stage;
  report.failure_code = error instanceof Error ? error.message.split(':', 1)[0] : 'unknown';
}
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} guest_chat_store_screenshot ${OUTPUT}\n`);
if (report.status !== 'pass') process.exitCode = 1;
