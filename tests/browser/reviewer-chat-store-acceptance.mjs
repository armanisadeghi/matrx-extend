#!/usr/bin/env node
/**
 * Receipt-bound Store reviewer acceptance for signed-in, non-admin Chat.
 * Credentials are read only at the web form; evidence contains fixed booleans,
 * hashes, and panel-only screenshots—never auth-form screenshots or values.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImportedNativeEvidence } from '../../scripts/current-test-artifact.mjs';
import { watchGuestAiRequests } from './guest-chat-transport-observer.mjs';
import {
  authenticatedWebIdentity,
  observeCanonicalAdminCheck,
  supabaseOrigin,
} from './member-native-auth-proof.mjs';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { storageShapeExpression } from './reviewer-chat-storage-shape.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = resolve(
  process.env.MATRX_REVIEWER_REPORT ??
    join(REPO, 'test-results', `reviewer-chat-store-${randomUUID()}.json`),
);
// Opt-in real admin approval acceptance; the default remains the non-admin Store case.
const UNINTERRUPTED = process.env.MATRX_REVIEWER_UNINTERRUPTED === '1';
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
const SAFE_FAILURE_CODES = new Set([
  'native_sidepanel_release_receipt_missing',
  'native_sidepanel_release_receipt_refused',
  'native_sidepanel_override_provenance_refused',
  'native_sidepanel_local_build_receipt_missing',
  'native_sidepanel_local_build_provenance_refused',
  'approval_action_completion_not_observed',
]);
const REVIEWER_FINGERPRINT = '3d6137db6c081c07';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let stage = 'not_started';
let approvedOrganization = null;
const report = {
  schema_version: 1,
  scope: UNINTERRUPTED
    ? 'imported CI artifact; real admin sign-in; native Chat approval acceptance'
    : 'fresh owned Chrome-for-Testing profile; real non-admin login; native signed-in Chat',
  status: 'unverified',
  build: null,
  account: null,
  authentication_method: null,
  chat: null,
  screenshots: null,
  ...(UNINTERRUPTED && { approval: { cases: [], limitations: [] } }),
  failure_stage: null,
  failure_code: null,
};

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** The admin lane uses only the previously approved private Files QA fixture. */
async function approvedOrganizationConfig() {
  const path = join(REPO, 'test-results', 'files-saved-private-config.json');
  const metadata = await lstat(path);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    throw new Error('reviewer_approved_organization_config_not_private');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof value.approved_organization_name !== 'string' ||
    !value.approved_organization_name.trim() ||
    !UUID.test(value.approved_organization_id ?? '')
  )
    throw new Error('reviewer_approved_organization_identity_missing');
  return { name: value.approved_organization_name.trim(), id: value.approved_organization_id };
}

// Scope the observer to the same ControlRow used by the native organization driver.
// Organization also contains the archive filter, so its first combobox is unrelated.
function actingOrganizationPickersExpression(section = 'orgSection') {
  return `[...(${section}?.querySelectorAll('span') ?? [])]
    .filter((span) => span.textContent.trim() === 'Acting as')
    .flatMap((span) => [...span.parentElement.parentElement.querySelectorAll('button[role="combobox"]')])`;
}

async function approvedOrganizationObservation(panel) {
  return evaluate(
    panel,
    `(() => chrome.storage.local.get('matrx.org.active').then((stored) => {
      const organization = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Organization');
      const orgSection = organization?.parentElement?.nextElementSibling;
      const pickers = (${actingOrganizationPickersExpression()}).filter((element) => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      const picker = pickers.length === 1 ? pickers[0] : null;
      const active = stored['matrx.org.active'];
      return {
        actingAsPickerCount: pickers.length,
        pickerMatchesApproved: picker?.textContent?.trim() === ${JSON.stringify(approvedOrganization.name)},
        deviceOverridePresent: active !== undefined && active !== null,
        deviceOverrideMatchesApproved: active?.id === ${JSON.stringify(approvedOrganization.id)} && active?.name === ${JSON.stringify(approvedOrganization.name)},
      };
    }))()`,
  );
}

