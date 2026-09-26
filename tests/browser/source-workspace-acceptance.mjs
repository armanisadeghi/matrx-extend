#!/usr/bin/env node
/**
 * EXT-D-0022: one bounded Source save or read-only recovery and workspace-switch observation in an
 * owned, receipt-verified native Chrome panel. Root owns guarded execution.
 * Real UI login follows isolated-admin-signin-acceptance.mjs; that script is
 * an executable entrypoint, so importing it would launch a second browser.
 */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

const REPO = resolve(import.meta.dirname, '..', '..');
const SOURCE_READONLY_SCOPE = process.env.SOURCE_READONLY_SCOPE === '1';
const OUTPUT = join(
  REPO,
  'test-results',
  SOURCE_READONLY_SCOPE
    ? 'source-workspace-readonly-scope.json'
    : 'source-workspace-acceptance.json',
);
const PRIVATE_CONFIG = join(REPO, 'test-results', 'd22-private-config.json');
const ATTEMPT = join(REPO, 'test-results', 'd22-source-save-attempt.json');
const PRIVATE_POINTER_SCREENSHOT = join(REPO, 'test-results', 'd22-save-pointer-private.png');
const RELEASE_RECEIPT = join(REPO, '.output', 'release-receipt.json');
const MANIFEST = join(REPO, '.output', 'chrome-mv3-dev', 'manifest.json');
const ADMIN_ENV = join(homedir(), 'code', 'aidream', '.env');
const WEB_ORIGIN = 'https://www.aimatrx.com';
const SOURCE_ORIGINS = new Set(['https://aimatrx.com', WEB_ORIGIN]);
const EMAIL = 'admin@admin.com';
const FIXTURES = ['https://example.com/', 'https://www.iana.org/domains/reserved'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The existing D22 Save attempt is reserved. This acceptance can only observe
// the D23 notice remedy and the public capture's pointer geometry.
const D23_READ_ONLY = true;

let stage = 'before_owned_profile';
const report = {
  schema_version: 1,
  defect_id: 'EXT-D-0022',
  scope: SOURCE_READONLY_SCOPE
    ? 'isolated native admin panel; read-only missing-workspace and scoped Source recognition'
    : 'isolated native admin panel; at most one approved public Source save',
  status: 'unverified',
  build: null,
  observations: {
    realAdminUi: false,
    approvedExistingOrganizationSelectedByUi: false,
    fixtureLookup: 'unverified',
    checkpointDurableBeforeSave: false,
    saveAttemptReserved: false,
    pointerDispatch: 'not_attempted',
    saveResult: 'not_attempted',
    recoveryLookup: 'not_applicable',
    localSavedAndOpenSource: 'unverified',
    comparisonOrganization: 'unverified',
    immediateClaimClear: 'unverified',
    comparisonRecognition: 'unverified',
    approvedOrganizationRestored: 'unverified',
    missingOrganization: 'unverified',
    lateInflightSave: 'unverified',
    d23: {
      noWorkspaceNoticeBeforeSelection: 'unverified',
      noWorkspaceNoticeAfterSelection: 'unverified',
      savePointerAfterPublicCapture: 'unverified',
      readOnlyAcceptance: 'unverified',
    },
    ...(SOURCE_READONLY_SCOPE && {
      d22Scope: {
        noWorkspaceUi: 'unverified',
        noWorkspaceLookup: 'unverified',
        scopedLookup: 'unverified',
        scopedUi: 'unverified',
        privateScreenshot: 'not_needed',
      },
    }),
  },
};
const fail = (code) => {
  report.failureCode = code;
  throw new Error('source_workspace_unverified');
};

async function privateApprovedOrganization() {
  const stat = await lstat(PRIVATE_CONFIG).catch(() => fail('private_config_unavailable'));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('private_config_not_private');
  const parsed = JSON.parse(await readFile(PRIVATE_CONFIG, 'utf8'));
  const name = parsed?.approved_organization_name;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim())
    fail('approved_organization_missing');
  return name;
}

