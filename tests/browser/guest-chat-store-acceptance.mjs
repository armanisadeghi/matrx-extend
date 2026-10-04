#!/usr/bin/env node
/** Real guest Chat acceptance in a fresh, receipt-bound native side panel. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashReleaseTree } from '../../scripts/sync-unpacked-release.mjs';
import { classifyGuestTurn, createGuestStreamCollector } from './guest-chat-completion-oracle.mjs';
import { requireGuestTransport, watchGuestAiRequests } from './guest-chat-transport-observer.mjs';
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
const FIRST_QUESTION =
  'Read the unique opening check code from the article on my current tab. What are the three workflow stages in order? Include the exact code.';
const FOLLOWUP_QUESTION =
  'Read the unique follow-up check code from the article on my current tab and name the heading directly above the check codes. Include the exact code.';
const REQUIRED_ANSWER_TERMS = ['Capture', 'Understand', 'Use'];
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

async function fileInventory(root) {
  const files = new Map();
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolutePath);
        files.set(relativePath, {
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } else {
        throw new Error(`artifact_inventory_non_file:${relativePath}`);
      }
    }
  }
  await walk(root);
  return files;
}

function changedFiles(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
    .map((path) => ({ path, before: before.get(path) ?? null, after: after.get(path) ?? null }));
}

let stage = 'receipt';
const report = {
  schema_version: 1,
  scope:
    'fresh owned guest profile; unpredictable article fixture in the owned browser tab; real Chat answer and post-reload guest follow-up',
  context_rule_read_observation_scope:
    'CDP observer attaches after panel load and runs through Values chip open, both guest sends, and panel reload; it cannot establish requests before attachment',
  status: 'unverified',
  build: null,
  guest: null,
  chat: null,
  screenshot: null,
  followup_screenshot: null,
  failure_stage: null,
  failure_code: null,
  failure_reason: null,
  stage_progress: [],
  guest_ai_requests: [],
  guest_ai_observer: null,
  guest_ai_transport_proven: false,
  context_rule_reads: [],
  grounding_diagnostics: {},
};

function markStage(next) {
  stage = next;
  report.stage_progress.push(next);
  process.stdout.write(`STAGE ${next}\n`);
}

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
        .map((button) => [...(button.closest('div.group.space-y-2')
          ?.querySelectorAll(':scope > div.min-w-0.text-foreground') ?? [])]
          .map((part) => part.innerText ?? '').join('\\n')) : [];
      const latestReply = replies.at(-1) ?? '';
      const visibleAlerts = active
        ? [...pane.querySelectorAll('[role="alert"]')].filter(visible)
          .map((element) => element.innerText ?? '')
        : [];
      const interruptionNotice = active && [...pane.querySelectorAll('button,[role="status"],[role="alert"]')]
        .filter(visible)
        .some((element) => /(?:interruption|interrupted|retry)/i.test(element.innerText ?? ''));
      const textarea = active ? pane.querySelector('textarea') : null;
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
        streamTrace: window.__guestChatStreamTrace?.snapshot() ?? null,
        replyCount: replies.length,
        answerContainsNonce: Boolean(${JSON.stringify(expected.nonce ?? null)}) &&
          latestReply.includes(${JSON.stringify(expected.nonce ?? '')}),
        answerContainsFixtureHeading: Boolean(${JSON.stringify(expected.fixtureHeading ?? null)}) &&
          latestReply.includes(${JSON.stringify(expected.fixtureHeading ?? '')}),
        answerMatchesPublicStages: ${JSON.stringify(REQUIRED_ANSWER_TERMS)}
          .every((term) => latestReply.includes(term)),
        answerStagesInOrder: ${JSON.stringify(REQUIRED_ANSWER_TERMS)}
          .every((term, index, terms) => index === 0 ||
            latestReply.indexOf(terms[index - 1]) < latestReply.indexOf(term)),
        answerIsRefusal: /(?:authentication (?:is )?required|you (?:must|need to) (?:sign.?in|log.?in|authenticate)|(?:sign.?in|log.?in) (?:to|before) (?:use|ask|send|continue)|upgrade|subscribe|payment required|unauthori[sz]ed|forbidden|\\b401\\b|\\b403\\b)/i
          .test(latestReply),
        terminalAnswerError: /^\s*Error\s*:/i.test(latestReply),
        interruptionNotice,
        errorNotice: active && (Boolean(pane.querySelector('[role="alert"]')) || interruptionNotice),
        ...( ${JSON.stringify(expected.diagnostics === true)} && {
          latestReplyText: latestReply,
          visibleAlertTexts: visibleAlerts,
          composerLength: textarea?.value?.length ?? 0,
        }),
      }));
    })()`,
  );
}

async function installStreamTrace(panel, fixture, fixtureTabId) {
  const installed = await evaluate(
    panel,
    `(() => {
    window.__guestChatStreamTrace?.stop();
    const makeCollector = (${createGuestStreamCollector.toString()});
    const collector = makeCollector({
      replyCount: () => document.querySelectorAll('button[title="Copy reply"]').length,
      now: Date.now,
      markers: ${JSON.stringify([fixture.openingCode, fixture.followupCode, fixture.title])},
      fixtureTabId: ${JSON.stringify(fixtureTabId)},
      fixtureUrl: ${JSON.stringify(fixture.url)},
    });
    const listener = (message) => collector.accept(message);
    chrome.runtime.onMessage.addListener(listener);
    window.__guestChatStreamTrace = {
      snapshot: () => collector.snapshot(),
      runIds: () => collector.runIds(),
      stop: () => chrome.runtime.onMessage.removeListener(listener),
    };
    return true;
  })()`,
  );
  assert.equal(installed, true, 'guest stream trace installed before send');
}

async function waitForTerminalAnswer(panel, expected, probeToolBoundary = null) {
  let last = null;
  const timeline = [];
  const toolBoundaryChecks = [];
  let observedToolEvents = 0;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await observe(panel, { ...expected, diagnostics: true });
    const toolEvents = state.streamTrace?.toolEvents ?? [];
    while (observedToolEvents < toolEvents.length) {
      const event = toolEvents[observedToolEvents];
      observedToolEvents += 1;
      if (probeToolBoundary) {
        toolBoundaryChecks.push({
          eventIndex: observedToolEvents,
          toolName: event.name,
          phase: event.phase,
          ...(await probeToolBoundary()),
        });
      }
    }
    const answerTerms = expected.fixtureHeading
      ? [expected.nonce, expected.fixtureHeading]
      : [expected.nonce, ...REQUIRED_ANSWER_TERMS];
    const verdict = classifyGuestTurn({
      runs: state.streamTrace?.runs ?? [],
      assistantText: state.latestReplyText ?? '',
      replyCount: state.replyCount,
      expectedTerms: answerTerms,
      orderedTerms: expected.fixtureHeading ? [] : REQUIRED_ANSWER_TERMS,
      errorNotice: state.errorNotice,
      terminalAnswerError: state.terminalAnswerError,
    });
    const previous = timeline.at(-1);
    if (
      !previous ||
      previous.verdict !== verdict ||
      previous.runCount !== state.streamTrace?.runs.length
    ) {
      timeline.push({
        verdict,
        runCount: state.streamTrace?.runs.length ?? 0,
        replyCount: state.replyCount,
        streaming: state.streaming,
      });
    }
    last = { state, verdict, timeline, toolBoundaryChecks };
    if (verdict.startsWith('terminal_')) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return { ...last, verdict: 'terminal_not_observed' };
}

async function watchGuestContextRuleReads(panel) {
  await panel.send('Network.enable');
  let stage = 'observer_attached';
  const requests = new Map();
  const path = '/rest/v1/user_surface_state';
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      if (!url.pathname.endsWith(path)) return;
      const headers = request?.headers ?? {};
      const authorization = Object.keys(headers).find(
        (key) => key.toLowerCase() === 'authorization',
      );
      const profile = Object.keys(headers).find((key) => key.toLowerCase() === 'accept-profile');
      requests.set(requestId, {
        stage,
        method: typeof request?.method === 'string' ? request.method : 'unknown',
        usersSchema:
          typeof profile === 'string' && String(headers[profile]).toLowerCase() === 'users',
        authorizationPresent: Boolean(authorization && headers[authorization]),
        status: null,
      });
    } catch {
      // Keep only safe, classified metadata for the one owner-only table.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) request.status = Number.isFinite(response?.status) ? response.status : null;
  });
  return {
    arm(next) {
      stage = next;
    },
    snapshot() {
      return [...requests.values()].map((request) => ({ ...request }));
    },
    stop() {
      offRequest();
      offResponse();
    },
  };
}

async function openAndCloseGuestValuesChip(panel) {
  const readChip = () =>
    evaluate(
      panel,
      `(() => {
    const chat = document.querySelector('button[role="tab"][title="Chat"][aria-selected="true"]');
    const pane = chat ? document.getElementById(chat.getAttribute('aria-controls') ?? '') : null;
    const matches = [...(pane?.querySelectorAll('button[aria-label]') ?? [])]
      .filter((button) => /^[0-9]+ included$/.test(button.getAttribute('aria-label') ?? ''));
    return matches.length === 1 ? {
      count: 1,
      expanded: matches[0].getAttribute('aria-expanded'),
    } : { count: matches.length, expanded: null };
  })()`,
    );
  assert.equal((await readChip())?.count, 1, 'guest Values chip must be uniquely present');
  await click(panel, 'context-values', '');
  await waitFor('guest_values_chip_open', readChip, (state) => state?.expanded === 'true');
  await click(panel, 'context-values', '');
  await waitFor('guest_values_chip_closed', readChip, (state) => state?.expanded === 'false');
}

async function installPageFixture(page, existingFixture = null) {
  const originalUrl = new URL(page.url());
  const originalTitle = await page.title();
  const fixture = existingFixture ?? {
    fragment: `guest-chat-${randomUUID()}`,
    title: `Matrx guest Chat grounding fixture ${randomUUID()}`,
    openingCode: randomUUID().toUpperCase(),
    followupCode: randomUUID().toUpperCase(),
  };
  const installed = await page.evaluate((values) => {
    const article = document.querySelector('main article');
    const articleHeader = article?.querySelector(':scope > header');
    if (!article) {
      throw new Error('the owned tab primary article is missing');
    }
    article.querySelector('[data-guest-chat-fixture]')?.remove();
    // get_page_text prefers <main> and removes headers before reading it.
    // Put the unpredictable fixture in the article's readable body, ahead of
    // the real workflow section, rather than appending a second body article.
    const fixtureSection = document.createElement('section');
    fixtureSection.setAttribute('data-guest-chat-fixture', '');
    const heading = document.createElement('h2');
    heading.textContent = values.title;
    const opening = document.createElement('p');
    opening.textContent = `Opening check code: ${values.openingCode}`;
    const stages = document.createElement('p');
    stages.textContent = 'Workflow stages: Capture, Understand, Use.';
    const followup = document.createElement('p');
    followup.textContent = `Follow-up check code: ${values.followupCode}`;
    fixtureSection.append(heading, opening, stages, followup);
    if (articleHeader) articleHeader.after(fixtureSection);
    else article.prepend(fixtureSection);
    history.replaceState(null, '', `${location.pathname}#${values.fragment}`);
    const style = getComputedStyle(fixtureSection);
    const rect = fixtureSection.getBoundingClientRect();
    const readerRoot = document.querySelector('main, article, [role="main"]');
    const readerClone = readerRoot?.cloneNode(true);
    for (const element of readerClone?.querySelectorAll(
      'nav, aside, header, footer, script, style, noscript, [aria-hidden="true"], [hidden]',
    ) ?? []) {
      element.remove();
    }
    return {
      url: location.href,
      title: document.title,
      text: fixtureSection.innerText,
      inPrimaryArticle: article.contains(fixtureSection),
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden',
      readerText: readerClone?.textContent ?? '',
    };
  }, fixture);
  assert.equal(new URL(installed.url).origin, originalUrl.origin);
  assert.equal(new URL(installed.url).pathname, originalUrl.pathname);
  assert.equal(new URL(installed.url).hash, `#${fixture.fragment}`);
  assert.equal(installed.title, originalTitle);
  assert.equal(installed.inPrimaryArticle, true);
  assert.equal(installed.visible, true);
  assert.ok(installed.text.includes(fixture.openingCode));
  assert.ok(installed.text.includes(fixture.followupCode));
  assert.ok(REQUIRED_ANSWER_TERMS.every((term) => installed.text.includes(term)));
  assert.ok(installed.readerText.includes(fixture.title));
  assert.ok(installed.readerText.includes(fixture.openingCode));
  assert.ok(installed.readerText.includes(fixture.followupCode));
  fixture.url = installed.url;
  return fixture;
}

async function readableFixturePresent(page, fixture) {
  return page.evaluate((values) => {
    const section = document.querySelector('main article [data-guest-chat-fixture]');
    const style = section ? getComputedStyle(section) : null;
    const rect = section?.getBoundingClientRect();
    const clone = document.querySelector('main, article, [role="main"]')?.cloneNode(true);
    for (const element of clone?.querySelectorAll(
      'nav, aside, header, footer, script, style, noscript, [aria-hidden="true"], [hidden]',
    ) ?? []) {
      element.remove();
    }
    const readable = clone?.textContent ?? '';
    return Boolean(
      section &&
        rect?.width > 0 &&
        rect.height > 0 &&
        style?.display !== 'none' &&
        style.visibility !== 'hidden' &&
        readable.includes(values.title) &&
        readable.includes(values.openingCode) &&
        readable.includes(values.followupCode),
    );
  }, fixture);
}

async function fixtureIdentitySnapshot(attachWorker, page, fixture, fixtureTabId, panel = null) {
  const readable = await readableFixturePresent(page, fixture).catch(() => false);
  const pageUrlMatches = page.url() === fixture.url;
  const base = { readableMarkerPresent: readable, pageUrlMatches };
  let worker = null;
  try {
    worker = await attachWorker();
    const response = await worker.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        (tabs) => resolve({ id: tabs[0]?.id ?? null, url: tabs[0]?.url ?? null }),
      ))`,
      awaitPromise: true,
      returnByValue: true,
    });
    const active = response.result?.value ?? {};
    let assignedTabMatchesFixture = null;
    if (panel) {
      const runIds = await evaluate(panel, 'window.__guestChatStreamTrace?.runIds() ?? []');
      const assignment = await worker.send('Runtime.evaluate', {
        expression: `chrome.storage.session.get('matrx.dispatch.runs').then((values) => {
          const rows = values['matrx.dispatch.runs'] ?? {};
          const ids = ${JSON.stringify(runIds)};
          return ids.map((id) => rows[id]?.assignedTabId ?? null);
        })`,
        awaitPromise: true,
        returnByValue: true,
      });
      const assignedIds = assignment.result?.value;
      assignedTabMatchesFixture =
        Array.isArray(assignedIds) && assignedIds.length > 0
          ? assignedIds.every((id) => id === fixtureTabId)
          : null;
    }
    return {
      ...base,
      activeTabMatchesFixture: active.id === fixtureTabId,
      activeUrlMatchesFixture: active.url === fixture.url,
      assignedTabMatchesFixture,
    };
  } catch {
    return {
      ...base,
      activeTabMatchesFixture: null,
      activeUrlMatchesFixture: null,
      assignedTabMatchesFixture: null,
      identityProbeAvailable: false,
    };
  } finally {
    await worker?.detach().catch(() => {});
  }
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
        (tabs) => resolve({ id: tabs[0]?.id ?? null, url: tabs[0]?.url ?? null }),
      ))`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(
      result.result?.value?.url,
      page.url(),
      'the nonce fixture tab must be active at send',
    );
    assert.ok(Number.isInteger(result.result?.value?.id), 'fixture tab id must exist');
    return result.result.value.id;
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

function safeVisibleText(value, fixture) {
  let text = String(value ?? '');
  for (const [raw, marker] of [
    [fixture?.openingCode, '[opening-code]'],
    [fixture?.followupCode, '[follow-up-code]'],
    [fixture?.title, '[fixture-heading]'],
  ]) {
    if (raw) text = text.split(raw).join(marker);
  }
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:authorization|access[_ -]?token|password|secret)\b\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .slice(0, 1200);
}

function diagnosticState(state, fixture) {
  if (!state) return null;
  return {
    guestAccount: state.guestAccount,
    accessTokenAbsent: state.accessTokenAbsent,
    profileAbsent: state.profileAbsent,
    organizationAbsent: state.organizationAbsent,
    chatVisible: state.chatVisible,
    chatSelected: state.chatSelected,
    paneVisible: state.paneVisible,
    composerVisible: state.composerVisible,
    composerLength: state.composerLength,
    sendEnabled: state.sendEnabled,
    streaming: state.streaming,
    replyCount: state.replyCount,
    answerContainsNonce: state.answerContainsNonce,
    answerContainsFixtureHeading: state.answerContainsFixtureHeading,
    answerMatchesPublicStages: state.answerMatchesPublicStages,
    answerStagesInOrder: state.answerStagesInOrder,
    answerIsRefusal: state.answerIsRefusal,
    terminalAnswerError: state.terminalAnswerError,
    interruptionNotice: state.interruptionNotice,
    errorNotice: state.errorNotice,
    latestAssistantReply: safeVisibleText(state.latestReplyText, fixture),
    visibleAlerts: (state.visibleAlertTexts ?? []).map((text) => safeVisibleText(text, fixture)),
    streamTrace: state.streamTrace,
  };
}

async function capture(panel, path) {
  const { data } = await panel.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
  return path;
}

try {
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  const beforeFiles = await fileInventory(EXTENSION_DIR);
  assert.equal(hashReleaseTree(EXTENSION_DIR), receipt.treeSha256, 'loaded extension initial tree');
  report.build = {
    version: receipt.version,
    tree_sha256: receipt.treeSha256,
    receipt_kind: receipt.kind ?? 'release',
  };
  markStage('owned_profile');
  const run = await runNativeSidepanelQa({
    extensionDir: EXTENSION_DIR,
    expectedRelease: receipt,
    releaseReceiptPath: RECEIPT,
    ...(receipt.kind === 'published_store_crx_unpacked' && {
      expectedExtensionId: receipt.extensionId,
      publicDemoUrl: 'https://www.aimatrx.com/matrx-extend-demo',
    }),
    ...(receipt.kind === 'local_dev_unpacked' && { localDevReceiptPath: RECEIPT }),
    exercisePanel: async ({
      page,
      panel,
      panelTarget,
      browserSession,
      artifacts,
      attachWorker,
      attachOffscreen,
    }) => {
      const contextReadWatch = await watchGuestContextRuleReads(panel);
      contextReadWatch.arm('observer_attached');
      markStage('fresh_guest');
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

      const web = page;
      let fixture = null;
      let networkWatch = null;
      let primaryError = null;
      const cleanupErrors = [];
      try {
        markStage('owned_article_page');
        assert.equal(
          new URL(web.url()).hostname,
          receipt.kind === 'published_store_crx_unpacked' ? 'www.aimatrx.com' : 'localhost',
        );
        await waitFor(
          'owned_article_content',
          () => web.locator('main article').count(),
          (count) => count === 1,
          10_000,
        );

        markStage('page_specific_fixture');
        fixture = await installPageFixture(web);
        await web.bringToFront();
        await requireActiveFixtureTab(attachWorker, web, fixture);

        markStage('guest_chat_open');
        contextReadWatch.arm('chat_open');
        await click(panel, 'title', 'Chat');
        const before = await waitFor(
          'guest_chat_composer',
          () => observe(panel),
          (state) => state?.chatSelected && state.paneVisible && state.composerVisible,
          30_000,
        );
        assert.equal(before.replyCount, 0, 'fresh guest must have no prior reply');

        markStage('guest_values_chip_open');
        contextReadWatch.arm('chip_open');
        await openAndCloseGuestValuesChip(panel);
        report.context_rule_reads = contextReadWatch.snapshot();

        markStage('guest_question');
        networkWatch = await watchGuestAiRequests({ browserSession, attachOffscreen, panelTarget });
        const fixtureSurvivedOpen = await readableFixturePresent(web, fixture);
        if (!fixtureSurvivedOpen) {
          await installPageFixture(web, fixture);
        }
        report.guest.fixture_reinstalled_before_first_send = !fixtureSurvivedOpen;
        assert.equal(
          await readableFixturePresent(web, fixture),
          true,
          'opening fixture must remain in the primary readable article before send',
        );
        const fixtureTabId = await requireActiveFixtureTab(attachWorker, web, fixture);
        report.grounding_diagnostics.before_first_send = await fixtureIdentitySnapshot(
          attachWorker,
          web,
          fixture,
          fixtureTabId,
        );
        await installStreamTrace(panel, fixture, fixtureTabId);
        networkWatch.arm('opening');
        contextReadWatch.arm('opening_send');
        await submitQuestion(panel, FIRST_QUESTION, 'opening_question');

        markStage('real_guest_answer');
        const openingTurn = await waitForTerminalAnswer(panel, { nonce: fixture.openingCode }, () =>
          fixtureIdentitySnapshot(attachWorker, web, fixture, fixtureTabId),
        );
        report.grounding_diagnostics.opening = {
          toolEvents: openingTurn.state.streamTrace?.toolEvents ?? [],
          toolBoundaryChecks: openingTurn.toolBoundaryChecks,
          terminal: await fixtureIdentitySnapshot(attachWorker, web, fixture, fixtureTabId, panel),
        };
        const answered = openingTurn.state;
        report.opening_turn_verdict = openingTurn.verdict;
        report.opening_turn_timeline = openingTurn.timeline;
        report.failure_observation = diagnosticState(answered, fixture);
        await networkWatch.settle();
        report.guest_ai_observer = await networkWatch.diagnostics();
        report.guest_ai_requests = networkWatch.snapshot();
        requireGuestTransport(report.guest_ai_requests, 'opening');
        report.context_rule_reads = contextReadWatch.snapshot();
        assert.ok(
          openingTurn.verdict === 'terminal_answer' &&
            answered.answerContainsNonce &&
            answered.answerMatchesPublicStages &&
            answered.answerStagesInOrder &&
            !answered.answerIsRefusal &&
            !answered.terminalAnswerError &&
            !answered.errorNotice,
          'real guest answer must contain the page-specific code and workflow stages',
        );
        report.chat = {
          opening_question_fingerprint: digest(FIRST_QUESTION),
          fixture_fragment_fingerprint: digest(fixture.fragment),
          opening_code_fingerprint: digest(fixture.openingCode),
          completed_reply_count: answered.replyCount,
          answer_contains_unpredictable_page_code: answered.answerContainsNonce,
          answer_names_page_stages: answered.answerMatchesPublicStages,
          answer_stages_in_order: answered.answerStagesInOrder,
          no_login_paywall_or_error:
            !answered.answerIsRefusal && !answered.terminalAnswerError && !answered.errorNotice,
          followup_completed_after_reload: false,
        };
        report.screenshot = await capture(panel, join(artifacts, 'guest-chat-real-answer.png'));

        markStage('real_panel_reload');
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

        markStage('guest_followup_composer');
        await click(panel, 'title', 'Chat');
        await waitFor(
          'guest_chat_followup_composer',
          () => observe(panel),
          (state) => state?.chatSelected && state.paneVisible && state.composerVisible,
          30_000,
        );
        markStage('guest_followup_question');
        networkWatch.arm('post_reload_new_conversation');
        contextReadWatch.arm('post_reload_send');
        const fixtureSurvivedReload = await readableFixturePresent(web, fixture);
        if (!fixtureSurvivedReload) {
          await installPageFixture(web, fixture);
        }
        report.guest.fixture_reinstalled_after_reload = !fixtureSurvivedReload;
        assert.equal(
          await readableFixturePresent(web, fixture),
          true,
          'follow-up fixture must remain in the primary readable article before send',
        );
        const followupFixtureTabId = await requireActiveFixtureTab(attachWorker, web, fixture);
        report.grounding_diagnostics.before_followup_send = await fixtureIdentitySnapshot(
          attachWorker,
          web,
          fixture,
          followupFixtureTabId,
        );
        await installStreamTrace(panel, fixture, followupFixtureTabId);
        await submitQuestion(panel, FOLLOWUP_QUESTION, 'followup_question');

        markStage('real_guest_followup_answer');
        const followupTurn = await waitForTerminalAnswer(
          panel,
          { nonce: fixture.followupCode, fixtureHeading: fixture.title },
          () => fixtureIdentitySnapshot(attachWorker, web, fixture, followupFixtureTabId),
        );
        report.grounding_diagnostics.followup = {
          toolEvents: followupTurn.state.streamTrace?.toolEvents ?? [],
          toolBoundaryChecks: followupTurn.toolBoundaryChecks,
          terminal: await fixtureIdentitySnapshot(
            attachWorker,
            web,
            fixture,
            followupFixtureTabId,
            panel,
          ),
        };
        const followup = followupTurn.state;
        report.followup_turn_verdict = followupTurn.verdict;
        report.followup_turn_timeline = followupTurn.timeline;
        report.failure_observation = diagnosticState(followup, fixture);
        await networkWatch.settle();
        report.guest_ai_observer = await networkWatch.diagnostics();
        report.guest_ai_requests = networkWatch.snapshot();
        requireGuestTransport(report.guest_ai_requests, 'post_reload_new_conversation');
        report.context_rule_reads = contextReadWatch.snapshot();
        assert.ok(
          followupTurn.verdict === 'terminal_answer' &&
            followup.answerContainsNonce &&
            followup.answerContainsFixtureHeading &&
            !followup.answerIsRefusal &&
            !followup.terminalAnswerError &&
            !followup.errorNotice,
          'new guest conversation after reload must ground in the page fixture',
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
        report.context_rule_reads = contextReadWatch.snapshot();
        assert.equal(
          report.context_rule_reads.some((request) => request.method === 'GET'),
          false,
          'guest panel, Values chip, opening send, and post-reload send must not issue an owner-table GET',
        );
        report.guest_ai_transport_proven = true;
      } catch (error) {
        primaryError = error;
        report.failure_stage = stage;
        const failure = safeFailure(error);
        report.failure_code = failure.code;
        report.failure_reason = failure.reason;
        report.failure_observation = diagnosticState(
          await observe(panel, {
            nonce: fixture?.openingCode,
            fixtureHeading: fixture?.title,
            diagnostics: true,
          }).catch(() => null),
          fixture,
        );
        report.guest_ai_observer = (await networkWatch?.diagnostics()) ?? null;
        report.guest_ai_requests = networkWatch?.snapshot() ?? [];
        try {
          report.failure_screenshot = await capture(
            panel,
            join(artifacts, 'guest-chat-failure.png'),
          );
        } catch {
          report.failure_screenshot = 'capture_failed';
        }
      } finally {
        report.context_rule_reads = contextReadWatch?.snapshot() ?? [];
        contextReadWatch?.stop();
        try {
          await networkWatch?.stop();
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          await web.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (cleanupErrors.length > 0) {
          report.cleanup_failure_codes = cleanupErrors.map((error) => safeFailure(error).code);
        }
      }
      if (primaryError) throw primaryError;
      if (cleanupErrors.length > 0) throw cleanupErrors[0];
    },
  });
  markStage('artifact_unchanged');
  const afterTreeSha256 = hashReleaseTree(EXTENSION_DIR);
  if (afterTreeSha256 !== receipt.treeSha256) {
    const afterFiles = await fileInventory(EXTENSION_DIR);
    report.build.integrity_failure = {
      expected_tree_sha256: receipt.treeSha256,
      actual_tree_sha256: afterTreeSha256,
      before_file_count: beforeFiles.size,
      after_file_count: afterFiles.size,
      changed_files: changedFiles(beforeFiles, afterFiles),
    };
  }
  assert.equal(afterTreeSha256, receipt.treeSha256, 'loaded extension tree changed');
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