function safeLocation(raw) {
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

async function credentials() {
  if (UNINTERRUPTED && !CREDENTIALS) {
    const source = await readFile(
      process.env.MATRX_REVIEWER_ADMIN_ENV ?? join(homedir(), 'code', 'aidream', '.env'),
      'utf8',
    );
    const value = (key) =>
      source
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${key}=`))
        ?.slice(key.length + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    const email = value('AI_ADMIN_USERNAME');
    const password = value('AI_ADMIN_PASSWORD');
    if (email !== 'admin@admin.com' || !password)
      throw new Error('reviewer_admin_credentials_unavailable');
    return { email, password };
  }
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

async function memberPanelIdentity(panel) {
  return evaluate(
    panel,
    `(() => chrome.storage.local.get([
      'matrx.auth.accessToken', 'matrx.user.profile', 'matrx.user.isAdmin',
    ]).then((stored) => ({
      profileId: stored['matrx.user.profile']?.id ?? null,
      accessTokenPresent: typeof stored['matrx.auth.accessToken'] === 'string',
      isAdmin: stored['matrx.user.isAdmin'] === true ? true : stored['matrx.user.isAdmin'] === false ? false : null,
    })))()`,
  );
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
      const orgPickers = ${actingOrganizationPickersExpression()};
      const orgButton = orgPickers.length === 1 ? orgPickers[0] : null;
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
        actingAsPickerCount: orgPickers.length,
        organizationLoading: orgSection?.textContent?.includes('Loading…') === true,
        chatVisible: [...document.querySelectorAll('button[role="tab"]')]
          .some((button) => button.title === 'Chat' && button.getBoundingClientRect().width > 0),
      };
    })()`,
  );
}

async function storedSessionShape(panel) {
  return evaluate(panel, storageShapeExpression());
}

async function selectReviewerOrganization(panel) {
  const expectedName = UNINTERRUPTED ? approvedOrganization.name : "Matrx's Org";
  await click(panel, 'organization', '');
  const target = await evaluate(
    panel,
    `(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
      const options = [...document.querySelectorAll('[role="option"]')].filter(visible);
      const labels = ${UNINTERRUPTED ? 'null' : 'options.map((option) => option.textContent.trim())'};
      const eligible = options.filter((option) => option.getAttribute('aria-disabled') !== 'true' && !option.disabled && !option.hasAttribute('data-disabled'));
      const matches = eligible.filter((option) => option.textContent.trim() === ${JSON.stringify(expectedName)});
      if (matches.length !== 1) return { labels, optionCount: options.length, eligibleCount: eligible.length, matchedCount: matches.length, target: null };
      if (${UNINTERRUPTED}) return { optionCount: options.length, eligibleCount: eligible.length, matchedCount: 1, target: null };
      const option = matches[0], rect = option.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { labels, optionCount: options.length, eligibleCount: eligible.length, matchedCount: 1, target: hit === option || option.contains(hit), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
  );
  const diagnostics = {
    option_count: target?.optionCount ?? 0,
    eligible_count: target?.eligibleCount ?? 0,
    matched_count: target?.matchedCount ?? 0,
    pointer_target_verified: target?.target === true,
    approved_name_fingerprint: hash(expectedName),
  };
  if (target?.matchedCount !== 1 || (!UNINTERRUPTED && target.target !== true)) {
    const error = new Error('reviewer_organization_option_unavailable');
    error.safeOptions = target?.labels ?? [];
    error.safeSelection = diagnostics;
    throw error;
  }
  if (UNINTERRUPTED) {
    try {
      // The shared driver scrolls and requires a stable point inside every overflow clip.
      await click(panel, 'option', expectedName);
      return { ...diagnostics, pointer_target_verified: true };
    } catch (error) {
      error.safeSelection = diagnostics;
      throw error;
    }
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
  return diagnostics;
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

/** Observe the real canonical admin assignment response, without exporting its body. */
function observeAdminAssignment(panel, origin) {
  const requests = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      const profile = Object.entries(request.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'accept-profile',
      )?.[1];
      const userId = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('user_id') ?? '')?.[1];
      if (
        url.origin === origin &&
        url.pathname === '/rest/v1/admins' &&
        request.method === 'GET' &&
        profile === 'admin' &&
        UUID.test(userId ?? '')
      )
        requests.set(requestId, { userId, status: null, currentUserAssigned: false });
    } catch {
      /* Unrelated request. */
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) request.status = response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const request = requests.get(requestId);
    if (!request) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then((body) => {
        const rows = JSON.parse(
          body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body,
        );
        request.currentUserAssigned =
          Array.isArray(rows) && rows.some((row) => row.user_id === request.userId);
      })
      .catch(() => {});
  });
  return {
    start: () => panel.send('Network.enable'),
    async verify(userId) {
      await waitFor(
        'canonical_admin_assignment',
        () =>
          [...requests.values()].some(
            (request) =>
              request.userId === userId && request.status === 200 && request.currentUserAssigned,
          ),
        Boolean,
        60_000,
      );
      return {
        matched_current_extension_user: true,
        http_status: 200,
        current_user_assigned: true,
      };
    },
    async stop() {
      offRequest();
      offResponse();
      offFinished();
      await panel.send('Network.disable').catch(() => {});
    },
  };
}

function paneExpression(surface = 'Chat') {
  return `(() => { const tab = [...document.querySelectorAll('button[role="tab"]')].find((el) => el.title === ${JSON.stringify(surface)} && el.getAttribute('aria-selected') === 'true'); return tab ? document.getElementById(tab.getAttribute('aria-controls')) : null; })()`;
}

async function approvalObservation(panel, surface = 'Chat') {
  return evaluate(
    panel,
    `(() => {
    const pane = ${paneExpression(surface)}, buttons = [...(pane?.querySelectorAll('button') ?? [])];
    const mode = buttons.find((el) => (el.title || el.getAttribute('data-matrx-title')) === 'Tool permission mode');
    const allow = buttons.filter((el) => el.textContent.trim() === 'Allow');
    const card = allow.length === 1 ? allow[0].parentElement.parentElement : null;
    const remember = card?.querySelector('label input[type="checkbox"]');
    return { ready: Boolean(pane?.querySelector('textarea')), streaming: buttons.some((el) => (el.title || el.getAttribute('data-matrx-title')) === 'Stop'), replies: pane?.querySelectorAll('button[title="Copy reply"], button[data-matrx-title="Copy reply"]').length ?? 0,
      mode: mode?.textContent.trim() ?? null, approvals: allow.length,
      ordinaryCreateTabApproval: card?.textContent.includes('Approve tabs') === true && !card?.textContent.includes('privileged'),
      rememberOffered: Boolean(remember), rememberChecked: remember?.checked === true };
  })()`,
  );
}

/** Trusted pointer to a unique visible UI element; expressions only locate DOM. */
async function pointer(panel, expression) {
  const target = await waitFor(
    'approval_pointer',
    () =>
      evaluate(
        panel,
        `(() => {
    const nodes = (${expression}).filter((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; });
    if (nodes.length !== 1) return null; const el = nodes[0]; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2, hit = document.elementFromPoint(x,y); return hit === el || el.contains(hit) ? {x,y} : null;
  })()`,
      ),
    (value) => Number.isFinite(value?.x),
    10_000,
  );
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

async function permissionMode(panel, mode, surface = 'Chat') {
  const label = mode === 'act' ? 'Act without asking' : 'Ask before acting';
  await pointer(
    panel,
    `[...(${paneExpression(surface)}?.querySelectorAll('button') ?? [])].filter((el) => (el.title || el.getAttribute('data-matrx-title')) === 'Tool permission mode')`,
  );
  await pointer(
    panel,
    `[...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].filter((el) => el.querySelector('.text-sm')?.textContent.trim() === ${JSON.stringify(label)})`,
  );
  await waitFor(
    `${surface}_mode_${mode}`,
    () => approvalObservation(panel, surface),
    (value) => value?.mode === label,
  );
}

/** Passive network evidence: never replace auth, request assembly, stream or dispatch. */
async function observeAuthenticatedTransport(native, expectedUrl, mode) {
  const rows = new Map();
  const pending = new Set();
  let observedTabId = null;
  const prefix = `chrome-extension://${new URL(native.panelTarget.url).hostname}/`;
  const { targetInfos } = await native.browserSession.send('Target.getTargets');
  const workers = targetInfos.filter(
    (target) => target.type === 'service_worker' && target.url.startsWith(prefix),
  );
  assert.equal(workers.length, 1, 'exact current owned extension worker required');
  const { sessionId: workerSession } = await native.browserSession.send('Target.attachToTarget', {
    targetId: workers[0].targetId,
    flatten: true,
  });
  await native.browserSession.send('Network.enable', {}, workerSession);
  const observer = await watchGuestAiRequests(native);
  observer.arm('approval-action');
  const summarize = (entry, source) => {
    try {
      const body = JSON.parse(source);
      if (entry.kind === 'start') {
        entry.conversation = UUID.test(body.conversation_id ?? '')
          ? hash(body.conversation_id)
          : null;
        entry.requestMode = body.client?.state?.['browser-dom']?.permission_mode;
        entry.requestSurface = body.client?.state?.['browser-dom']?.surface;
      } else {
        entry.calls = (body.results ?? [])
          .filter((result) => result.tool_name === 'tabs')
          .map((result) => ({
            call: typeof result.call_id === 'string' ? hash(result.call_id) : null,
            is_error: result.is_error === true,
            output_url_matches: result.output?.url === expectedUrl,
            output_tab_id_present: Number.isInteger(result.output?.tab_id),
            output_tab_id: Number.isInteger(result.output?.tab_id) ? result.output.tab_id : null,
          }));
      }
    } catch {
      /* Fail closed at the assertion, retain no body. */
    }
  };
  const requestListener = ({ requestId, request }, sessionId) => {
    try {
      if (request.method !== 'POST') return;
      const path = new URL(request.url).pathname;
      const results = /\/ai\/conversations\/([a-f0-9-]{36})\/tool_results$/.exec(path);
      const start = /\/ai\/(?:agent|agents|mandates)\/[^/]+$/.test(path);
      if (!results && !start) return;
      const entry = {
        kind: start ? 'start' : 'result',
        startDoor: start && path.includes('/mandates/') ? 'mandate' : start ? 'agent' : null,
        targetKind:
          start && decodeURIComponent(path.split('/').at(-1)).startsWith('mandate:')
            ? 'mandate_reference'
            : start && /\/mandates\//.test(path)
              ? 'mandate_key'
              : start
                ? 'concrete_agent'
                : null,
        conversation: results ? hash(results[1]) : null,
        status: null,
        responseConversation: null,
        backendRequest: null,
        requestMode: null,
        organizationHeader: null,
        calls: [],
      };
      const organizationHeader = Object.entries(request.headers ?? {}).find(
        ([name]) => name.toLowerCase() === 'x-organization-id',
      )?.[1];
      entry.organizationHeader = UUID.test(organizationHeader ?? '')
        ? hash(organizationHeader)
        : null;
      rows.set(`${sessionId}:${requestId}`, entry);
      if (request.postData) summarize(entry, request.postData);
      else {
        const task = native.browserSession
          .send('Network.getRequestPostData', { requestId }, sessionId)
          .then(({ postData }) => summarize(entry, postData))
          .catch(() => {});
        pending.add(task);
        void task.finally(() => pending.delete(task));
      }
    } catch {
      /* Ignore unrelated network traffic. */
    }
  };
  const responseListener = ({ requestId, response }, sessionId) => {
    const entry = rows.get(`${sessionId}:${requestId}`);
    if (!entry) return;
    entry.status = response.status;
    const header = (key) =>
      Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === key)?.[1];
    const conversation = header('x-conversation-id');
    const request = header('x-request-id');
    entry.responseConversation = UUID.test(conversation ?? '') ? hash(conversation) : null;
    entry.backendRequest = UUID.test(request ?? '') ? hash(request) : null;
  };
  native.browserSession.on('Network.requestWillBeSent', requestListener);
  native.browserSession.on('Network.responseReceived', responseListener);
  return {
    observeTab(id) {
      observedTabId = Number.isInteger(id) ? id : null;
    },
    snapshot() {
      const starts = [...rows.values()].filter((row) => row.kind === 'start');
      const results = [...rows.values()].filter((row) => row.kind === 'result');
      const start = starts.length === 1 ? starts[0] : null;
      const result = start
        ? results.find(
            (row) =>
              row.conversation === start.conversation &&
              row.status === 200 &&
              row.calls.some(
                (call) =>
                  !call.is_error &&
                  call.output_tab_id === observedTabId &&
                  observedTabId !== null &&
                  call.output_tab_id_present &&
                  call.call,
              ),
          )
        : null;
      return {
        start_count: starts.length,
        organization_header_fingerprint: start?.organizationHeader ?? null,
        organization_header_matches_approved: Boolean(
          approvedOrganization && start?.organizationHeader === hash(approvedOrganization.id),
        ),
        actual_permission_mode: ['ask', 'act'].includes(start?.requestMode)
          ? start.requestMode
          : null,
        mode_matches: start?.requestMode === mode,
        conversation_fingerprint: start?.conversation ?? null,
        response_matches_request_conversation: Boolean(
          start?.conversation && start.conversation === start.responseConversation,
        ),
        backend_request_fingerprint: start?.backendRequest ?? null,
        start_http_status: start?.status ?? null,
        start_endpoint_door: start?.startDoor ?? null,
        start_target_kind: start?.targetKind ?? null,
        successful_create_tab_result_posted: Boolean(result),
        result_http_status: result?.status ?? null,
        result_post_count: results.length,
        create_tab_result_count: results.flatMap((row) => row.calls).length,
        create_tab_error_count: results.flatMap((row) => row.calls).filter((call) => call.is_error)
          .length,
        call_fingerprint:
          result?.calls.find(
            (call) =>
              !call.is_error &&
              call.output_tab_id === observedTabId &&
              observedTabId !== null &&
              call.output_tab_id_present,
          )?.call ?? null,
      };
    },
    async stop() {
      native.browserSession.off('Network.requestWillBeSent', requestListener);
      native.browserSession.off('Network.responseReceived', responseListener);
      await Promise.allSettled([...pending]);
      await observer.stop();
      await native.browserSession.send('Target.detachFromTarget', { sessionId: workerSession });
    },
  };
}

/** The only harness navigation is the initial fixture. Each marker must be opened by the agent. */
async function exerciseApproval(native) {
  let panel = native.panel;
  const { page, artifacts } = native;
  const paths = new Set();
  const fixture = createServer((request, response) => {
    paths.add(request.url);
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end(
      '<!doctype html><title>Workflow review workspace</title><main><h1>Workflow review workspace</h1><p>Capture, Understand, Use.</p></main>',
    );
  });
  await new Promise((resolveListen, reject) => {
    fixture.once('error', reject);
    fixture.listen(0, '127.0.0.1', resolveListen);
  });
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  report.approval.fixture = {
    scope: 'owned localhost workspace; ephemeral port; unique per-action markers',
  };
  const remember = async (surface) => {
    await pointer(
      panel,
      `[...(${paneExpression(surface)}?.querySelectorAll('label input[type="checkbox"]') ?? [])].filter((el) => el.parentElement.textContent.includes('for the rest of this chat'))`,
    );
    assert.equal((await approvalObservation(panel, surface)).rememberChecked, true);
  };
  const allow = (surface) =>
    pointer(
      panel,
      `[...(${paneExpression(surface)}?.querySelectorAll('button') ?? [])].filter((el) => el.textContent.trim() === 'Allow')`,
    );
  const historyRows = `[...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].filter((el) => el.querySelector('span.line-clamp-1'))`;
  const toggleHistory = () =>
    pointer(
      panel,
      `[...(${paneExpression('Chat')}?.querySelectorAll('button') ?? [])].filter((el) => (el.title || el.getAttribute('data-matrx-title')) === 'History')`,
    );
  const historyOrigin = await supabaseOrigin(REPO);
  // The History DOM exposes titles, not UUIDs. Correlate the real list response
  // with every rendered row, then click the original UUID's index, even if titles repeat.
  const reopenOwnedHistory = async (boundary) => {
    const original = report.approval.cases[0].transport.conversation_fingerprint;
    const evidence = {
      conversation_fingerprint: original,
      history_http_status: null,
      actual_response_matched_rendered_rows: false,
      native_history_reopened: false,
      hydrated_replies_observed: false,
      next_request_conversation_identity_required: true,
    };
    report.approval[boundary] = evidence;
    stage = `${boundary}_fresh_chat`;
    await waitFor(
      `${boundary}_chat_tab_ready`,
      () => evaluate(panel, `document.querySelectorAll('button[role="tab"][title="Chat"]').length`),
      (value) => value === 1,
      30_000,
    );
    await click(panel, 'title', 'Chat');
    await waitFor(
      `${boundary}_fresh_chat_ready`,
      () => approvalObservation(panel),
      (value) => value?.ready && value.replies === 0,
      30_000,
    );
    const requests = new Map();
    const pending = new Set();
    let history = null;
    const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
      try {
        const url = new URL(request.url);
        const profile = Object.entries(request.headers ?? {}).find(
          ([name]) => name.toLowerCase() === 'accept-profile',
        )?.[1];
        if (
          request.method === 'GET' &&
          url.origin === historyOrigin &&
          url.pathname === '/rest/v1/conversation' &&
          profile === 'chat' &&
          url.searchParams.get('order') === 'updated_at.desc'
        )
          requests.set(requestId, { status: null });
      } catch {
        /* Ignore unrelated requests. */
      }
    });
    const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
      const entry = requests.get(requestId);
      if (entry) entry.status = response.status;
    });
    const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
      if (requests.get(requestId)?.status !== 200) return;
      const task = panel
        .send('Network.getResponseBody', { requestId })
        .then(({ body, base64Encoded }) => {
          const rows = JSON.parse(
            base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
          );
          if (
            Array.isArray(rows) &&
            rows.length &&
            rows.every(
              (row) =>
                UUID.test(row.id ?? '') && (row.title === null || typeof row.title === 'string'),
            )
          )
            history = rows.map((row) => ({
              fingerprint: hash(row.id),
              title: row.title?.trim() || 'Untitled chat',
            }));
        })
        .catch(() => {});
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
    try {
      await panel.send('Network.enable');
      stage = `${boundary}_history_response`;
      await toggleHistory();
      await waitFor(
        `${boundary}_actual_history_response`,
        () => history,
        (value) => Array.isArray(value),
        30_000,
      );
      const observedHistory = history;
      evidence.history_http_status = 200;
      const indexes = observedHistory.flatMap((row, index) =>
        row.fingerprint === original ? [index] : [],
      );
      assert.equal(
        indexes.length,
        1,
        'real History response must contain the exact owned conversation once',
      );
      const index = indexes[0];
      const titles = observedHistory.map((row) => row.title);
      stage = `${boundary}_history_dom_match`;
      await waitFor(
        `${boundary}_history_dom_matches_actual_response`,
        () =>
          evaluate(
            panel,
            `JSON.stringify((${historyRows}).map((el) => el.querySelector('span.line-clamp-1')?.textContent.trim())) === ${JSON.stringify(JSON.stringify(titles))}`,
          ),
        (value) => value === true,
        30_000,
      );
      evidence.actual_response_matched_rendered_rows = true;
      stage = `${boundary}_native_history_pointer`;
      await pointer(
        panel,
        `(${historyRows}).filter((el, index) => index === ${index} && el.querySelector('span.line-clamp-1')?.textContent.trim() === ${JSON.stringify(observedHistory[index].title)})`,
      );
      evidence.native_history_reopened = true;
      stage = `${boundary}_history_hydration`;
      await waitFor(
        `${boundary}_owned_chat_loaded`,
        () => approvalObservation(panel),
        (value) => value?.ready && value.replies > 0 && value.mode === 'Ask before acting',
        30_000,
      );
      evidence.history_row_title_fingerprint = hash(observedHistory[index].title);
      evidence.hydrated_replies_observed = true;
    } finally {
      offRequest();
      offResponse();
      offFinished();
      await Promise.allSettled([...pending]);
    }
  };
  const runAction = async (caseId, expected, surface = 'Chat') => {
    stage = caseId;
    await native.requireResourceHealth();
    const marker = `/workflow-review/${randomUUID()}`;
    const url = `${origin}${marker}`;
    const before = await approvalObservation(panel, surface);
    assert.equal(before.approvals, 0, 'no approval may carry over into the next case');
    const focused = await evaluate(
      panel,
      `(() => { const el = ${paneExpression(surface)}?.querySelector('textarea'); if (!el || el.disabled) return false; el.focus(); return document.activeElement === el; })()`,
    );
    assert.equal(focused, true);
    const mode = before.mode === 'Act without asking' ? 'act' : 'ask';
    const transport = await observeAuthenticatedTransport(native, url, mode);
    try {
      await panel.send('Input.insertText', {
        text: `Use the canonical ordinary browser action tool tabs exactly once with action create and url ${url}. This is my owned local workflow review page. Do not navigate or fetch it another way. After it opens, reply with Done.`,
      });
      await pointer(
        panel,
        `[...(${paneExpression(surface)}?.querySelectorAll('button') ?? [])].filter((el) => (el.title || el.getAttribute('data-matrx-title')) === 'Send' && !el.disabled)`,
      );
      let approvalSamples = 0;
      let approved = false;
      let pendingBeforeEffect = false;
      let firstApprovalSaved = false;
      let final;
      let lastObservation = null;
      let lastOpenedCount = 0;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const observed = await approvalObservation(panel, surface);
        lastObservation = observed;
        const opened = page
          .context()
          .pages()
          .filter((candidate) => candidate.url() === url);
        lastOpenedCount = opened.length;
        const chatPrior = report.approval.cases.find((prior) => prior.surface === surface);
        const currentTransport = transport.snapshot();
        if (chatPrior && currentTransport.conversation_fingerprint)
          assert.equal(
            currentTransport.conversation_fingerprint,
            chatPrior.transport.conversation_fingerprint,
            'original conversation identity required before approval assertions',
          );
        // An approval sampled before Network post-data arrives is not yet attributable.
        // Wait for the actual request identity rather than mistake a new chat for lost trust.
        if (chatPrior && observed.approvals > 0 && !currentTransport.conversation_fingerprint) {
          await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
          continue;
        }
        if (opened.length === 1) {
          // Read the tab created by the real action, then correlate its returned id.
          // The harness never supplies this id to dispatch or creates the marker tab.
          const tabId = await evaluate(
            panel,
            `(async () => {
            const matches = (await chrome.tabs.query({})).filter((tab) => tab.url === ${JSON.stringify(url)});
            return matches.length === 1 ? matches[0].id : null;
          })()`,
          );
          transport.observeTab(tabId);
        }
        if (observed.approvals > 0) {
          approvalSamples += 1;
          if (!firstApprovalSaved) {
            await capture(panel, artifacts, `${caseId}-approval`);
            firstApprovalSaved = true;
          }
          assert.notEqual(
            expected,
            'none',
            `${caseId}: Act/remembered action unexpectedly requested approval`,
          );
          assert.equal(observed.approvals, 1);
          assert.equal(
            observed.ordinaryCreateTabApproval,
            true,
            'must be the real ordinary action approval',
          );
          if (!approved) {
            assert.equal(paths.has(marker), false, 'action must not run before approval');
            assert.equal(opened.length, 0, 'tab must not exist before approval');
            pendingBeforeEffect = true;
            if (expected === 'remember') {
              assert.equal(observed.rememberOffered, true);
              await remember(surface);
            }
            await allow(surface);
            approved = true;
          }
        }
        if (
          paths.has(marker) &&
          opened.length === 1 &&
          !observed.streaming &&
          observed.replies > before.replies &&
          observed.approvals === 0 &&
          transport.snapshot().successful_create_tab_result_posted
        ) {
          final = observed;
          assert.equal(await opened[0].title(), 'Workflow review workspace');
          break;
        }
        await new Promise((resolvePoll) => setTimeout(resolvePoll, 100));
      }
      if (!final) {
        report.approval.last_case_boundary = {
          case_id: caseId,
          observation: lastObservation,
          approval_samples: approvalSamples,
          approved,
          marker_tab_count: lastOpenedCount,
          fixture_received_request: paths.has(marker),
          reply_count_increased: (lastObservation?.replies ?? 0) > before.replies,
          screenshot: await capture(panel, artifacts, `${caseId}-completion-failure`),
        };
        throw new Error('approval_action_completion_not_observed');
      }
      if (expected !== 'none')
        assert.equal(
          approved && pendingBeforeEffect,
          true,
          'Ask requires approval before browser side effect',
        );
      const network = transport.snapshot();
      assert.equal(network.start_count, 1, 'one actual backend start required');
      assert.equal(
        network.organization_header_matches_approved,
        true,
        'actual backend start must carry the approved UI-selected organization',
      );
      assert.equal(
        network.mode_matches,
        true,
        'actual browser-dom request must carry selected mode',
      );
      assert.equal(network.start_http_status, 200);
      assert.equal(network.response_matches_request_conversation, true);
      assert.ok(network.backend_request_fingerprint, 'real backend request identity required');
      assert.ok(
        network.call_fingerprint,
        'real successful canonical tabs create completion required',
      );
      for (const prior of report.approval.cases)
        assert.notEqual(
          network.backend_request_fingerprint,
          prior.transport.backend_request_fingerprint,
          'each turn must start a new backend request',
        );
      const chatPrior = report.approval.cases.find((prior) => prior.surface === surface);
      if (chatPrior)
        assert.equal(
          network.conversation_fingerprint,
          chatPrior.transport.conversation_fingerprint,
          'same conversation required across repeats and reloads',
        );
      const evidence = {
        transport: network,
        case_id: caseId,
        surface,
        verdict: 'pass',
        expected_approval: expected,
        approval_samples: approvalSamples,
        pending_before_effect: pendingBeforeEffect,
        real_browser_tab_opened: true,
        fixture_received_request: true,
        completed_reply: true,
        screenshot: await capture(panel, artifacts, `${caseId}-result`),
      };
      report.approval.cases.push(evidence);
      await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
      await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      for (const candidate of page
        .context()
        .pages()
        .filter((candidate) => candidate.url() === url))
        await candidate.close();
    } finally {
      report.approval.last_transport_observation = { case_id: caseId, ...transport.snapshot() };
      await transport.stop();
    }
  };
  try {
    stage = 'settings_default_act';
    await openSection(panel, 'Chat');
    const modePicker = `[...(${paneExpression('Settings')}?.querySelectorAll('span.text-sm') ?? [])].filter((el) => el.textContent.trim() === 'Default mode').flatMap((el) => [...el.parentElement.parentElement.querySelectorAll('button[role="combobox"]')])`;
    await pointer(panel, modePicker);
    await pointer(
      panel,
      `[...document.querySelectorAll('[role="option"]')].filter((el) => el.textContent.trim() === 'Act without asking')`,
    );
    await waitFor(
      'settings_default_act_selected',
      () => evaluate(panel, `(${modePicker})[0]?.textContent.trim()`),
      (value) => value === 'Act without asking',
    );
    report.approval.settings_default_act_selected = true;
    await page.bringToFront();
    await click(panel, 'title', 'Chat');
    await waitFor(
      'approval_chat_composer',
      () => approvalObservation(panel),
      (value) => value?.ready,
      30_000,
    );
    assert.equal(
      (await approvalObservation(panel)).mode,
      'Act without asking',
      'fresh Chat must inherit Settings default mode',
    );
    await runAction('act_first', 'none');
    await runAction('act_second', 'none');
    await permissionMode(panel, 'ask');
    await runAction('ask_remember', 'remember');
    await runAction('ask_remember_repeat', 'none');
    stage = 'warm_panel_reload';
    await panel.send('Page.reload', { ignoreCache: false });
    await reopenOwnedHistory('warm_panel_reload');
    await runAction('ask_remember_warm_reload', 'none');
    stage = 'full_extension_reload';
    const reload = await native.reloadExtension();
    const { panel: replacementPanel, ...lifecycle } = reload;
    report.approval.full_reload = lifecycle;
    panel = replacementPanel;
    await reopenOwnedHistory('full_extension_reload_history');
    await runAction('ask_remember_full_reload', 'none');
    report.approval.limitations.push(
      'Privileged tools and ask-user input are outside this ordinary-action acceptance.',
    );
    report.approval.limitations.push(
      'Pilot simultaneous backend runs are not exercised; this serial driver does not prove parallel surface isolation.',
    );
    if (process.env.MATRX_REVIEWER_UNINTERRUPTED_PILOT === '1') {
      stage = 'pilot_opposing_mode';
      await permissionMode(panel, 'act');
      await click(panel, 'title', 'Pilot (admin only — sandboxed tab group)');
      await pointer(
        panel,
        `[...(${paneExpression('Pilot (admin only — sandboxed tab group)')}?.querySelectorAll('button') ?? [])].filter((el) => el.textContent.trim() === 'Start Pilot')`,
      );
      const pilot = 'Pilot (admin only — sandboxed tab group)';
      await waitFor(
        'pilot_ready',
        () => approvalObservation(panel, pilot),
        (value) => value?.ready,
        30_000,
      );
      await permissionMode(panel, 'ask', pilot);
      await runAction('pilot_ask_opposes_chat_act', 'once', pilot);
      await click(panel, 'title', 'Chat');
      assert.equal((await approvalObservation(panel)).mode, 'Act without asking');
      await runAction('chat_act_after_pilot_ask', 'none');
    } else
      report.approval.limitations.push(
        'Pilot opposing modes require MATRX_REVIEWER_UNINTERRUPTED_PILOT=1 and are unverified in this run.',
      );
  } finally {
    for (const candidate of page
      .context()
      .pages()
      .filter((candidate) => candidate.url().startsWith(`${origin}/`)))
      await candidate.close().catch(() => {});
    if (panel !== native.panel) await panel.detach().catch(() => {});
    fixture.closeAllConnections();
    await new Promise((resolveClose) => fixture.close(resolveClose));
  }
}