// Credentials are read only when the real web form is ready. Neither values
// nor raw login errors enter the result or a thrown error.
async function realWebSignIn(page) {
  const web = await page.context().newPage();
  try {
    stage = 'web_login';
    await web.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const login = new URL(web.url());
    if (login.origin !== WEB_ORIGIN || login.pathname !== '/login') fail('web_login_route');
    const source = await readFile(ADMIN_ENV, 'utf8');
    const variables = {};
    for (const line of source.split(/\r?\n/)) {
      const found = /^\s*(AI_ADMIN_USERNAME|AI_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
      if (!found) continue;
      let value = found[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      variables[found[1]] = value;
    }
    if (variables.AI_ADMIN_USERNAME !== EMAIL || !variables.AI_ADMIN_PASSWORD)
      fail('admin_credentials_unavailable');
    await web.locator('input[name="email"]').fill(EMAIL);
    await web.locator('input[name="password"]').fill(variables.AI_ADMIN_PASSWORD);
    await Promise.all([
      web.waitForURL((url) => url.origin === WEB_ORIGIN && url.pathname === '/dashboard', {
        timeout: 90_000,
      }),
      web.getByRole('button', { name: 'Sign in', exact: true }).click(),
    ]);
    return web;
  } catch {
    await web.close();
    fail('real_web_login_unverified');
  }
}

async function adminState(panel) {
  return evaluate(
    panel,
    `(() => {
      const account = [...document.querySelectorAll('button[aria-expanded]')]
        .find((button) => button.textContent.trim() === 'Account');
      const section = account?.parentElement?.nextElementSibling;
      const row = (label) => [...(section?.querySelectorAll('span') ?? [])]
        .find((span) => span.textContent.trim() === label)?.parentElement?.textContent.trim() ?? null;
      return {
        emailMatch: row('Email') === 'Email${EMAIL}',
        adminRole: row('Role')?.toLowerCase() === 'roleadmin',
        signOutVisible: [...document.querySelectorAll('button')]
          .some((button) => button.textContent.trim() === 'Sign out'),
      };
    })()`,
  );
}

async function protectedSettings(panel) {
  await openSection(panel, 'Desktop bridge');
  return evaluate(
    panel,
    `(async () => {
    const port = document.querySelector('input[placeholder="auto"]');
    const permissions = await Promise.all(
      ['cookies', 'pageCapture', 'clipboardRead', 'tabCapture']
        .map((permission) => chrome.permissions.contains({ permissions: [permission] })));
    return { portAuto: port?.value === '', optionalPermissionsOff: permissions.every((v) => !v) };
  })()`,
  );
}

async function organizationState(panel, approvedName) {
  return evaluate(
    panel,
    `(async () => {
      const approved = ${JSON.stringify(approvedName)};
      const rows = [...document.querySelectorAll('span')]
        .filter((span) => span.textContent.trim() === 'Acting as');
      const controls = rows.flatMap((span) =>
        [...span.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]);
      const options = [...document.querySelectorAll('[role="option"]')]
        .map((option) => option.textContent.trim());
      const stored = (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active'];
      return {
        controlCount: controls.length,
        displayed: controls.length === 1 ? controls[0].textContent.trim() : null,
        approvedOptionCount: options.filter((option) => option === approved).length,
        otherOptions: options.filter((option) => option !== approved),
        storedId: typeof stored?.id === 'string' ? stored.id : null,
        storedApproved: stored?.name === approved,
      };
    })()`,
  );
}

async function chooseOrganization(panel, name, approvedName) {
  let step = 'settings_tab';
  try {
    await click(panel, 'title', 'Settings');
    // The no-workspace notice occupies the bottom of this narrow panel.
    // Collapse the real Account section to bring the Organization controls
    // above it, without dismissing the notice whose retirement we must test.
    step = 'account_section_collapse';
    const account = await evaluate(
      panel,
      `(() => {
        const buttons = [...document.querySelectorAll('button[aria-expanded]')]
          .filter((button) => button.textContent.trim() === 'Account');
        return { count: buttons.length, expanded: buttons[0]?.getAttribute('aria-expanded') ?? null };
      })()`,
    );
    if (account.count !== 1 || !['true', 'false'].includes(account.expanded))
      fail('account_section_not_unique_or_absent');
    if (account.expanded === 'true') await click(panel, 'section', 'Account');
    await waitFor(
      'account_section_collapsed_for_organization',
      () =>
        evaluate(
          panel,
          `(() => [...document.querySelectorAll('button[aria-expanded]')]
            .filter((button) => button.textContent.trim() === 'Account')
            .map((button) => button.getAttribute('aria-expanded')))()`,
        ),
      (states) => states?.length === 1 && states[0] === 'false',
    );
    step = 'organization_section';
    await openSection(panel, 'Organization');
    step = 'organization_control_ready';
    await waitFor(
      'organization_control',
      () => organizationState(panel, approvedName),
      (state) => state?.controlCount === 1,
    );
    step = 'organization_control_click';
    await click(panel, 'organization', 'Acting as');
    step = 'approved_option_ready';
    const offered = await organizationState(panel, approvedName);
    if (offered.approvedOptionCount !== 1) fail('approved_org_not_unique_or_absent');
    if (
      offered.otherOptions.filter((option) => option === name).length !==
      (name === approvedName ? 0 : 1)
    )
      fail('comparison_org_not_unique_or_absent');
    step = 'organization_option_click';
    await click(panel, 'option', name);
    step = 'organization_selected';
    return await waitFor(
      'organization_selected',
      () => organizationState(panel, approvedName),
      (state) =>
        state?.displayed === name &&
        Boolean(state.storedId) &&
        state.storedApproved === (name === approvedName),
    );
  } catch (error) {
    // The previous run established that a notice was present, but the
    // generic selection failure concealed which real UI action it blocked.
    // Keep only fixed categories and counts from this credential-bearing UI.
    const pointer = error?.driverFailure;
    const diagnostics = SOURCE_READONLY_SCOPE
      ? report.observations.d22Scope
      : report.observations.d23;
    diagnostics.organizationSelectionFailure = {
      step,
      driverCode: pointer?.code ?? 'non_pointer_failure',
      pointerHitTarget: pointer?.hitTarget === true,
      centerKnownNotice: pointer?.centerOccluder?.known_notice ?? null,
      centerInDialog: pointer?.centerOccluder?.in_dialog === true,
      centerInAlert: pointer?.centerOccluder?.in_alert === true,
    };
    try {
      diagnostics.organizationSelectionSurface = await evaluate(
        panel,
        `(() => {
          const settings = document.querySelector('button[role="tab"][title="Settings"]');
          const dialogs = [...document.querySelectorAll('[role="dialog"]')];
          const picker = dialogs.filter((dialog) =>
            dialog.querySelector('[data-slot="dialog-title"]')?.textContent.trim() ===
              'Which organization are you working in?');
          const rows = [...document.querySelectorAll('span')]
            .filter((span) => span.textContent.trim() === 'Acting as');
          return {
            settingsTabActive: settings?.getAttribute('data-state') === 'active',
            dialogCount: dialogs.length,
            organizationPickerDialogCount: picker.length,
            actingAsRowCount: rows.length,
            organizationControlCount: rows.flatMap((row) =>
              [...row.parentElement.parentElement.querySelectorAll('button[role="combobox"]')]).length,
          };
        })()`,
      );
    } catch {
      diagnostics.organizationSelectionSurface = 'unavailable';
    }
    try {
      const privateScreenshot = join(
        REPO,
        'test-results',
        `${SOURCE_READONLY_SCOPE ? 'd22-scope' : 'd23-org-selection'}-${randomUUID()}.png`,
      );
      const shot = await panel.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await writeFile(privateScreenshot, Buffer.from(shot.data, 'base64'), {
        flag: 'wx',
        mode: 0o600,
      });
      diagnostics.organizationSelectionScreenshot = 'captured_private';
    } catch {
      diagnostics.organizationSelectionScreenshot = 'unavailable';
    }
    throw error;
  }
}

// Return only a count for the known, typed no-workspace failure UI. The
// private report must not contain any organization name or notice text.
async function noWorkspaceCaptureNoticeCount(panel) {
  return evaluate(
    panel,
    `(() => [...document.querySelectorAll('[role="alert"]')]
      .filter((alert) => alert.querySelector('.font-medium')?.textContent.trim() === 'Capture list unavailable'
        && alert.querySelector('p')?.textContent.includes('no workspace is selected, so the request was never sent'))
      .length)()`,
  );
}

async function hiddenScrapeClaim(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Scrape"]');
    const pane = tab?.getAttribute('aria-controls')
      ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    if (!pane) return { observable: false };
    const text = pane.innerText ?? '';
    return { observable: true,
      priorClaimVisible: text.includes('This page is a Source · saved') ||
        text.includes('Open this Source (opens in the web app)') ||
        [...pane.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Saved') };
  })()`,
  );
}

async function scrapeState(panel) {
  return evaluate(
    panel,
    `(() => {
    const tab = document.querySelector('button[role="tab"][title="Scrape"]');
    const pane = tab?.getAttribute('aria-controls')
      ? document.getElementById(tab.getAttribute('aria-controls')) : null;
    const linked = tab?.getAttribute('aria-selected') === 'true' &&
      pane?.getAttribute('aria-labelledby') === tab.id &&
      pane?.getAttribute('data-state') === 'active';
    if (!linked) return { linked: false };
    const text = pane.innerText ?? '';
    const buttons = [...pane.querySelectorAll('button')].map((button) => ({
      text: button.textContent.trim(), disabled: button.disabled,
    }));
    const has = (label) => buttons.some((button) => button.text === label && !button.disabled);
    const sourceBanner = [...pane.querySelectorAll('span')]
      .some((node) => node.textContent.trim().startsWith('This page is a Source · saved'));
    return {
      linked: true,
      notSaved: !!pane.querySelector('[data-testid="not-yet-a-source"]'),
      savedBanner: sourceBanner,
      checkUnknown: text.includes("Couldn't check whether this page is already a Source") ||
        text.includes('Choose your organization in the AI Matrx panel'),
      chooseWorkspace: text.includes('Choose your organization in the AI Matrx panel'),
      save: has('Save'), saved: has('Saved'),
      captureAction: has('Capture this page'),
      openSource: has('Open this Source (opens in the web app)'),
      openRecognized: has('Open (web app)'),
      captureBusy: text.includes('Capturing…'),
      saveBusy: buttons.some((button) => button.text === 'Save' && button.disabled),
    };
  })()`,
  );
}

// A prior Save attempt has an ambiguous pointer boundary. A new run may
// inspect the public capture's Save target, but must never send Save input.
async function inspectSavePointerWithoutInput(panel) {
  return evaluate(
    panel,
    `(() => {
      const trigger = document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
      const paneId = trigger?.getAttribute('aria-controls');
      const pane = paneId ? document.getElementById(paneId) : null;
      const candidates = [...document.querySelectorAll('button')]
        .filter((button) => button.textContent.trim() === 'Save');
      const visible = (button) => {
        const style = getComputedStyle(button), rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
          style.display !== 'none' && !button.closest('[inert]');
      };
      const visibleButtons = candidates.filter(visible);
      const target = visibleButtons.length === 1 ? visibleButtons[0] : null;
      if (!target) return {
        activeScrapePane: pane?.getAttribute('data-state') === 'active',
        exactButtonCount: candidates.length,
        visibleButtonCount: visibleButtons.length,
        uniqueTargetInActiveScrapePane: false,
        targetDisabled: null,
        targetHasArea: null,
        clippedTargetHasArea: null,
        centerHitsTarget: null,
        interiorHitCount: null,
        selectedPointAvailable: null,
        clippingAncestorCount: null,
      };
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = target.getBoundingClientRect();
      const bounds = { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
        right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) };
      let clippingAncestorCount = 0;
      for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
        const clips = (overflow) => /^(auto|scroll|hidden|clip)$/.test(overflow);
        if (clips(style.overflowX)) {
          bounds.left = Math.max(bounds.left, box.left + ancestor.clientLeft);
          bounds.right = Math.min(bounds.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (clips(style.overflowY)) {
          clippingAncestorCount++;
          bounds.top = Math.max(bounds.top, box.top + ancestor.clientTop);
          bounds.bottom = Math.min(bounds.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
      const hitsTarget = (point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return Boolean(hit && (hit === target || target.contains(hit)));
      };
      const describeHit = (hit) => {
        if (!hit) return null;
        const tag = hit.tagName?.toLowerCase();
        const role = hit.getAttribute?.('role');
        const slot = hit.getAttribute?.('data-slot');
        const box = hit.getBoundingClientRect();
        const style = getComputedStyle(hit);
        return {
          tag: ['button', 'div', 'span', 'svg', 'path', 'p', 'section', 'header', 'main']
            .includes(tag) ? tag : 'other',
          role: ['dialog', 'alertdialog', 'alert', 'tab', 'tablist', 'tabpanel', 'button']
            .includes(role) ? role : 'other_or_none',
          slot: ['dialog-content', 'dialog-overlay', 'alert-dialog-content',
            'alert-dialog-overlay', 'popover-content', 'tooltip-content']
            .includes(slot) ? slot : 'other_or_none',
          inActiveScrapePane: pane?.contains(hit) === true,
          inDialog: Boolean(hit.closest('[role="dialog"], [role="alertdialog"]')),
          position: ['static', 'relative', 'absolute', 'fixed', 'sticky']
            .includes(style.position) ? style.position : 'other',
          rect: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
      };
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const points = [];
      if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
        for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75])
          points.push({ x: bounds.left + (bounds.right - bounds.left) * fx,
            y: bounds.top + (bounds.bottom - bounds.top) * fy });
      }
      const interiorHitCount = points.filter(hitsTarget).length;
      const firstBlockedPoint = points.find((point) => !hitsTarget(point)) ?? null;
      return {
        activeScrapePane: pane?.getAttribute('data-state') === 'active',
        exactButtonCount: candidates.length,
        visibleButtonCount: visibleButtons.length,
        uniqueTargetInActiveScrapePane: pane?.contains(target) === true,
        targetDisabled: Boolean(target.disabled),
        targetHasArea: rect.width > 0 && rect.height > 0,
        clippedTargetHasArea: bounds.right > bounds.left && bounds.bottom > bounds.top,
        centerHitsTarget: hitsTarget(center),
        interiorHitCount,
        selectedPointAvailable: interiorHitCount > 0,
        clippingAncestorCount,
        viewport: { width: innerWidth, height: innerHeight },
        targetRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        clippedRect: { x: bounds.left, y: bounds.top,
          width: Math.max(0, bounds.right - bounds.left),
          height: Math.max(0, bounds.bottom - bounds.top) },
        targetPointerEventsNone: getComputedStyle(target).pointerEvents === 'none',
        centerOccluder: describeHit(document.elementFromPoint(center.x, center.y)),
        firstInteriorOccluder: firstBlockedPoint
          ? describeHit(document.elementFromPoint(firstBlockedPoint.x, firstBlockedPoint.y)) : null,
      };
    })()`,
  );
}

// Observe the request made by the real recognition hook. Its UI can say
// "not yet" without a request when no token exists, so the Save gate also
// requires one scoped 200 response with an empty result for this exact URL.
async function watchScopedLookup(panel, fixture, organizationId, { allowRepeated = false } = {}) {
  await panel.send('Network.enable');
  const requests = new Map();
  const expectedIdentity =
    fixture.endsWith('/') && fixture.split('/').length > 4 ? fixture.slice(0, -1) : fixture;
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      const query = url.searchParams;
      if (request?.method !== 'GET' || !url.pathname.endsWith('/processed_documents')) return;
      if (
        query.get('canonical_identity') !== `eq.${expectedIdentity}` ||
        query.get('organization_id') !== `eq.${organizationId}` ||
        query.get('origin_client') !== 'eq.extension' ||
        query.get('derivation_kind') !== 'in.(initial_extract,recapture)' ||
        query.get('deleted_at') !== 'is.null'
      )
        return;
      requests.set(requestId, { status: null, verdict: null });
    } catch {
      // Unrelated or malformed transport cannot authorize a write.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    if (requests.has(requestId)) requests.get(requestId).status = response?.status ?? null;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const request = requests.get(requestId);
    if (!request) return;
    if (request.status !== 200) {
      request.verdict = 'unknown';
      return;
    }
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        try {
          const raw = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
          const rows = JSON.parse(raw);
          request.verdict = Array.isArray(rows)
            ? rows.length === 0
              ? 'none'
              : 'found'
            : 'unknown';
        } catch {
          request.verdict = 'unknown';
        }
      })
      .catch(() => {
        request.verdict = 'unknown';
      });
  });
  return {
    read: () => {
      const verdicts = [...requests.values()].map((request) => request.verdict);
      if (!allowRepeated) return verdicts.length === 1 ? verdicts[0] : null;
      if (verdicts.length === 0 || verdicts.includes(null)) return null;
      if (verdicts.every((verdict) => verdict === 'none')) return 'none';
      if (verdicts.every((verdict) => verdict === 'found')) return 'found';
      return 'unknown';
    },
    stop: () => {
      offRequest();
      offResponse();
      offFinished();
    },
  };
}

// Observe every processed_documents GET while no workspace is selected. Only
// counts leave this function; request URLs, query IDs and auth headers do not.
async function watchNoWorkspaceSourceLookup(panel) {
  await panel.send('Network.enable');
  const seen = { processedDocumentsGets: 0, unscopedGets: 0 };
  const off = panel.on('Network.requestWillBeSent', ({ request }) => {
    try {
      const url = new URL(request?.url);
      if (request?.method !== 'GET' || !url.pathname.endsWith('/processed_documents')) return;
      seen.processedDocumentsGets += 1;
      if (!url.searchParams.has('organization_id')) seen.unscopedGets += 1;
    } catch {
      // Malformed unrelated traffic never becomes evidence of a valid lookup.
    }
  });
  return { read: () => ({ ...seen }), stop: off };
}

async function privateScopeScreenshot(panel) {
  try {
    await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
    const shot = await panel.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const path = join(REPO, 'test-results', `d22-scope-${randomUUID()}.png`);
    await writeFile(path, Buffer.from(shot.data, 'base64'), { flag: 'wx', mode: 0o600 });
    return 'captured_private';
  } catch {
    return 'unavailable';
  }
}

async function runReadOnlyScope(panel, page) {
  const fixture = FIXTURES[0];
  const scope = report.observations.d22Scope;
  report.mode = 'read_only_scope';
  const approvedName = await privateApprovedOrganization();

  stage = 'd22_no_workspace_ui';
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Organization');
  const before = await waitFor(
    'source_scope_no_workspace_picker',
    () => organizationState(panel, approvedName),
    (state) => state?.controlCount === 1 && state.displayed === 'Choose…' && !state.storedId,
  );
  if (before.storedId) fail('source_scope_workspace_already_selected');
  const noWorkspaceTraffic = await watchNoWorkspaceSourceLookup(panel);
  try {
    stage = 'd22_no_workspace_recognition';
    await page.goto(fixture, { waitUntil: 'load', timeout: 60_000 });
    if (page.url() !== fixture) fail('source_scope_public_fixture_redirected');
    await click(panel, 'title', 'Scrape');
    await waitFor(
      'source_scope_unknown_ui',
      () => scrapeState(panel),
      (state) => state?.linked && state.chooseWorkspace && !state.savedBanner && !state.openSource,
      30_000,
    );
    // Absence is the behavior under test: observe a bounded quiet interval
    // after the real panel reaches its settled unknown state.
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
    const settled = await scrapeState(panel);
    const traffic = noWorkspaceTraffic.read();
    scope.noWorkspaceNetwork = traffic;
    if (!settled.linked || !settled.chooseWorkspace || settled.savedBanner || settled.openSource)
      fail('source_scope_unknown_ui_not_settled');
    if (traffic.unscopedGets !== 0 || traffic.processedDocumentsGets !== 0)
      fail('source_scope_lookup_sent_without_workspace');
    scope.noWorkspaceUi = 'choose_workspace_unknown';
    scope.noWorkspaceLookup = 'no_processed_documents_get';
  } finally {
    noWorkspaceTraffic.stop();
  }

  stage = 'd22_approved_organization_selection';
  const approved = await chooseOrganization(panel, approvedName, approvedName);
  if (!approved.storedId) fail('source_scope_approved_org_id_unavailable');
  report.observations.approvedExistingOrganizationSelectedByUi = true;

  stage = 'd22_scoped_recognition';
  const scopedLookup = await watchScopedLookup(panel, fixture, approved.storedId, {
    allowRepeated: true,
  });
  try {
    await page.goto(fixture, { waitUntil: 'load', timeout: 60_000 });
    if (page.url() !== fixture) fail('source_scope_public_fixture_redirected');
    await click(panel, 'title', 'Scrape');
    const network = await waitFor(
      'source_scope_scoped_200_empty_lookup',
      scopedLookup.read,
      (result) => result === 'none' || result === 'found' || result === 'unknown',
      30_000,
    );
    scope.scopedNetwork = { exactWorkspaceLookup200Empty: network === 'none' };
    if (network !== 'none') fail('source_scope_scoped_lookup_not_empty_200');
    const ui = await waitFor(
      'source_scope_not_saved_ui',
      () => scrapeState(panel),
      (state) => state?.linked && (state.notSaved || state.savedBanner || state.checkUnknown),
      30_000,
    );
    if (!ui.notSaved || ui.savedBanner || ui.checkUnknown || ui.openSource || ui.openRecognized)
      fail('source_scope_not_saved_ui_mismatch');
    scope.scopedLookup = 'exact_workspace_200_empty';
    scope.scopedUi = 'not_saved';
  } finally {
    scopedLookup.stop();
  }
  stage = 'd22_read_only_complete';
  report.status = 'bounded_pass';
}

async function sourceIdFromRealUi(panel, page, label) {
  const openedPromise = page.context().waitForEvent('page', { timeout: 30_000 });
  await click(panel, 'button', label);
  const opened = await openedPromise;
  try {
    await opened.waitForURL(
      (url) =>
        SOURCE_ORIGINS.has(url.origin) &&
        url.pathname.startsWith('/knowledge/sources/') &&
        UUID.test(url.pathname.split('/').at(-1) ?? ''),
      { timeout: 30_000 },
    );
    const url = new URL(opened.url());
    if (!url.pathname.startsWith('/knowledge/sources/')) fail('source_link_wrong_path');
    const id = url.pathname.split('/').at(-1);
    if (!UUID.test(id ?? '')) fail('source_link_missing_id');
    return id;
  } finally {
    await opened.close();
  }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function reserveSaveAttempt(organizationId, fixture) {
  await mkdir(join(REPO, 'test-results'), { recursive: true, mode: 0o700 });
  await syncDirectory(REPO);
  let handle;
  try {
    handle = await open(ATTEMPT, 'wx', 0o600);
  } catch {
    fail('save_attempt_already_exists_or_unavailable');
  }
  try {
    await handle.writeFile(
      `${JSON.stringify({
        schema: 1,
        phase: 'reserved',
        organizationId,
        fixtureSha256: createHash('sha256').update(fixture).digest('hex'),
      })}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(join(REPO, 'test-results'));
  report.observations.checkpointDurableBeforeSave = true;
}

async function existingSaveAttempt(organizationId) {
  let stat;
  try {
    stat = await lstat(ATTEMPT);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('save_checkpoint_unavailable');
  }
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) fail('save_checkpoint_not_private_file');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(ATTEMPT, 'utf8'));
  } catch {
    fail('save_checkpoint_unreadable');
  }
  if (
    parsed?.schema !== 1 ||
    !['reserved', 'source_link_observed'].includes(parsed.phase) ||
    parsed.organizationId !== organizationId ||
    typeof parsed.fixtureSha256 !== 'string'
  )
    fail('save_checkpoint_mismatch');
  const matches = FIXTURES.filter(
    (fixture) => createHash('sha256').update(fixture).digest('hex') === parsed.fixtureSha256,
  );
  if (matches.length !== 1) fail('save_checkpoint_fixture_mismatch');
  if (parsed.sourceId !== undefined && !UUID.test(parsed.sourceId))
    fail('save_checkpoint_source_id_invalid');
  if (
    (parsed.phase === 'reserved' && parsed.sourceId !== undefined) ||
    (parsed.phase === 'source_link_observed' && !parsed.sourceId)
  )
    fail('save_checkpoint_phase_id_mismatch');
  return { phase: parsed.phase, fixture: matches[0], sourceId: parsed.sourceId ?? null };
}