try {
  if (UNINTERRUPTED) {
    stage = 'approved_organization_config';
    approvedOrganization = await approvedOrganizationConfig();
  }
  const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'));
  if (UNINTERRUPTED)
    report.imported_artifact = await verifyImportedNativeEvidence(EXTENSION_DIR, RECEIPT);
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
    releaseReceiptPath: RECEIPT,
    ...(receipt.kind === 'local_dev_unpacked' && { localDevReceiptPath: RECEIPT }),
    exercisePanel: async (native) => {
      const { page, panel, artifacts } = native;
      stage = MAGIC_LINK ? 'open_reviewer_magic_link' : 'open_reviewer_web_login';
      const web = await page.context().newPage();
      let memberTransport = null;
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
        const webIdentity = await waitFor(
          'reviewer_web_identity',
          () =>
            authenticatedWebIdentity(
              web,
              UNINTERRUPTED ? hash('admin@admin.com') : REVIEWER_FINGERPRINT,
            ),
          (value) => UUID.test(value?.userId ?? ''),
          30_000,
        );
        if (webIdentity.email.toLowerCase() !== email.toLowerCase())
          throw new Error('reviewer_web_identity_mismatch');
        email = webIdentity.email;
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
        const adminCheck = UNINTERRUPTED
          ? observeAdminAssignment(panel, await supabaseOrigin(REPO))
          : observeCanonicalAdminCheck(panel, await supabaseOrigin(REPO));
        await adminCheck.start();
        let canonicalAdminCheck;
        try {
          stage = 'extension_signin_click';
          await click(panel, 'button', 'Sign in');
          stage = 'extension_organization_open';
          await openSection(panel, 'Organization');
          stage = 'extension_identity_wait';
          try {
            await waitFor(
              'reviewer_non_admin_identity',
              async () => {
                const consent = await approveOwnedOauthConsent(page.context());
                if (consent === 'authorized') report.account.oauth_consent = 'authorized';
                return {
                  ...(await accountObservation(panel, email)),
                  ...(await memberPanelIdentity(panel)),
                };
              },
              (state) =>
                state?.emailMatchesReviewer &&
                state.profileId === webIdentity.userId &&
                state.accessTokenPresent &&
                (UNINTERRUPTED ? state.isAdmin === true : state.isAdmin !== true) &&
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
          canonicalAdminCheck = await adminCheck.verify(webIdentity.userId);
        } finally {
          await adminCheck.stop();
        }
        stage = 'reviewer_organization_resolve';
        let account = await waitFor(
          'reviewer_organization_resolved',
          () => accountObservation(panel, email),
          (state) => state?.organizationSelected || state?.organizationPickerAvailable,
          30_000,
        );
        let selectionDiagnostics = null;
        if (UNINTERRUPTED || !account.organizationSelected) {
          stage = 'select_reviewer_default_organization';
          try {
            selectionDiagnostics = await selectReviewerOrganization(panel);
          } catch (error) {
            report.account = {
              reviewer_fingerprint: hash(email),
              extension_signed_in: account.emailMatchesReviewer,
              observed_role_category: account.observedRoleCategory,
              sign_out_visible: account.signOutVisible,
              organization_picker_available: account.organizationPickerAvailable,
              ...(UNINTERRUPTED
                ? { approved_organization_selection: error.safeSelection ?? null }
                : { organization_options: error.safeOptions ?? [] }),
              storage_shape: await storedSessionShape(panel),
            };
            if (!UNINTERRUPTED)
              report.screenshots = {
                organization_picker: await capture(
                  panel,
                  artifacts,
                  'reviewer-organization-picker',
                ),
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
        let approvedSelection = null;
        if (UNINTERRUPTED) {
          stage = 'approved_organization_selected';
          try {
            approvedSelection = await waitFor(
              'reviewer_approved_organization_selected',
              () => approvedOrganizationObservation(panel),
              // A load-time account choice is intentionally not saved as a device override.
              // A present override must agree; the real request header is checked below.
              (value) =>
                value?.actingAsPickerCount === 1 &&
                value?.pickerMatchesApproved &&
                (!value?.deviceOverridePresent || value?.deviceOverrideMatchesApproved),
              30_000,
            );
          } catch (error) {
            // Preserve only fixed booleans/counts on a timeout, never option text or ids.
            report.account = {
              reviewer_fingerprint: hash(email),
              extension_signed_in: account.emailMatchesReviewer,
              observed_role_category: account.observedRoleCategory,
              approved_organization_selection: {
                ...selectionDiagnostics,
                ...(await approvedOrganizationObservation(panel).catch(() => ({}))),
                name_fingerprint: hash(approvedOrganization.name),
                id_fingerprint: hash(approvedOrganization.id),
              },
              storage_shape: await storedSessionShape(panel),
            };
            throw error;
          }
        }
        const storageShape = await storedSessionShape(panel);
        report.account = {
          reviewer_fingerprint: hash(email),
          web_signed_in: true,
          extension_signed_in: account.emailMatchesReviewer,
          observed_role_category: account.observedRoleCategory,
          canonical_extension_admin_check: canonicalAdminCheck,
          sign_out_visible: account.signOutVisible,
          default_organization_selected: account.organizationSelected,
          organization_picker_available: account.organizationPickerAvailable,
          storage_shape: storageShape,
          ...(UNINTERRUPTED && {
            approved_organization_selection: {
              ...selectionDiagnostics,
              ...approvedSelection,
              name_fingerprint: hash(approvedOrganization.name),
              id_fingerprint: hash(approvedOrganization.id),
            },
          }),
        };
        if (UNINTERRUPTED) {
          await exerciseApproval(native);
          return;
        }

        // Load-time organization ladder selections intentionally stay in memory.
        // Device storage is diagnostic only; the real Chat transport is the oracle.

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

        memberTransport = await observeAuthenticatedTransport(native, null, null);
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
        stage = 'reviewer_chat_transport';
        const network = memberTransport.snapshot();
        report.chat_transport = network;
        assert.equal(network.start_count, 1, 'one actual member Chat start required');
        assert.ok(
          network.organization_header_fingerprint,
          'member Chat must carry a valid organization',
        );
        assert.equal(network.start_http_status, 200, 'server must accept member Chat organization');
        assert.equal(
          network.response_matches_request_conversation,
          true,
          'Chat response must match the sent conversation',
        );
        assert.ok(network.backend_request_fingerprint, 'real member Chat backend request required');
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
        await memberTransport?.stop();
        await web.close();
      }
    },
  });
  report.build.extension_id = run.extensionId;
  report.status = 'pass';
} catch (error) {
  report.failure_stage = stage;
  report.failure_code = SAFE_FAILURE_CODES.has(error?.message)
    ? error.message
    : 'unclassified_failure';
  report.status = 'unverified';
}
await mkdir(dirname(OUTPUT), { recursive: true, mode: 0o700 });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(
  `${report.status.toUpperCase()} ${UNINTERRUPTED ? 'reviewer_uninterrupted' : 'reviewer_chat_store'} ${OUTPUT}\n`,
);
if (report.status !== 'pass') process.exitCode = 1;