async function recordObservedSourceId(id) {
  if (!UUID.test(id)) fail('observed_source_id_invalid');
  const existing = JSON.parse(await readFile(ATTEMPT, 'utf8'));
  if (existing.phase !== 'reserved') fail('save_checkpoint_phase_mismatch');
  const temp = `${ATTEMPT}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({ ...existing, phase: 'source_link_observed', sourceId: id })}\n`,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, ATTEMPT);
  await syncDirectory(join(REPO, 'test-results'));
}

async function readBuildIdentity() {
  const [receipt, manifest] = await Promise.all([
    readFile(RELEASE_RECEIPT, 'utf8').then(JSON.parse),
    readFile(MANIFEST, 'utf8').then(JSON.parse),
  ]);
  if (receipt.version !== manifest.version || !/^[a-f0-9]{64}$/.test(receipt.treeSha256 ?? ''))
    fail('release_manifest_identity_mismatch');
  return { version: manifest.version, treeSha256: receipt.treeSha256 };
}

try {
  report.build = await readBuildIdentity();
  const buildAtStart = report.build;
  const nativeResult = await runNativeSidepanelQa({
    exercisePanel: async ({ page, panel }) => {
      stage = 'real_admin_signin';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Account');
      const web = await realWebSignIn(page);
      try {
        await click(panel, 'button', 'Sign in');
        await waitFor(
          'real_admin_identity',
          () => adminState(panel),
          (state) => state?.emailMatch && state.adminRole && state.signOutVisible,
          90_000,
        );
        report.observations.realAdminUi = true;
      } finally {
        await web.close();
      }

      const initialSettings = await protectedSettings(panel);
      if (!initialSettings.portAuto || !initialSettings.optionalPermissionsOff)
        fail('isolated_settings_baseline_not_intact');
      report.observations.protectedSettingsAtEntry = true;

      if (SOURCE_READONLY_SCOPE) {
        try {
          await runReadOnlyScope(panel, page);
        } catch (error) {
          report.observations.d22Scope.privateScreenshot = await privateScopeScreenshot(panel);
          throw error;
        }
        return;
      }

      stage = 'd23_notice_before_organization_selection';
      // The initial Capture queue is read-only. A bounded condition wait
      // allows its honest refusal to arrive without manufacturing it.
      const initialNotice = await waitFor(
        'initial_no_workspace_capture_notice',
        () => noWorkspaceCaptureNoticeCount(panel),
        (count) => count > 0,
        5_000,
      ).catch(() => noWorkspaceCaptureNoticeCount(panel));
      report.observations.d23.noWorkspaceNoticeBeforeSelection =
        initialNotice === 1 ? 'observed' : initialNotice === 0 ? 'not_observed' : 'ambiguous';

      const approvedName = await privateApprovedOrganization();
      stage = 'approved_organization_selection';
      const approved = await chooseOrganization(panel, approvedName, approvedName);
      const approvedId = approved.storedId;
      if (!approvedId) fail('approved_org_id_unavailable');
      report.observations.approvedExistingOrganizationSelectedByUi = true;

      stage = 'd23_notice_after_organization_selection';
      const noticeAfterSelection = await waitFor(
        'no_workspace_capture_notice_retired',
        () => noWorkspaceCaptureNoticeCount(panel),
        (count) => count === 0,
        10_000,
      ).catch(() => noWorkspaceCaptureNoticeCount(panel));
      report.observations.d23.noWorkspaceNoticeAfterSelection =
        noticeAfterSelection === 0 ? 'absent' : 'still_present';

      const checkpoint = await existingSaveAttempt(approvedId);
      if (D23_READ_ONLY && !checkpoint) fail('d23_existing_save_checkpoint_required');
      report.mode = checkpoint ? 'read_only_recovery' : 'single_save_attempt';
      let sourceId;
      if (checkpoint) {
        stage = 'read_only_recovery_lookup';
        report.observations.saveResult = 'prior_attempt_ambiguous_no_retry';
        const lookup = await watchScopedLookup(panel, checkpoint.fixture, approvedId);
        try {
          await page.goto(checkpoint.fixture, { waitUntil: 'load', timeout: 60_000 });
          if (page.url() !== checkpoint.fixture) fail('recovery_public_fixture_redirected');
          await click(panel, 'title', 'Scrape');
          const network = await waitFor(
            'recovery_scoped_recognition_network_result',
            lookup.read,
            (result) => result === 'none' || result === 'found' || result === 'unknown',
            30_000,
          );
          report.observations.recoveryLookup = network;
          if (network === 'none') {
            stage = 'read_only_save_pointer_diagnostic';
            await click(panel, 'button', 'Capture this page');
            await waitFor(
              'public_capture_ready_for_pointer_inspection',
              () => scrapeState(panel),
              (state) => state?.linked && state.save && state.notSaved && !state.checkUnknown,
              60_000,
            );
            report.observations.readOnlySavePointer = await inspectSavePointerWithoutInput(panel);
            const pointer = report.observations.readOnlySavePointer;
            report.observations.d23.savePointerAfterPublicCapture =
              pointer.activeScrapePane &&
              pointer.uniqueTargetInActiveScrapePane &&
              pointer.targetDisabled === false &&
              pointer.clippedTargetHasArea &&
              pointer.selectedPointAvailable
                ? 'hit_testable'
                : 'not_hit_testable';
            report.observations.d23.readOnlyAcceptance =
              report.observations.d23.noWorkspaceNoticeBeforeSelection === 'observed' &&
              report.observations.d23.noWorkspaceNoticeAfterSelection === 'absent' &&
              report.observations.d23.savePointerAfterPublicCapture === 'hit_testable'
                ? 'observed'
                : 'unverified';
            try {
              const shot = await panel.send('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
              });
              await writeFile(PRIVATE_POINTER_SCREENSHOT, Buffer.from(shot.data, 'base64'), {
                flag: 'wx',
                mode: 0o600,
              });
              report.observations.privatePointerScreenshot = 'captured_private';
            } catch {
              report.observations.privatePointerScreenshot = 'unavailable';
            }
            fail('prior_save_absent_pointer_diagnosed_no_retry');
          }
          if (network !== 'found') fail('recovery_source_not_definitively_found');
          const recovered = await waitFor(
            'recovery_source_ui',
            () => scrapeState(panel),
            (state) => state?.linked && (state.savedBanner || state.checkUnknown || state.notSaved),
            30_000,
          );
          if (recovered.checkUnknown || !recovered.savedBanner || !recovered.openRecognized)
            fail('recovery_source_ui_unverified');
          sourceId = await sourceIdFromRealUi(panel, page, 'Open (web app)');
          if (checkpoint.sourceId && checkpoint.sourceId !== sourceId)
            fail('recovery_source_id_mismatch');
          if (!checkpoint.sourceId) await recordObservedSourceId(sourceId);
          report.observations.recoveryLookup = 'found_with_matching_ui_and_link';
        } finally {
          lookup.stop();
        }
      } else {
        let fixture = null;
        for (const candidate of FIXTURES) {
          stage = 'public_fixture_lookup';
          const lookup = await watchScopedLookup(panel, candidate, approvedId);
          try {
            await page.goto(candidate, { waitUntil: 'load', timeout: 60_000 });
            if (page.url() !== candidate) fail('public_fixture_redirected');
            await click(panel, 'title', 'Scrape');
            const network = await waitFor(
              'scoped_recognition_network_result',
              lookup.read,
              (result) => result === 'none' || result === 'found' || result === 'unknown',
              30_000,
            );
            if (network === 'unknown') fail('source_lookup_network_unknown');
            const state = await waitFor(
              'scoped_source_lookup_ui',
              () => scrapeState(panel),
              (s) =>
                s?.linked &&
                (s.checkUnknown ||
                  (network === 'none' && s.notSaved && !s.savedBanner) ||
                  (network === 'found' && s.savedBanner)),
              30_000,
            );
            if (state.checkUnknown) fail('source_lookup_ui_unknown');
            if (network === 'none' && state.notSaved && !state.savedBanner) {
              fixture = candidate;
              break;
            }
          } finally {
            lookup.stop();
          }
        }
        if (!fixture) fail('allowed_fixtures_already_saved');
        report.observations.fixtureLookup = 'definitively_not_saved';

        stage = 'public_capture';
        await click(panel, 'button', 'Capture this page');
        await waitFor(
          'capture_ready_for_save',
          () => scrapeState(panel),
          (state) => state?.linked && state.save && state.notSaved && !state.checkUnknown,
          60_000,
        );
        if (page.url() !== fixture) fail('public_page_changed_before_save');
        const preSave = await scrapeState(panel);
        if (!preSave.save || !preSave.notSaved || preSave.savedBanner || preSave.checkUnknown)
          fail('pre_save_ui_not_definitive');
        const selectedBeforeSave = await evaluate(
          panel,
          `(async () => (await chrome.storage.local.get('matrx.org.active'))['matrx.org.active']?.id ?? null)()`,
        );
        if (selectedBeforeSave !== approvedId) fail('approved_org_changed_before_save');

        stage = 'reserve_save_attempt';
        await reserveSaveAttempt(approvedId, fixture);
        stage = 'one_save_click';
        report.observations.saveAttemptReserved = true;
        report.observations.pointerDispatch = 'unknown';
        await click(panel, 'button', 'Save');
        report.observations.pointerDispatch = 'press_and_release_returned';
        stage = 'save_result';
        const saved = await waitFor(
          'saved_source_and_open_link',
          () => scrapeState(panel),
          (state) => state?.linked && state.saved && state.openSource,
          60_000,
        );
        if (!saved.saved || !saved.openSource) fail('save_result_ambiguous');
        sourceId = await sourceIdFromRealUi(panel, page, 'Open this Source (opens in the web app)');
        await recordObservedSourceId(sourceId);
        report.observations.saveResult = 'definitive_success';
        report.observations.localSavedAndOpenSource = 'pass';
      }

      stage = 'approved_recognition_reopen';
      await click(panel, 'title', 'Settings');
      await click(panel, 'title', 'Scrape');
      const recognized = await waitFor(
        'saved_recognition_in_approved_org',
        () => scrapeState(panel),
        (state) => state?.linked && state.savedBanner && state.openRecognized,
        30_000,
      );
      if (!recognized.savedBanner) fail('approved_recognition_absent');
      const recognizedId = await sourceIdFromRealUi(panel, page, 'Open (web app)');
      if (recognizedId !== sourceId) fail('approved_recognition_wrong_source');

      stage = 'comparison_organization_switch';
      await click(panel, 'title', 'Settings');
      await openSection(panel, 'Organization');
      await click(panel, 'organization', 'Acting as');
      const offered = await organizationState(panel, approvedName);
      if (offered.otherOptions.length < 1) fail('comparison_organization_unavailable');
      const otherName = offered.otherOptions[0];
      let switched = false;
      try {
        // A dispatched selection may take effect even if its follow-up read
        // fails. Restoration is still mandatory in that ambiguous case.
        switched = true;
        await click(panel, 'option', otherName);
        const other = await waitFor(
          'comparison_organization_selected',
          () => organizationState(panel, approvedName),
          (state) =>
            state?.displayed === otherName && Boolean(state.storedId) && !state.storedApproved,
        );
        if (!other.storedId || other.storedId === approvedId) fail('comparison_org_not_distinct');
        report.observations.comparisonOrganization = 'selected_existing_by_ui';
        const immediate = await hiddenScrapeClaim(panel);
        if (immediate.observable) {
          if (immediate.priorClaimVisible) fail('prior_source_claim_visible_immediately');
          report.observations.immediateClaimClear = 'pass';
        }
        await click(panel, 'title', 'Scrape');
        const comparison = await waitFor(
          'comparison_recognition_settled',
          () => scrapeState(panel),
          (state) => state?.linked && (state.notSaved || state.savedBanner || state.checkUnknown),
          30_000,
        );
        if (comparison.checkUnknown) fail('comparison_lookup_unknown');
        if (comparison.openSource) fail('prior_local_source_claim_visible_in_comparison');
        if (comparison.savedBanner && comparison.openRecognized) {
          const otherId = await sourceIdFromRealUi(panel, page, 'Open (web app)');
          if (otherId === sourceId) fail('prior_source_visible_in_comparison');
          report.observations.comparisonRecognition = 'different_existing_source';
        } else if (comparison.notSaved && !comparison.savedBanner && !comparison.openRecognized) {
          report.observations.comparisonRecognition = 'not_saved';
        } else fail('comparison_recognition_not_definitive');
      } finally {
        if (switched) {
          stage = 'approved_organization_restore';
          try {
            const restored = await chooseOrganization(panel, approvedName, approvedName);
            if (restored.storedId !== approvedId) fail('approved_org_restore_wrong_id');
            report.observations.approvedOrganizationRestored = 'selected_by_ui';
          } catch {
            report.observations.approvedOrganizationRestored = 'unverified';
          }
        }
      }
      if (report.observations.approvedOrganizationRestored !== 'selected_by_ui')
        fail('approved_org_restore_unverified');
      stage = 'approved_recognition_after_return';
      await click(panel, 'title', 'Scrape');
      const afterReturn = await waitFor(
        'approved_source_recognized_again',
        () => scrapeState(panel),
        (state) => state?.linked && state.savedBanner && state.openRecognized,
        30_000,
      );
      if (!afterReturn.savedBanner) fail('approved_source_not_restored');
      const afterReturnId = await sourceIdFromRealUi(panel, page, 'Open (web app)');
      if (afterReturnId !== sourceId) fail('approved_source_wrong_after_return');
      report.observations.approvedOrganizationRestored = 'pass';
      stage = 'protected_settings_after_run';
      await click(panel, 'title', 'Settings');
      const finalSettings = await protectedSettings(panel);
      await openSection(panel, 'Account');
      const finalAdmin = await adminState(panel);
      if (
        !finalSettings.portAuto ||
        !finalSettings.optionalPermissionsOff ||
        !finalAdmin.emailMatch ||
        !finalAdmin.adminRole ||
        !finalAdmin.signOutVisible
      )
        fail('isolated_settings_baseline_changed');
      report.observations.protectedSettingsAtExit = true;
      report.status = 'partial';
    },
  });
  const buildAtEnd = await readBuildIdentity();
  if (
    buildAtEnd.version !== buildAtStart.version ||
    buildAtEnd.treeSha256 !== buildAtStart.treeSha256
  )
    fail('release_build_changed_during_run');
  report.build = SOURCE_READONLY_SCOPE
    ? buildAtEnd
    : { ...buildAtEnd, extensionId: nativeResult.extensionId };
} catch (error) {
  report.status =
    stage === 'read_only_save_pointer_diagnostic' && report.observations.readOnlySavePointer
      ? 'diagnostic_only'
      : 'unverified';
  report.failureStage = stage;
  report.failureCode ??= 'stage_failed';
  if (stage === 'one_save_click') {
    const allowedCodes = new Set([
      'pointer_initial_evaluation_failed',
      'pointer_page_sample_failed',
      'pointer_target_not_unique',
      'pointer_followup_evaluation_failed',
      'pointer_stable_hit_not_observed',
      'pointer_press_dispatch_failed',
      'pointer_release_dispatch_failed',
    ]);
    const driver = error?.driverFailure;
    if (allowedCodes.has(driver?.code)) {
      report.pointerDiagnostic = {
        code: driver.code,
        matchedTargetCount: Number.isInteger(driver.matchedTargetCount)
          ? driver.matchedTargetCount
          : null,
        visibleMatchCount: Number.isInteger(driver.visibleMatchCount)
          ? driver.visibleMatchCount
          : null,
        hitTarget: driver.hitTarget === true,
        stableSamples: Number.isInteger(driver.stableSamples) ? driver.stableSamples : null,
      };
      if (driver.code === 'pointer_release_dispatch_failed')
        report.observations.pointerDispatch = 'press_returned_release_unknown';
      else if (driver.code !== 'pointer_press_dispatch_failed')
        report.observations.pointerDispatch = 'pre_dispatch_failure';
    }
  }
  if (
    report.observations.saveAttemptReserved &&
    report.observations.saveResult !== 'definitive_success'
  )
    report.observations.saveResult = 'ambiguous_no_retry';
  process.exitCode = 1;
}
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${report.status.toUpperCase()} d22_source_workspace_native\n`);
