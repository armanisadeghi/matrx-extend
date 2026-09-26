/* Real browser acceptance for a declared extension artifact and production Vault
 * API. It starts a private localhost login page; all website secrets are random
 * process values and are intentionally absent from proof, logs, and screenshots. */
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  observeDelayedCaptureDecisionSettlement,
} = require('./vault-capture-decision-settlement.cjs');
const { createRequire } = require('node:module');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { acquireVaultAcceptanceLease } = require('./vault-acceptance-lease.cjs');
const {
  FAILED_PROOF_PATH: reconciledChromeProofPath,
  verifyHistoricalChromeReconciliation,
} = require('./vault-historical-reconciliation.cjs');
const {
  FAILED_PROOF_PATH: recovered7356ProofPath,
  verify7356RecoveryAdmission,
  NO_COMMIT_PROOF_PATH,
  verifyNoCommitRecovery,
} = require('./vault-7356-reconciliation.cjs');
const { assertRequestedLifecycleVerdicts } = require('./vault-lifecycle-verdict.cjs');
const { assertVaultExtensionLifecycleVerdict } = require('./vault-extension-lifecycle-verdict.cjs');
const { runOwnedBrowserRestart } = require('./vault-extension-browser-restart-acceptance.cjs');
const { runOrganizationSwitchOfferProbe } = require('./vault-organization-switch-offer.cjs');
const {
  inspectIdentity,
  sameLifecycleIdentity,
  runExtensionDisableEnable,
  runExtensionReload,
  runSettingsSignOut,
  visibleSettingsControl,
  visibleVaultControl,
} = require('./vault-extension-lifecycle-acceptance.cjs');
const { observeOwnedPanelLogout } = require('./vault-lifecycle-network-observation.cjs');
const {
  hasObservedReadOnlyCleanup,
  hasPreAuthNoWriteCleanup,
  hasPreBaselineAuthenticatedCleanup,
} = require('./vault-readonly-cleanup.cjs');
const {
  cleanupReceiptOwnedFallback,
  createDistributedReceiptCleanupRequest,
  isKnownLocalAdapterBootTypeError,
} = require('./vault-receipt-cleanup-fallback.cjs');
const {
  runSavedLoginChecks,
  renderSavedLoginFixtureHTML,
} = require('./vault-saved-login-acceptance.cjs');
const { runRealSiteFillChecks } = require('./vault-real-site-fill-acceptance.cjs');
const { runSavedFormMatrix, renderSavedFormMatrixHTML } = require('./vault-saved-form-matrix.cjs');
const { runVaultPreferencesChecks } = require('./vault-preferences-acceptance.cjs');
const {
  runVaultSetupRecoveryChecks,
  runVaultListTransportRecoveryChecks,
  renderVaultSetupRecoveryFixtureHTML,
  vaultSetupRecoveryFixturePath,
} = require('./vault-setup-recovery-acceptance.cjs');
const {
  runPasswordChangeCaptureChecks,
  renderPasswordChangeFixtureHTML,
} = require('./vault-password-change-acceptance.cjs');
const { classifyVaultRequest, createVaultNetworkJournal } = require('./vault-network-journal.cjs');
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const { runCaptureDecisionChecks } = require('./vault-capture-decisions-acceptance.cjs');
const { createAuthenticatorPreservation } = require('./vault-authenticator-preservation.cjs');
const { createVaultSaveResponseLoss } = require('./vault-save-response-loss.cjs');
const { createFixtureSetupWithRetry } = require('./vault-fixture-create-retry.cjs');
// The extension deliberately does not ship Playwright.  Use an explicit test
// runtime override or the documented workspace harness dependency.
const playwrightRequire = createRequire(
  process.env.MATRX_VAULT_CANARY_PLAYWRIGHT_PACKAGE ||
    '/Users/armanisadeghi/code/matrx-frontend/package.json',
);
let chromium;
try {
  ({ chromium } = playwrightRequire('playwright'));
} catch {
  throw new Error('playwright_runtime_unavailable');
}
const execFileAsync = promisify(execFile);

const EDGE_BROWSER_MODE = 'EDGE_153_OWNED_HEADLESS';
const edgeBrowserMode = process.env.MATRX_VAULT_CANARY_BROWSER === EDGE_BROWSER_MODE;
if (process.env.MATRX_VAULT_CANARY_BROWSER && !edgeBrowserMode)
  throw new Error('browser_mode_invalid');
const API = 'https://server.app.matrxserver.com';
const DB = 'https://db.matrxserver.com';
const REPO = path.resolve(__dirname, '../..');
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeVaultStackLocations = (stack) =>
  String(stack || '')
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/vault-[A-Za-z0-9._-]+\.cjs:\d+:\d+/);
      return match ? [match[0]] : [];
    });

async function readOAuthPageSnapshot(authPage, timeoutMs = 1000) {
  return Promise.race([
    authPage.evaluate(() => {
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getAttribute('aria-hidden') !== 'true'
        );
      };
      const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
      const authorize = buttons.filter((button) => button.textContent?.trim() === 'Authorize');
      const retry = buttons.filter((button) => button.textContent?.trim() === 'Try again');
      const loginForm =
        document.querySelector('#password')?.form || document.querySelector('#email')?.form;
      const loginSubmit = Array.from(
        loginForm?.querySelectorAll('button, input[type="submit"]') || [],
      ).filter((control) => {
        if (!visible(control)) return false;
        return control.tagName === 'BUTTON' ? control.type === 'submit' : control.type === 'submit';
      });
      const headings = Array.from(document.querySelectorAll('h2'))
        .filter(visible)
        .map((heading) => heading.textContent?.trim() || '');
      return {
        emailVisible: visible(document.querySelector('#email')),
        passwordVisible: visible(document.querySelector('#password')),
        authorizeCount: authorize.length,
        enabledAuthorizeCount: authorize.filter((button) => !button.disabled).length,
        retryCount: retry.length,
        loginSubmitCount: loginSubmit.length,
        busyLoginSubmitCount: loginSubmit.filter(
          (control) => control.disabled || control.getAttribute('aria-busy') === 'true',
        ).length,
        visibleHeadings: headings,
      };
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('oauth_consent_dom_snapshot_timeout')), timeoutMs),
    ),
  ]);
}

function classifyOAuthRouteCategory(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.origin !== 'https://www.aimatrx.com') return 'external';
    if (url.pathname.startsWith('/oauth/consent')) return 'oauth_consent';
    if (url.pathname.startsWith('/auth/callback')) return 'auth_callback';
    if (/^\/(?:auth|login|sign-in)(?:\/|$)/.test(url.pathname)) return 'login';
    return 'aimatrx_other';
  } catch {
    return 'route_unavailable';
  }
}

function classifyOAuthPostPasswordForm(snapshot) {
  if (snapshot?.emailVisible !== true || snapshot?.passwordVisible !== true) return 'form_changed';
  if (snapshot.loginSubmitCount === 1 && snapshot.busyLoginSubmitCount === 1) return 'submit_busy';
  return 'form_unchanged';
}

// This observer is deliberately value-free. It records only route classes,
// HTTP status, and whether an error key exists; it never keeps a URL, query
// value, request/response body, cookie, or auth material.
function observeOAuthPostPasswordSubmission(authPage) {
  const responses = [];
  const onResponse = (response) => {
    try {
      const request = response.request();
      const headers = request.headers();
      const isServerAction = Object.keys(headers).some(
        (key) => key.toLowerCase() === 'next-action',
      );
      if (!isServerAction) return;
      responses.push({
        route: `${classifyOAuthRouteCategory(response.url())}_server_action`,
        status: response.status(),
      });
    } catch {
      // Unavailable response metadata must not leak into evidence or block cleanup.
    }
  };
  authPage.on('response', onResponse);
  return {
    async snapshot({ settleMs = 0 } = {}) {
      if (settleMs > 0) await wait(settleMs);
      let formState = 'form_snapshot_unavailable';
      try {
        formState = classifyOAuthPostPasswordForm(await readOAuthPageSnapshot(authPage));
      } catch {}
      let routeCategory = 'route_unavailable';
      let errorQueryParameterPresent = false;
      try {
        const url = new URL(authPage.url());
        routeCategory = classifyOAuthRouteCategory(url.href);
        errorQueryParameterPresent = url.searchParams.has('error');
      } catch {}
      const first = responses[0] || null;
      return {
        formState,
        routeCategory,
        errorQueryParameterPresent,
        serverActionResponse: first,
        serverActionResponseCount: responses.length,
      };
    },
    finish() {
      authPage.off('response', onResponse);
    },
  };
}

async function finalizeOAuthPostPasswordSubmission(observer, oauthUi, persist, failureCategory) {
  oauthUi.postPasswordSubmissionFinal = await observer.snapshot();
  if (failureCategory) oauthUi.failureCategory = failureCategory;
  persist();
  observer.finish();
}

async function failOAuthPostPasswordSubmission(observer, oauthUi, persist) {
  await finalizeOAuthPostPasswordSubmission(
    observer,
    oauthUi,
    persist,
    'oauth_login_form_submit_failed',
  );
  throw new Error('oauth_login_form_submit_failed');
}

async function submitOAuthPasswordWithDiagnostics(authPage, observer, oauthUi, persist) {
  try {
    await authPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    oauthUi.postPasswordSubmission = await observer.snapshot({ settleMs: 750 });
    persist();
  } catch {
    await failOAuthPostPasswordSubmission(observer, oauthUi, persist);
  }
}

function classifyOAuthConsentSnapshot(snapshot) {
  const oneEnabledAuthorize = snapshot.authorizeCount === 1 && snapshot.enabledAuthorizeCount === 1;
  const exactOneRetry = snapshot.retryCount === 1;
  const visibleHeadings = snapshot.visibleHeadings;
  const exactOneRedirecting = visibleHeadings.length === 1 && visibleHeadings[0] === 'Redirecting';
  const exactErrorTitles = new Set([
    'Invalid request',
    'We could not verify your sign-in',
    'Origin not authorized',
    'Request expired',
    'Too many requests',
    'Network error',
  ]);
  const exactOneErrorHeading =
    visibleHeadings.length === 1 &&
    (exactErrorTitles.has(visibleHeadings[0]) ||
      /^Authorization error \((?:unknown|\d{3})\)$/.test(visibleHeadings[0]));
  // Any competing rendered state or duplicate exact control is ambiguous.
  if (snapshot.authorizeCount > 1 || snapshot.retryCount > 1) return 'consent_ambiguous';
  if (exactOneRedirecting)
    return oneEnabledAuthorize || exactOneRetry ? 'consent_ambiguous' : 'redirecting';
  if (oneEnabledAuthorize)
    return exactOneRetry || exactOneErrorHeading ? 'consent_ambiguous' : 'consent_ready';
  if (exactOneRetry || exactOneErrorHeading) return 'consent_error';
  return 'consent_ambiguous';
}

function summarizeOAuthConsentSnapshot(authPage, snapshot) {
  const heading = snapshot.visibleHeadings.length === 1 ? snapshot.visibleHeadings[0] : null;
  const knownHeadingCategory =
    heading === 'Redirecting'
      ? 'redirecting'
      : [
            'Invalid request',
            'We could not verify your sign-in',
            'Origin not authorized',
            'Request expired',
            'Too many requests',
            'Network error',
          ].includes(heading) || /^Authorization error \((?:unknown|\d{3})\)$/.test(heading || '')
        ? 'known_error'
        : heading === null
          ? 'none_or_multiple'
          : 'other';
  return {
    routeCategory: classifyOAuthRouteCategory(authPage.url()),
    consentState: classifyOAuthConsentSnapshot(snapshot),
    emailVisible: snapshot.emailVisible,
    passwordVisible: snapshot.passwordVisible,
    authorizeCount: snapshot.authorizeCount,
    enabledAuthorizeCount: snapshot.enabledAuthorizeCount,
    retryCount: snapshot.retryCount,
    visibleHeadingCount: snapshot.visibleHeadings.length,
    knownHeadingCategory,
  };
}

async function recordOAuthConsentFailureSnapshot(authPage, oauthUi, persist) {
  try {
    oauthUi.consentFailureSnapshot = summarizeOAuthConsentSnapshot(
      authPage,
      await readOAuthPageSnapshot(authPage),
    );
    persist();
  } catch {
    oauthUi.consentFailureSnapshot = { snapshotUnavailable: true };
    try {
      persist();
    } catch {}
  }
}

function observeOAuthConsentApproval(authPage, dbOrigin, timeoutMs = 30000) {
  const observations = [];
  let settled = false;
  let resolveFirst;
  let rejectFirst;
  const firstResponse = new Promise((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  const onResponse = (response) => {
    try {
      const url = new URL(response.url());
      const method = response.request().method();
      if (
        url.origin !== dbOrigin ||
        method !== 'POST' ||
        !/^\/auth\/v1\/oauth\/authorizations\/[^/]+\/consent$/.test(url.pathname)
      )
        return;
      const observation = {
        route: 'oauth_authorization_consent',
        method: 'POST',
        status: response.status(),
        phase: 'after_authorize_click',
      };
      observations.push(observation);
      if (!settled && observation.status >= 200 && observation.status < 300) {
        settled = true;
        resolveFirst(observation);
      } else if (!settled) {
        settled = true;
        rejectFirst(new Error('oauth_consent_approval_non_2xx'));
      }
    } catch {
      // Unparseable unrelated response metadata is not OAuth consent evidence.
    }
  };
  authPage.on('response', onResponse);
  return {
    async requireFirst2xx() {
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectFirst(new Error('oauth_consent_approval_missing'));
        }
      }, timeoutMs);
      try {
        return await firstResponse;
      } finally {
        clearTimeout(timeout);
      }
    },
    finish() {
      authPage.off('response', onResponse);
      assert(observations.length === 1, 'oauth_consent_approval_count_invalid');
      const [observation] = observations;
      assert(
        observation.status >= 200 && observation.status < 300,
        'oauth_consent_approval_non_2xx',
      );
      return { ...observation, count: observations.length };
    },
  };
}

// A web SSO session can take the normal OAuth request directly to consent or
// complete the callback. Both remain bound to the extension's PKCE/state
// validation in auth/flow.ts and are accepted only after fresh extension
// storage and the independent /auth/v1/user check below agree on admin.
async function awaitOAuthRouteOrCallback({
  authPage,
  storage,
  adminEmail,
  allowLoginForm = false,
  deadlineMs = 35000,
}) {
  let timeout;
  const observation = (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if (!authPage.isClosed()) {
          const snapshot = await readOAuthPageSnapshot(authPage);
          if (allowLoginForm && snapshot.emailVisible && snapshot.passwordVisible)
            return 'password_form';
          const current = new URL(authPage.url());
          if (
            current.origin === 'https://www.aimatrx.com' &&
            current.pathname.startsWith('/oauth/consent')
          ) {
            const consent = classifyOAuthConsentSnapshot(snapshot);
            if (consent !== 'consent_ambiguous') return consent;
          }
        }
      } catch (error) {
        // A closed managed page may mean the callback is already progressing.
        // Every other observer failure is real and must not be swallowed into
        // another loop iteration.
        if (!authPage.isClosed()) throw error;
      }
      const session = await storage(['matrx.user.profile', 'matrx.auth.accessToken']);
      if (
        session?.['matrx.user.profile']?.email === adminEmail &&
        typeof session?.['matrx.auth.accessToken'] === 'string' &&
        session['matrx.auth.accessToken'].length > 20
      )
        return 'completed_callback';
      await wait(500);
    }
    throw new Error('oauth_consent_or_callback_timeout');
  })();
  try {
    return await Promise.race([
      observation,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('oauth_route_observation_deadline')),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function awaitOAuthCallbackStorage({ authPage, storage, adminEmail }) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await storage(['matrx.user.profile', 'matrx.auth.accessToken']);
    if (
      session?.['matrx.user.profile']?.email === adminEmail &&
      typeof session?.['matrx.auth.accessToken'] === 'string' &&
      session['matrx.auth.accessToken'].length > 20
    ) {
      return { callbackStorageObserved: true, authPageClosed: authPage.isClosed() === true };
    }
    await wait(500);
  }
  throw new Error('oauth_callback_storage_timeout');
}

let cdpWorkerMessageId = 0;
function exactCdpWorkerFacade(cdp, targetId) {
  return {
    evaluate: async (pageFunction, arg) => {
      const attachment = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
      const id = ++cdpWorkerMessageId;
      const expression = `(${pageFunction.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
      try {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cdp.off('Target.receivedMessageFromTarget', received);
            reject(new Error('generator_worker_cdp_evaluate_timeout'));
          }, 5000);
          const received = (event) => {
            if (event.sessionId !== attachment.sessionId) return;
            let message;
            try {
              message = JSON.parse(event.message);
            } catch {
              return;
            }
            if (message.id !== id) return;
            clearTimeout(timeout);
            cdp.off('Target.receivedMessageFromTarget', received);
            resolve(message);
          };
          cdp.on('Target.receivedMessageFromTarget', received);
          cdp
            .send('Target.sendMessageToTarget', {
              sessionId: attachment.sessionId,
              message: JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: { expression, awaitPromise: true, returnByValue: true },
              }),
            })
            .catch((error) => {
              clearTimeout(timeout);
              cdp.off('Target.receivedMessageFromTarget', received);
              reject(error);
            });
        });
        if (response.error || response.result?.exceptionDetails)
          throw new Error('generator_worker_cdp_evaluate_refused');
        return response.result?.result?.value;
      } finally {
        await cdp
          .send('Target.detachFromTarget', { sessionId: attachment.sessionId })
          .catch(() => {});
      }
    },
  };
}
const required = (key) => {
  const value = process.env[key];
  assert(typeof value === 'string' && value.length > 0, `missing_${key.toLowerCase()}`);
  return value;
};
const localCanonicalCleanupArmed =
  process.env.MATRX_VAULT_CANARY_LOCAL_CANONICAL_CLEANUP === 'RUN_LOCAL_CANONICAL_CLEANUP';
const lifecycleDryRun = process.argv.includes('--lifecycle-dry-run');
// This is deliberately a separate, explicitly armed mode.  It proves that a
// fresh extension can authenticate and establish its tenant context without
// making a Vault mutation; it is not a Save/Update acceptance result.
const readOnlyAdmissionMode =
  lifecycleDryRun || process.env.MATRX_VAULT_CANARY_ADMISSION === 'RUN_READ_ONLY_ADMISSION';
const receiptBackedSaveUpdateMode =
  process.env.MATRX_VAULT_CANARY_ADMISSION === 'RUN_RECEIPT_BACKED_SAVE_UPDATE';
// Receipt-backed Save/Update is limited to hash-pinned source artifacts.
// The release ZIP paths are bound to the bytes of
// its checked manifest as well as its declared identity; it is not evidence
// of Store publication or installation.
const RECEIPT_BACKED_FROZEN_SOURCE_COMMIT = 'a2b5aa7e1082330ab6658b07477b31ea3705ca72';
const RECEIPT_BACKED_LOCAL_RELEASE_ZIPS = new Map([
  [
    '3bad3aaea3d8906caff1f05504570145eb813c04',
    {
      manifestSha256: 'c395a10b2b8d6dfc42dc045f553a9098781eab3d33634e5a0a1a947f0bec8b9b',
      version: '0.2.38',
    },
  ],
  [
    'c4430ab5b19491ff57bfc649eae9938ea6b3dab4',
    {
      manifestSha256: 'e3d17a8d95b3f99805c74aba6a6cc42560dfac6f865cc75cf6e675f7ad3fd5dd',
      version: '0.2.53',
    },
  ],
]);
const RECEIPT_BACKED_LOCAL_RELEASE_ZIP_ARTIFACT_KIND = 'local-release-zip-artifact';
const RECEIPT_BACKED_LOCAL_SOURCE_ARTIFACTS = new Map([
  [
    '41bf5be59dc5a279b5a6c1f4e91cebdade34bf51',
    {
      manifestSha256: '510d508d9d3e75ad581a956a3c89b00e63465e4a99198ddc5d144da70b34132a',
      version: '0.2.53',
    },
  ],
]);
const RECEIPT_BACKED_SAVE_UPDATE_COMMITS = new Set([
  RECEIPT_BACKED_FROZEN_SOURCE_COMMIT,
  ...RECEIPT_BACKED_LOCAL_RELEASE_ZIPS.keys(),
  ...RECEIPT_BACKED_LOCAL_SOURCE_ARTIFACTS.keys(),
]);
const RECEIPT_BACKED_ROUTER_SHA256 =
  '53e19fea4a7ddf57a1c8b12a0a641e9e694e8ce2527112520d5c85fd5520006c';
const RECEIPT_BACKED_SERVICE_SHA256 =
  'd62944d5e9968bcb6323182487a410a600f03771942f05127df5ff1f0e1f4ff8';
const generatorTransportMode =
  lifecycleDryRun || process.env.MATRX_VAULT_CANARY_GENERATOR === 'RUN_GENERATOR_TRANSPORT';
const displayMode =
  process.env.MATRX_VAULT_CANARY_DISPLAY || (lifecycleDryRun ? 'HEADLESS_NO_CLIPBOARD' : undefined);
const headlessNoClipboardMode = displayMode === 'HEADLESS_NO_CLIPBOARD';
const headedMode = displayMode === 'HEADED';
const isolatedHeadlessClipboard =
  process.env.MATRX_VAULT_CANARY_CLIPBOARD === 'RUN_ISOLATED_HEADLESS_CLIPBOARD';
assert(
  !process.env.MATRX_VAULT_CANARY_CLIPBOARD || isolatedHeadlessClipboard,
  'clipboard_mode_invalid',
);
assert(
  !isolatedHeadlessClipboard ||
    (headlessNoClipboardMode && generatorTransportMode && readOnlyAdmissionMode),
  'clipboard_requires_headless_generator_admission',
);
assert(
  !edgeBrowserMode || (headlessNoClipboardMode && !isolatedHeadlessClipboard),
  'edge_requires_owned_headless_without_clipboard',
);
const panelCloseLifecycleMode =
  process.env.MATRX_VAULT_CANARY_GENERATOR_PANEL_CLOSE === 'RUN_PANEL_CLOSE_LIFECYCLE';
const workerRestartLifecycleMode =
  process.env.MATRX_VAULT_CANARY_GENERATOR_WORKER_RESTART === 'RUN_WORKER_RESTART_LIFECYCLE';
const windowSwitchLifecycleMode =
  process.env.MATRX_VAULT_CANARY_GENERATOR_WINDOW_SWITCH === 'RUN_WINDOW_SWITCH_LIFECYCLE';
const extensionLifecycleMode =
  process.env.MATRX_VAULT_CANARY_EXTENSION_LIFECYCLE === 'RUN_EXTENSION_LIFECYCLE';
const setupIdentityOnlyMode =
  process.env.MATRX_VAULT_CANARY_SETUP_IDENTITY_ONLY === 'RUN_SETUP_IDENTITY_ONLY';
const identityOnlyMode = process.env.MATRX_VAULT_CANARY_IDENTITY_ONLY === 'RUN_IDENTITY_ONLY';
assert(typeof displayMode === 'string' && displayMode.length > 0, 'canary_display_mode_required');
assert(headlessNoClipboardMode || headedMode, 'canary_display_mode_invalid');
assert(
  !headedMode || process.env.MATRX_VAULT_CANARY_FOREGROUND === 'ALLOW_FOREGROUND_TEST',
  'headed_canary_requires_foreground_allow',
);
assert(
  !headlessNoClipboardMode || generatorTransportMode || receiptBackedSaveUpdateMode,
  'headless_requires_generator_transport',
);
assert(
  !headlessNoClipboardMode || readOnlyAdmissionMode || receiptBackedSaveUpdateMode,
  'headless_requires_read_only_admission',
);
assert(
  !headlessNoClipboardMode || !process.env.MATRX_VAULT_CANARY_WINDOW_PLACEMENT,
  'headless_refuses_window_placement',
);
if (receiptBackedSaveUpdateMode) {
  // Presence itself is unsafe: malformed lifecycle values must not bypass the
  // displayless Save/Update admission by failing in a later, weaker guard.
  for (const key of [
    'MATRX_VAULT_CANARY_GENERATOR',
    'MATRX_VAULT_CANARY_GENERATOR_PANEL_CLOSE',
    'MATRX_VAULT_CANARY_GENERATOR_WORKER_RESTART',
    'MATRX_VAULT_CANARY_GENERATOR_WINDOW_SWITCH',
  ])
    assert(process.env[key] === undefined, 'receipt_backed_refuses_generator_or_lifecycle_flag');
}
assert(
  !panelCloseLifecycleMode || headlessNoClipboardMode,
  'panel_close_lifecycle_requires_headless_no_clipboard',
);
assert(
  !process.env.MATRX_VAULT_CANARY_GENERATOR_WORKER_RESTART || workerRestartLifecycleMode,
  'worker_restart_lifecycle_mode_invalid',
);
assert(
  !process.env.MATRX_VAULT_CANARY_GENERATOR_WINDOW_SWITCH || windowSwitchLifecycleMode,
  'window_switch_lifecycle_mode_invalid',
);
assert(
  !workerRestartLifecycleMode || headlessNoClipboardMode,
  'worker_restart_lifecycle_requires_headless_no_clipboard',
);
assert(
  !windowSwitchLifecycleMode || headlessNoClipboardMode,
  'window_switch_lifecycle_requires_headless_no_clipboard',
);
assert(
  !extensionLifecycleMode || (headlessNoClipboardMode && readOnlyAdmissionMode),
  'extension_lifecycle_requires_headless_readonly_admission',
);
assert(
  !setupIdentityOnlyMode || (headlessNoClipboardMode && readOnlyAdmissionMode),
  'setup_identity_only_requires_headless_readonly_admission',
);
assert(
  !identityOnlyMode || (headlessNoClipboardMode && readOnlyAdmissionMode),
  'identity_only_requires_headless_readonly_admission',
);
assert(
  [extensionLifecycleMode, setupIdentityOnlyMode, identityOnlyMode].filter(Boolean).length <= 1,
  'lifecycle_modes_are_exclusive',
);
if (lifecycleDryRun) {
  const digest = (name) =>
    crypto
      .createHash('sha256')
      .update(syncFs.readFileSync(path.join(__dirname, name)))
      .digest('hex');
  process.stdout.write(
    `${JSON.stringify({
      kind: 'vault_extension_lifecycle_dry_run',
      runnerSha256: digest('vault-realbrowser-acceptance.cjs'),
      lifecycleHelperSha256: digest('vault-extension-lifecycle-acceptance.cjs'),
      lifecycleNetworkObservationSha256: digest('vault-lifecycle-network-observation.cjs'),
      nativePanelFetchFailureSha256: digest('vault-native-panel-fetch-failure.cjs'),
      lifecycleVerdictSha256: digest('vault-extension-lifecycle-verdict.cjs'),
      setupRecoveryHelperSha256: digest('vault-setup-recovery-acceptance.cjs'),
      realSiteFillAcceptanceSha256: digest('vault-real-site-fill-acceptance.cjs'),
      custody: 'no_browser_no_profile_no_credentials_no_network',
    })}\n`,
  );
  process.exit(0);
}
if (process.env.MATRX_REALBROWSER_VAULT_CANARY !== 'RUN_UNDER_REVIEW')
  throw new Error('inert_canary_requires_explicit_arm');
assert(
  !generatorTransportMode || readOnlyAdmissionMode,
  'generator_requires_mutation_free_admission',
);
if (receiptBackedSaveUpdateMode) {
  assert(headlessNoClipboardMode, 'receipt_backed_requires_headless_no_clipboard');
  assert(localCanonicalCleanupArmed, 'receipt_backed_requires_local_canonical_cleanup');
  assert(
    RECEIPT_BACKED_SAVE_UPDATE_COMMITS.has(process.env.MATRX_VAULT_CANARY_EXPECTED_COMMIT),
    'receipt_backed_requires_frozen_artifact',
  );
  assert(
    process.env.MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256 === RECEIPT_BACKED_ROUTER_SHA256,
    'receipt_backed_requires_frozen_router',
  );
  assert(
    process.env.MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256 === RECEIPT_BACKED_SERVICE_SHA256,
    'receipt_backed_requires_frozen_service',
  );
}
const LOCAL_CLEANUP_MAX_BASELINE_IDS = 64;
const LOCAL_CLEANUP_MAX_CREATED_IDS = 5;
const LOCAL_CLEANUP_INPUT_MAX_BYTES = 32768;
const AIDREAM_ENV_ROOT = '/Users/armanisadeghi/code/aidream';
const LOCAL_SOURCE_ROOT = process.env.MATRX_VAULT_CANARY_LOCAL_SOURCE_ROOT || AIDREAM_ENV_ROOT;
const LOCAL_ROUTER_RELATIVE = 'aidream/api/routers/vault.py';
const LOCAL_SERVICE_RELATIVE = 'aidream/services/user_secrets/vault.py';
if (localCanonicalCleanupArmed) {
  const routerHash = required('MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256');
  const serviceHash = required('MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256');
  assert(
    /^[a-f0-9]{64}$/.test(routerHash) && /^[a-f0-9]{64}$/.test(serviceHash),
    'local_cleanup_hash_shape',
  );
}

const runId = crypto.randomUUID();
const stateRoot =
  process.env.MATRX_VAULT_CANARY_STATE_ROOT ||
  path.join(REPO, '.matrx', 'realbrowser-vault', 'canary-runs');
const REVIEWED_HISTORICAL_ADMISSION_ROOT = path.join(
  REPO,
  '.matrx',
  'realbrowser-vault',
  'readonly-admission',
);
const REVIEWED_HISTORICAL_ADMISSION_RUN = '3bef7a5b-c78e-497e-b936-f7f53a2e9ac1';
const REVIEWED_HISTORICAL_ADMISSION_SHA256 =
  'd0c7c4b7b9c1de1b5af600e8678a5f2921e231d6346521f9f7d72e944e47cb42';
const root = path.join(stateRoot, runId);
const profile = path.join(root, 'owned-profile');
const proofPath = path.join(root, 'proof.json');
const proof = {
  schema: 3,
  runnerSha256: crypto.createHash('sha256').update(syncFs.readFileSync(__filename)).digest('hex'),
  scope: 'owned localhost real-extension Vault Save/Update acceptance',
  mode: receiptBackedSaveUpdateMode
    ? 'receipt_backed_save_update'
    : readOnlyAdmissionMode
      ? 'read_only_admission'
      : 'full_acceptance',
  displayMode,
  phase: 'artifact_admission',
  authenticationAttempted: false,
  runId,
  profileKind: 'new disposable owned profile',
  artifact: null,
  ownedCreateMutationKeys: [],
  ownedFixtureIds: [],
  checks: {},
  cleanup: {},
  vaultMutationRequests: 0,
  vaultItemPosts: {
    total: 0,
    withIdempotencyHeader: 0,
    missingIdempotencyHeader: 0,
    invalidIdempotencyHeader: 0,
  },
  ...(readOnlyAdmissionMode
    ? { admission: { mode: 'read_only', fixtureWrites: 0, noFixtureWrites: false } }
    : {}),
  openProof: [],
};
let context;
let worker;
let token;
let userId;
let organizationId;
let local;
let localUrl;
let website;
let realPanel;
let extensionId;
let rawCdp;
let networkJournal;
let authenticator;
let authenticatorHandle;
let responseLoss;
let lifecycleLogoutObserver;
let responseLossInstalled = false;
let responseLossKey;
let responseLossPostsBefore;
let responseLossKeysBefore;
const rejectedBeforeForwardKeys = new Set();
const responseLossFixtureKeys = new Set();
const receiptItemByKey = new Map();
const createKeys = new Set();
const createdIds = new Set();
let baselineIds = new Set();

const sha256Value = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function ownedBrowserProcess({ candidateProfile, executablePath, launchOptions }) {
  const lock = await fs.readlink(path.join(candidateProfile, 'SingletonLock')).catch(() => null);
  const pidMatch = /-(\d+)$/.exec(lock || '');
  assert(pidMatch, 'browser_restart_singleton_lock_missing');
  const browserPid = Number(pidMatch[1]);
  assert(Number.isSafeInteger(browserPid) && browserPid > 1, 'browser_restart_pid_invalid');
  let command;
  let args;
  try {
    [{ stdout: command }, { stdout: args }] = await Promise.all([
      execFileAsync('ps', ['-p', String(browserPid), '-o', 'comm='], {
        timeout: 5000,
        maxBuffer: 32768,
      }),
      execFileAsync('ps', ['-p', String(browserPid), '-o', 'args='], {
        timeout: 5000,
        maxBuffer: 32768,
      }),
    ]);
  } catch {
    throw new Error('browser_restart_owned_process_missing');
  }
  const observedExecutable = command.trim();
  const observedArgs = args.trim();
  const profileArgument = new RegExp(
    `(?:^|[\\s\\0])--user-data-dir=${escapeRegExp(candidateProfile)}(?=$|[\\s\\0])`,
  );
  assert(observedExecutable === executablePath, 'browser_restart_executable_mismatch');
  assert(profileArgument.test(observedArgs), 'browser_restart_profile_argument_missing');
  for (const argument of launchOptions.args || [])
    assert(observedArgs.includes(argument), 'browser_restart_launch_argument_missing');
  return { browserPid, executable: observedExecutable, args: observedArgs };
}

async function verifyOwnedBrowserProcess({ profile: candidateProfile, launchOptions, browserPid }) {
  const observed = await ownedBrowserProcess({
    candidateProfile,
    executablePath: launchOptions.executablePath,
    launchOptions,
  });
  return observed.browserPid === browserPid;
}

async function verifyBrowserProcessExited(browserPid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await execFileAsync('ps', ['-p', String(browserPid), '-o', 'pid='], {
        timeout: 5000,
        maxBuffer: 1024,
      });
    } catch (error) {
      if (error?.code === 1) return true;
      throw error;
    }
    await wait(100);
  }
  return false;
}

async function verifyNoBrowserProcessForProfile(candidateProfile) {
  const profileArgument = new RegExp(
    `(?:^|[\\s\\0])--user-data-dir=${escapeRegExp(candidateProfile)}(?=$|[\\s\\0])`,
  );
  let consecutiveAbsent = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { stdout } = await execFileAsync('ps', ['-axo', 'args='], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    consecutiveAbsent = stdout.split('\n').some((line) => profileArgument.test(line))
      ? 0
      : consecutiveAbsent + 1;
    if (consecutiveAbsent >= 3) return true;
    await wait(100);
  }
  return false;
}

function persist() {
  syncFs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = `${proofPath}.tmp`;
  syncFs.writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  syncFs.renameSync(temporary, proofPath);
}
function checkpoint(phase) {
  proof.phase = phase;
  persist();
}
async function generatorSessionLocked() {
  if (process.platform !== 'darwin') return false;
  // IOConsoleUsers carries account/session metadata. plistlib keeps it inside
  // the child process and emits only one derived lock bit for its sole active
  // console record; raw session values are never printed or persisted.
  const probe = [
    'import json, plistlib, subprocess, sys',
    "p = subprocess.run(['/usr/sbin/ioreg', '-a', '-l', '-d', '1', '-n', 'IOConsoleUsers'], capture_output=True, timeout=5)",
    'root = plistlib.loads(p.stdout) if p.returncode == 0 else None',
    "sessions = root.get('IOConsoleUsers') if isinstance(root, dict) else None",
    "active = [entry for entry in sessions if isinstance(entry, dict) and entry.get('kCGSSessionOnConsoleKey') is True and entry.get('kCGSessionLoginDoneKey') is True] if isinstance(sessions, list) else []",
    "locked = active[0].get('CGSSessionScreenIsLocked') if len(active) == 1 else None",
    'valid = len(active) == 1 and (locked is None or type(locked) is bool)',
    "print(json.dumps({'screenLocked': bool(locked)}) if valid else 'unavailable')",
  ].join('; ');
  let stdout;
  try {
    ({ stdout } = await execFileAsync('/usr/bin/python3', ['-c', probe], {
      timeout: 7000,
      maxBuffer: 1024,
    }));
  } catch {
    throw new Error('generator_focus_session_state_unavailable');
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('generator_focus_session_state_unavailable');
  }
  assert(typeof parsed?.screenLocked === 'boolean', 'generator_focus_session_state_unavailable');
  return parsed.screenLocked;
}
function hasEarlyReadOnlyNoWriteCleanup(record) {
  const journal = record?.networkJournal;
  const terminal = journal?.postDisposalSnapshot;
  return (
    record?.schema === 3 &&
    record?.mode === 'read_only_admission' &&
    record.admission?.noFixtureWrites === true &&
    record.vaultMutationRequests === 0 &&
    record.vaultItemPosts?.total === 0 &&
    record.ownedCreateMutationKeys?.length === 0 &&
    record.ownedFixtureIds?.length === 0 &&
    journal?.ownerVerified === true &&
    journal?.journalSemanticVersion === 2 &&
    journal?.beforeCleanupSnapshot?.vaultMutationRequests === 0 &&
    journal?.beforeCleanupSnapshot?.observerError === false &&
    journal?.beforeCleanupSnapshot?.transportFatal === false &&
    journal?.beforeCleanupSnapshot?.sendFailureClass === 'none' &&
    journal?.beforeCleanupSnapshot?.pendingSetupCount === 0 &&
    terminal?.vaultMutationRequests === 0 &&
    terminal?.observerError === false &&
    terminal?.transportFatal === false &&
    terminal?.sendFailureClass === 'none' &&
    terminal?.cleanupPhase === 'complete' &&
    terminal?.transportCloseStatus === 'closed' &&
    terminal?.remainingOwnedSessionCount === 0 &&
    terminal?.pendingSetupCount === 0 &&
    journal?.disposalSucceeded === true &&
    record.cleanup?.browserClosed === true &&
    record.cleanup?.profileRemoved === true &&
    [true, 'not_started'].includes(record.cleanup?.localFixtureServerClosed) &&
    (!record.authenticationAttempted || record.cleanup?.remoteAuthRevocationStatus === 204)
  );
}
async function refuseUnreconciledPriorRun() {
  const retryingAuthFailures = [];
  const entries = await fs
    .readdir(stateRoot, { withFileTypes: true })
    .catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error)));
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === runId) continue;
    const priorProofPath = path.join(stateRoot, entry.name, 'proof.json');
    const priorRaw = await fs.readFile(priorProofPath, 'utf8').catch(() => null);
    const prior = priorRaw ? JSON.parse(priorRaw) : null;
    const completedAcceptance =
      prior?.mode !== 'receipt_backed_save_update' &&
      prior?.ok === true &&
      prior.cleanup?.receiptReconciled === true &&
      prior.cleanup?.createdItemsGone === true;
    // A read-only run is retryable when its cleanup records zero observed Vault mutation requests. That stays independent of an admission UI outcome.
    const vaultMutationFreeCleanup =
      prior?.schema === 3 &&
      prior?.mode === 'read_only_admission' &&
      prior.cleanup?.vaultMutationFree === true &&
      prior.vaultMutationRequests === 0 &&
      prior.vaultItemPosts?.total === 0 &&
      prior.ownedCreateMutationKeys?.length === 0 &&
      prior.ownedFixtureIds?.length === 0 &&
      (prior.cleanup?.localAuthLogoutStatus === 204 || prior.authenticationAttempted === false) &&
      prior.cleanup?.browserClosed === true &&
      prior.cleanup?.profileRemoved === true;
    const earlyReadOnlyNoWriteCleanup = hasEarlyReadOnlyNoWriteCleanup(prior);
    // A failed OAuth attempt is retryable only when it never crossed the
    // independent identity boundary, never read a Vault baseline or created
    // fixtures, and its disposable browser/profile were conclusively gone.
    // It does not assert a remote auth revocation: a prior proof without a
    // captured bearer cannot safely revoke an unknown session.
    const authFailureBeforeWrites =
      prior?.schema === 3 &&
      prior?.mode === 'read_only_admission' &&
      prior.authenticationAttempted === true &&
      ['oauth_ui', 'oauth_sign_in'].includes(prior.failurePhase) &&
      prior.checks?.independentAdminIdentity !== true &&
      prior.identityProof === undefined &&
      prior.baselineMetadataSha256 === undefined &&
      prior.vaultMutationRequests === 0 &&
      prior.vaultItemPosts?.total === 0 &&
      prior.ownedCreateMutationKeys?.length === 0 &&
      prior.ownedFixtureIds?.length === 0 &&
      prior.cleanup?.browserClosed === true &&
      prior.cleanup?.profileRemoved === true;
    const preAuthNoWriteCleanup = hasPreAuthNoWriteCleanup(prior);
    // Exact reviewed reconciliation only. It neither edits nor promotes the
    // old proof: runner bc9c32dec3ace7d974163fa153d83a6ff51c8dcb differed only
    // by native-env loader c909455b77b16144ff463dc4ca314edfda0c2d50f4f7b2c149bf9610f861a7b2.
    // Independent review confirmed organization_not_selected before baseline
    // or fixtures and no Save/Update request; no other sidecar is accepted.
    const reviewedHistoricalException =
      stateRoot === REVIEWED_HISTORICAL_ADMISSION_ROOT &&
      entry.name === REVIEWED_HISTORICAL_ADMISSION_RUN &&
      priorProofPath ===
        path.join(
          REVIEWED_HISTORICAL_ADMISSION_ROOT,
          REVIEWED_HISTORICAL_ADMISSION_RUN,
          'proof.json',
        ) &&
      priorRaw !== null &&
      crypto.createHash('sha256').update(priorRaw).digest('hex') ===
        REVIEWED_HISTORICAL_ADMISSION_SHA256;
    // Reproduced launch-only failure: default headless shell never loaded the
    // extension worker; no OAuth interaction was reachable. Preserve failure.
    const reviewedLaunchFailure =
      stateRoot === REVIEWED_HISTORICAL_ADMISSION_ROOT &&
      entry.name === '96760964-bf3f-465a-9452-a566c98c8c00' &&
      priorRaw !== null &&
      crypto.createHash('sha256').update(priorRaw).digest('hex') ===
        '9e4c99d7a5041aafcece85f3a6d8d3f176fcaab975ea6633cdd962c8b4a0e46b';
    // Cleanup is independent of the tested outcome: a failed journey may
    // retry after its receipt-backed cleanup has completed successfully.
    const completedMutationCleanup =
      prior?.schema === 3 &&
      ['full_acceptance', 'receipt_backed_save_update'].includes(prior.mode) &&
      prior.cleanup?.receiptReconciled === true &&
      prior.cleanup?.baselineUntouched === true &&
      prior.cleanup?.createdItemsGone === true &&
      prior.cleanup?.localAuthLogoutStatus === 204 &&
      prior.cleanup?.browserClosed === true &&
      prior.cleanup?.profileRemoved === true &&
      (prior.mode !== 'receipt_backed_save_update' ||
        (prior.cleanup?.finalBaselineIdSetMatches === true &&
          prior.cleanup?.finalBaselineMetadataMatches === true &&
          prior.cleanup?.localFixtureServerClosed === true));
    // Receipt-mode failures are retryable only when the durable proof says no
    // Vault mutation crossed the runner boundary, all owned state is empty,
    // and every resource it started has closed. If it read a baseline, the
    // same failing run must have freshly re-read its exact IDs and metadata.
    const receiptModeZeroWriteCleanup =
      prior?.schema === 3 &&
      prior?.mode === 'receipt_backed_save_update' &&
      prior.vaultMutationRequests === 0 &&
      prior.vaultItemPosts?.total === 0 &&
      prior.vaultItemPosts?.withIdempotencyHeader === 0 &&
      prior.vaultItemPosts?.missingIdempotencyHeader === 0 &&
      prior.vaultItemPosts?.invalidIdempotencyHeader === 0 &&
      prior.ownedCreateMutationKeys?.length === 0 &&
      prior.ownedFixtureIds?.length === 0 &&
      prior.cleanup?.browserClosed === true &&
      prior.cleanup?.profileRemoved === true &&
      (prior.cleanup?.localFixtureServerClosed === true ||
        prior.cleanup?.localFixtureServerClosed === 'not_started') &&
      (prior.authenticationAttempted !== true || prior.cleanup?.localAuthLogoutStatus === 204) &&
      (prior.baselineMetadataSha256 === undefined ||
        (prior.cleanup?.finalBaselineIdSetMatches === true &&
          prior.cleanup?.finalBaselineMetadataMatches === true));
    let reviewedRecovery = false;
    if (
      stateRoot === REVIEWED_HISTORICAL_ADMISSION_ROOT &&
      entry.name === 'acd31810-d74b-450a-bf39-d85e830b872a' &&
      priorRaw !== null &&
      crypto.createHash('sha256').update(priorRaw).digest('hex') ===
        '88bce524d50c182db12c1307c306ff99f516714f2ca87bdcd7de5095d9a07678'
    ) {
      const recoveryRaw = await fs
        .readFile(path.join(stateRoot, entry.name, 'recovery-1789807360922.json'), 'utf8')
        .catch(() => null);
      if (
        recoveryRaw !== null &&
        crypto.createHash('sha256').update(recoveryRaw).digest('hex') ===
          '7f10f75e3d5e35214867874d050d53691db23208bf2dce68fd7bbe1ac4b17337'
      ) {
        const recovery = JSON.parse(recoveryRaw);
        const attempts = recovery.adapter?.attempts || [];
        const recoveredIds = new Set(attempts.map((attempt) => attempt.id));
        reviewedRecovery =
          prior.ok === false &&
          recovery.ok === true &&
          recovery.runId === prior.runId &&
          recovery.originalProofSha256 ===
            crypto.createHash('sha256').update(priorRaw).digest('hex') &&
          recovery.adminVerified === true &&
          recovery.baselineUnchangedBefore === true &&
          recovery.baselineUnchangedAfter === true &&
          recovery.createdItemsGone === true &&
          recovery.logoutStatus === 204 &&
          recovery.adapterProcess?.exitCode === 0 &&
          recovery.adapterProcess?.strictJson === true &&
          recovery.adapter?.ok === true &&
          recovery.adapter?.route === 'local_canonical_authmiddleware' &&
          recovery.adapter?.receiptCount === 4 &&
          attempts.length === 4 &&
          recoveredIds.size === 4 &&
          prior.ownedFixtureIds?.length === 4 &&
          prior.ownedFixtureIds.every((id) => recoveredIds.has(id)) &&
          attempts.every(
            (attempt) => attempt.initialGetStatus === 404 && attempt.terminal === 'already_cleaned',
          );
      }
    }
    // Independently reviewed cleanup reconciliation only. The original failed
    // panel observation remains failed; this admits a new run, never upgrades it.
    let reviewedGeneratorCleanup = false;
    const generatorRecoveryRoot = path.join(
      REPO,
      '.matrx',
      'realbrowser-vault',
      'generator-admission',
    );
    if (
      stateRoot === generatorRecoveryRoot &&
      entry.name === '773b5e06-70c4-488a-be6e-02f7d4cc10ee' &&
      priorRaw !== null &&
      crypto.createHash('sha256').update(priorRaw).digest('hex') ===
        '113fb4a7cb9f65b3149c2b57b251d657e8182852d6d72cd0b15a90caf1cd8409'
    ) {
      const sidecarRaw = await fs
        .readFile(
          path.join(generatorRecoveryRoot, entry.name, 'cleanup-reconciliation.json'),
          'utf8',
        )
        .catch(() => null);
      const freshPath = path.join(
        REPO,
        '.matrx',
        'realbrowser-vault',
        'save-update-headless',
        '6bb55156-4b9a-4a45-af35-0fa2feb7d171',
        'proof.json',
      );
      const freshRaw = await fs.readFile(freshPath, 'utf8').catch(() => null);
      if (
        sidecarRaw &&
        freshRaw &&
        crypto.createHash('sha256').update(sidecarRaw).digest('hex') ===
          '449f3432c09166ce482cdb7b74ea495da03a768c31bee051194c10e737a8a73b' &&
        crypto.createHash('sha256').update(freshRaw).digest('hex') ===
          '511703aef98dd4ce2229740196e792b827a913e3b0a3a65080b78b8d48d9de21'
      ) {
        const sidecar = JSON.parse(sidecarRaw),
          fresh = JSON.parse(freshRaw);
        const cleanZeroWrite = (record) =>
          record.vaultMutationRequests === 0 &&
          record.vaultItemPosts?.total === 0 &&
          record.ownedCreateMutationKeys?.length === 0 &&
          record.ownedFixtureIds?.length === 0 &&
          record.cleanup?.localAuthLogoutStatus === 204 &&
          record.cleanup?.browserClosed === true &&
          record.cleanup?.profileRemoved === true;
        reviewedGeneratorCleanup =
          prior.mode === 'read_only_admission' &&
          prior.ok === false &&
          prior.failureCode === 'vault_panel_items_read_sentinel_missing' &&
          typeof prior.baselineMetadataSha256 === 'string' &&
          cleanZeroWrite(prior) &&
          fresh.checks?.independentAdminIdentity === true &&
          cleanZeroWrite(fresh) &&
          fresh.baselineMetadataSha256 === prior.baselineMetadataSha256 &&
          fresh.cleanup?.finalBaselineIdSetMatches === true &&
          fresh.cleanup?.finalBaselineMetadataMatches === true &&
          sidecar.freshAdminProofPath === freshPath &&
          sidecar.scope ===
            'cleanup and retry reconciliation only; original failed coverage verdict unchanged' &&
          sidecar.historicalNetworkAcceptance === false;
      }
    }
    if (authFailureBeforeWrites) {
      retryingAuthFailures.push({
        runId: prior.runId,
        proofSha256: crypto.createHash('sha256').update(priorRaw).digest('hex'),
        localCredentialDisposal: 'profile_removed',
        remoteAuthRevocation: 'unknown',
      });
    }
    // Exact independently reviewed recovery admits a new run only. The old
    // failed receipt remains immutable and does not gain coverage credit.
    let reviewedChromeReconciliation = false;
    if (priorProofPath === reconciledChromeProofPath) {
      const reconciliation = await verifyHistoricalChromeReconciliation();
      reviewedChromeReconciliation = reconciliation.authResourceAndLeaseCleanupComplete === true;
      proof.priorChromeCleanupReconciliation = reconciliation;
    }
    let reviewed7356Recovery = false;
    if (priorProofPath === recovered7356ProofPath) {
      const recovery = await verify7356RecoveryAdmission();
      reviewed7356Recovery = recovery.admitNewSerializedRun === true;
      proof.prior7356CleanupRecovery = recovery;
    }
    let reviewedUncommittedRequest = false;
    if (priorProofPath === NO_COMMIT_PROOF_PATH) {
      const recovery = await verifyNoCommitRecovery();
      reviewedUncommittedRequest = recovery.admitNewSerializedRun === true;
      proof.priorUncommittedRequestRecovery = recovery;
    }
    // Exact one-off retry custody for the failed read-only enable probe. Its
    // network observer remains failed. A separately reviewed 37-item admin
    // inventory comparison and owner-bound retirement grant retry only.
    let reviewedEnableProbeRetirement = false;
    if (
      stateRoot ===
        path.join(__dirname, '../../.matrx/task1-active/lifecycle-detail-toggle-2026-09-25') &&
      entry.name === '66f9fac6-ca59-4b30-8d99-ee6fa7832a1c' &&
      priorRaw !== null &&
      crypto.createHash('sha256').update(priorRaw).digest('hex') ===
        'a2f71e859d314850730d2e99a87940371c7ee7abe63bc94c469e6b04d42b17df'
    ) {
      const evidenceRoot = path.join(__dirname, '../../.matrx/task1-active');
      const reconciliationPath = path.join(
        evidenceRoot,
        'lifecycle-detail-toggle-inventory-reconciliation-2026-09-25.json',
      );
      const retirementPath = path.join(evidenceRoot, 'lease-retirement-66f9fac6-2026-09-25.json');
      reviewedEnableProbeRetirement =
        (await sha256(reconciliationPath).catch(() => null)) ===
          '774a42b60e7f16055f89a5ada448cb36f9ea80327bfa8cb92a7daa6339575257' &&
        (await sha256(retirementPath).catch(() => null)) ===
          '1e739377a62eeccb85fa2c79b26d2c83915d3e1c1c0ef840903055bea9a2494e' &&
        prior.ok === false &&
        prior.cleanup?.vaultMutationFree === false &&
        prior.networkJournal?.beforeCleanupSnapshot?.observerError === true;
    }
    const receiptMode = prior?.mode === 'receipt_backed_save_update';
    assert(
      receiptMode
        ? completedMutationCleanup ||
            receiptModeZeroWriteCleanup ||
            preAuthNoWriteCleanup ||
            reviewedChromeReconciliation ||
            reviewed7356Recovery ||
            reviewedUncommittedRequest
        : completedAcceptance ||
            completedMutationCleanup ||
            vaultMutationFreeCleanup ||
            earlyReadOnlyNoWriteCleanup ||
            authFailureBeforeWrites ||
            preAuthNoWriteCleanup ||
            reviewedHistoricalException ||
            reviewedLaunchFailure ||
            reviewedEnableProbeRetirement ||
            reviewedRecovery ||
            reviewedGeneratorCleanup ||
            hasObservedReadOnlyCleanup(prior) ||
            hasPreBaselineAuthenticatedCleanup(prior),
      'previous_run_unreconciled',
    );
  }
  if (retryingAuthFailures.length) proof.priorAuthRetryJournal = retryingAuthFailures;
}
async function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
}
async function resolveLocalSourceRoot() {
  assert(path.isAbsolute(LOCAL_SOURCE_ROOT), 'local_source_root_must_be_absolute');
  const sourceRoot = await fs.realpath(LOCAL_SOURCE_ROOT).catch(() => null);
  assert(
    sourceRoot !== null && (await fs.stat(sourceRoot)).isDirectory(),
    'local_source_root_refused',
  );
  return sourceRoot;
}
function baselineMetadataSha256(entries) {
  const metadata = entries
    .map((entry) => ({
      id: entry.id,
      updated_at: entry.updated_at,
      fields: (entry.fields || [])
        .map((field) => ({
          id: field.id,
          field_key: field.field_key,
          is_active: field.is_active,
          handling: field.handling,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}
async function prewriteLocalCanonicalPreflight() {
  if (!localCanonicalCleanupArmed) return;
  assert(baselineIds.size <= LOCAL_CLEANUP_MAX_BASELINE_IDS, 'local_cleanup_baseline_capacity');
  const { sourceRoot, routerHash, serviceHash } = await verifyPinnedLocalCanonicalSource();
  const placeholderIds = Array.from(
    { length: LOCAL_CLEANUP_MAX_CREATED_IDS },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const payload = JSON.stringify({
    token,
    userId,
    organizationId,
    createKeys: placeholderIds,
    baselineIds: [...baselineIds],
    provenIDs: placeholderIds,
    expectedRouterSha256: routerHash,
    expectedServiceSha256: serviceHash,
    sourceRoot,
  });
  assert(
    Buffer.byteLength(payload, 'utf8') < LOCAL_CLEANUP_INPUT_MAX_BYTES,
    'local_cleanup_payload_capacity',
  );
  proof.checks.localCanonicalCleanupPreflight = true;
}
async function verifyPinnedLocalCanonicalSource() {
  if (!localCanonicalCleanupArmed) return null;
  const sourceRoot = await resolveLocalSourceRoot();
  const routerSource = path.join(sourceRoot, LOCAL_ROUTER_RELATIVE);
  const serviceSource = path.join(sourceRoot, LOCAL_SERVICE_RELATIVE);
  const routerHash = required('MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256');
  const serviceHash = required('MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256');
  assert((await sha256(routerSource)) === routerHash, 'local_cleanup_router_hash_mismatch');
  assert((await sha256(serviceSource)) === serviceHash, 'local_cleanup_service_hash_mismatch');
  return { sourceRoot, routerHash, serviceHash };
}
async function verifyArtifact() {
  const manifestPath = required('MATRX_VAULT_CANARY_MANIFEST');
  assert(path.isAbsolute(manifestPath), 'artifact_manifest_must_be_absolute');
  const manifestReal = await fs.realpath(manifestPath);
  const artifactRoot = path.dirname(manifestReal);
  const manifest = JSON.parse(await fs.readFile(manifestReal, 'utf8'));
  const manifestSha256 = await sha256(manifestReal);
  assert(
    manifest.schema === 2 && manifest.extensionDirectory === 'extension',
    'artifact_manifest_shape',
  );
  assert(manifest.kind === required('MATRX_VAULT_CANARY_ARTIFACT_KIND'), 'artifact_kind_mismatch');
  assert(
    manifest.sourceCommit === required('MATRX_VAULT_CANARY_EXPECTED_COMMIT'),
    'artifact_commit_mismatch',
  );
  assert(
    Array.isArray(manifest.extensionFiles) && manifest.extensionFiles.length > 0,
    'artifact_manifest_files',
  );
  const extension = path.join(artifactRoot, manifest.extensionDirectory);
  assert((await fs.realpath(extension)) === extension, 'artifact_path_refused');
  const expected = new Map(manifest.extensionFiles.map((entry) => [entry.path, entry.sha256]));
  const observed = new Set();
  async function walk(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      const name = path.join(relative, entry.name);
      assert(!entry.isSymbolicLink(), 'artifact_symlink');
      if (entry.isDirectory()) await walk(next, name);
      else {
        assert(entry.isFile() && expected.has(name), 'artifact_extra_file');
        assert((await sha256(next)) === expected.get(name), 'artifact_file_hash');
        observed.add(name);
      }
    }
  }
  await walk(extension);
  assert(observed.size === expected.size, 'artifact_missing_file');
  const extensionManifest = JSON.parse(
    await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'),
  );
  assert(extensionManifest.manifest_version === 3, 'artifact_not_mv3');
  if (receiptBackedSaveUpdateMode) {
    const localRelease = RECEIPT_BACKED_LOCAL_RELEASE_ZIPS.get(manifest.sourceCommit);
    const localSource = RECEIPT_BACKED_LOCAL_SOURCE_ARTIFACTS.get(manifest.sourceCommit);
    if (localRelease) {
      assert(
        manifestSha256 === localRelease.manifestSha256,
        'receipt_backed_local_release_manifest_mismatch',
      );
      assert(
        manifest.kind === RECEIPT_BACKED_LOCAL_RELEASE_ZIP_ARTIFACT_KIND,
        'receipt_backed_local_release_kind_mismatch',
      );
      assert(
        manifest.manifestVersion === localRelease.version,
        'receipt_backed_local_release_version_mismatch',
      );
    } else if (localSource) {
      assert(
        manifestSha256 === localSource.manifestSha256,
        'receipt_backed_local_source_manifest_mismatch',
      );
      assert(
        manifest.kind === 'local-multi-repo-source-artifact',
        'receipt_backed_local_source_kind_mismatch',
      );
      assert(
        manifest.manifestVersion === localSource.version,
        'receipt_backed_local_source_version_mismatch',
      );
    } else {
      assert(
        manifest.sourceCommit === RECEIPT_BACKED_FROZEN_SOURCE_COMMIT,
        'receipt_backed_artifact_commit_mismatch',
      );
    }
  }
  proof.artifact = {
    manifestSha256,
    sourceCommit: manifest.sourceCommit,
    manifestVersion: manifest.manifestVersion,
    kind: manifest.kind,
    distributionProvenance: manifest.distributionProvenance,
    fileCount: observed.size,
  };
  return extension;
}
function startLocalSite() {
  const state = { submits: 0 };
  const server = http.createServer((request, response) => {
    if (request.url === '/submitted' && request.method === 'POST') {
      state.submits += 1;
      response.writeHead(204).end();
      return;
    }
    const requestPath = new URL(request.url, 'http://127.0.0.1').pathname;
    if (requestPath === vaultSetupRecoveryFixturePath) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(renderVaultSetupRecoveryFixtureHTML());
      return;
    }
    if (requestPath === '/signup' || requestPath === '/change-password') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(
        renderPasswordChangeFixtureHTML(requestPath === '/signup' ? 'signup' : 'change_password'),
      );
      return;
    }
    const matrixKind = requestPath.startsWith('/saved-matrix/')
      ? requestPath.slice('/saved-matrix/'.length)
      : null;
    if (
      matrixKind &&
      [
        'username_first',
        'late_spa',
        'same_origin_frame',
        'two_same_origin_frames',
        'cross_origin_parent',
        'frame_login',
      ].includes(matrixKind)
    ) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(renderSavedFormMatrixHTML(matrixKind));
      return;
    }
    const savedLoginKind =
      request.url === '/saved-login-nested'
        ? 'nested'
        : request.url === '/saved-login-external'
          ? 'external'
          : null;
    if (savedLoginKind) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(renderSavedLoginFixtureHTML(savedLoginKind));
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(`<!doctype html><html><body>
      <main><h1>Disposable login</h1><form id="login" method="post" action="/submitted">
      <label>Email <input id="email" name="email" autocomplete="username" type="email" required></label>
      <label>Password <input id="password" name="password" autocomplete="current-password" type="password" required></label>
      <button id="sign-in" type="submit">Sign in</button></form></main>
      <script>document.querySelector('#login').addEventListener('submit', async (event) => {
        event.preventDefault(); await fetch('/submitted', {method:'POST'}); document.body.dataset.submitted='yes';
      });</script></body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, state, url: `http://127.0.0.1:${server.address().port}/login` }),
    );
  });
}
async function storage(keys) {
  return worker.evaluate((names) => chrome.storage.local.get(names), keys);
}
async function hasPendingCapture() {
  return worker.evaluate(async () => {
    const value = (await chrome.storage.session.get('matrx.credentials.capture.pending.v1'))[
      'matrx.credentials.capture.pending.v1'
    ];
    return !!value && typeof value === 'object' && Object.keys(value).length > 0;
  });
}
async function inspectPendingCaptureDiagnostic(tabId) {
  return realPanel.evaluate(
    `(async () => { const expectedTabId = ${JSON.stringify(tabId)}; const [meta, activeTabs] = await Promise.all([chrome.runtime.sendMessage({ __matrx: true, kind: 'credential-capture:status', payload: { tabId: expectedTabId } }), chrome.tabs.query({ active: true, lastFocusedWindow: true })]); const card = (${captureCard}); const updateButtonCount = card ? Array.from(card.querySelectorAll('button')).filter((button) => !button.disabled && button.getClientRects().length > 0 && getComputedStyle(button).visibility !== 'hidden' && getComputedStyle(button).pointerEvents !== 'none' && button.textContent.trim().startsWith('Update')).length : null; return { candidatePresent: !!meta, candidateTabMatchesActive: meta?.tabId === expectedTabId && activeTabs.length === 1 && activeTabs[0]?.id === expectedTabId, existingCount: Array.isArray(meta?.existing) ? meta.existing.length : null, searchControlPresent: !!card?.querySelector('[aria-label="Search saved logins to update"]'), updateButtonCount }; })()`,
  );
}
function journalVaultMutationRequest(url, method, headers) {
  const classified = classifyVaultRequest({ url, method, apiOrigin: API });
  if (!classified.inVault) return;
  if (classified.mutation) proof.vaultMutationRequests += 1;
  // browser-login matching is a POST metadata read, never a Vault mutation.
  if (!classified.itemCreate) {
    persist();
    return;
  }
  const key = headers['idempotency-key'] ?? headers['Idempotency-Key'];
  proof.vaultItemPosts.total += 1;
  if (typeof key === 'string' && /^[0-9a-f-]{36}$/i.test(key)) {
    proof.vaultItemPosts.withIdempotencyHeader += 1;
    createKeys.add(key);
    proof.ownedCreateMutationKeys = [...createKeys];
  } else if (typeof key === 'string' && key.length > 0) {
    proof.vaultItemPosts.invalidIdempotencyHeader += 1;
  } else {
    proof.vaultItemPosts.missingIdempotencyHeader += 1;
  }
  persist();
}
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  // Node-side fixture calls do not pass through Playwright's browser request
  // observer, so they must share the same durable journal as extension calls.
  journalVaultMutationRequest(url, options.method || 'GET', headers);
  const response = await fetch(url, { ...options, headers });
  assert(response.ok, `http_${response.status}_${options.label || 'request'}`);
  return response.status === 204 ? null : response.json();
}
async function items() {
  const response = await api(`${API}/api/vault/items?principal_type=user`, { label: 'item_list' });
  assert(Array.isArray(response.items), 'item_list_shape');
  return response.items;
}
async function item(id) {
  const response = await api(`${API}/api/vault/items/${encodeURIComponent(id)}`, {
    label: 'item_get',
  });
  assert(response && response.id === id && Array.isArray(response.fields), 'item_shape');
  return response;
}
async function createFixture(displayName, fields) {
  const key = crypto.randomUUID();
  createKeys.add(key);
  proof.ownedCreateMutationKeys = [...createKeys];
  persist();
  const options = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      principal: { type: 'user' },
      display_name: displayName,
      definition_key: 'website_login',
      fields,
      login_urls: [localUrl],
      uri_match_mode: 'host',
      browser_fill_enabled: true,
    }),
    label: 'fixture_create',
  };
  const headers = { ...options.headers, Authorization: `Bearer ${token}` };
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  proof.setupRetry ||= { status: null, count: 0 };
  persist();
  const { response: rawResponse } = await createFixtureSetupWithRetry({
    url: `${API}/api/vault/items`,
    headers,
    body: options.body,
    fetchImpl: fetch,
    journalRequest: ({ url, method, headers: requestHeaders }) =>
      journalVaultMutationRequest(url, method, requestHeaders),
    recordRetry: ({ status }) => {
      proof.setupRetry = { status, count: proof.setupRetry.count + 1 };
      persist();
    },
    wait,
  });
  assert(rawResponse.ok, `http_${rawResponse.status}_${options.label}`);
  const response = rawResponse.status === 204 ? null : await rawResponse.json();
  assert(typeof response?.id === 'string', 'fixture_create_shape');
  createdIds.add(response.id);
  proof.ownedFixtureIds = [...createdIds];
  proof.ownedCreateMutationKeys = [...createKeys];
  persist();
  return response.id;
}
function receiptKeys() {
  for (const key of rejectedBeforeForwardKeys)
    assert(
      !responseLossFixtureKeys.has(key) && key !== responseLossKey,
      'response_loss_excluded_owned_key',
    );
  return [...createKeys].filter((key) => !rejectedBeforeForwardKeys.has(key));
}
async function reconcile() {
  const python = '/Users/armanisadeghi/code/aidream/.venv/bin/python';
  const { stdout } = await execFileAsync(
    python,
    [path.join(__dirname, 'reconcile-vault-canary.py'), userId, organizationId, ...receiptKeys()],
    { cwd: '/Users/armanisadeghi/code/aidream', timeout: 15000, maxBuffer: 32768 },
  );
  const result = JSON.parse(stdout);
  assert(Array.isArray(result.results), 'receipt_shape');
  assert(result.results.length === receiptKeys().length, 'receipt_incomplete');
  const ids = new Set(result.results.map((row) => row.result_item_id));
  assert(ids.size === receiptKeys().length, 'receipt_duplicate_item');
  for (const row of result.results) {
    assert(receiptKeys().includes(row.mutation_id), 'receipt_unexpected_key');
    receiptItemByKey.set(row.mutation_id, row.result_item_id);
  }
  for (const row of result.results)
    assert(row.user_id === userId && row.organization_id === null && !row.retired, 'receipt_scope');
  // A response may be lost after the server commits. Receipt truth, rather than
  // the client response, determines every cleanup target.
  for (const id of ids) {
    assert(!baselineIds.has(id), 'receipt_baseline_refusal');
    createdIds.add(id);
  }
  return ids;
}
async function localCanonicalCleanup(proven) {
  assert(localCanonicalCleanupArmed, 'local_cleanup_not_armed');
  const sourceRoot = await resolveLocalSourceRoot();
  const routerHash = required('MATRX_VAULT_CANARY_LOCAL_ROUTER_SHA256');
  const serviceHash = required('MATRX_VAULT_CANARY_LOCAL_SERVICE_SHA256');
  assert(
    /^[a-f0-9]{64}$/.test(routerHash) && /^[a-f0-9]{64}$/.test(serviceHash),
    'local_cleanup_hash_shape',
  );
  const python = '/Users/armanisadeghi/code/aidream/.venv/bin/python';
  const adapter = path.join(__dirname, 'cleanup-vault-canary.py');
  const input = JSON.stringify({
    token,
    userId,
    organizationId,
    createKeys: receiptKeys(),
    baselineIds: [...baselineIds],
    provenIDs: [...proven],
    expectedRouterSha256: routerHash,
    expectedServiceSha256: serviceHash,
    sourceRoot,
  });
  assert(
    Buffer.byteLength(input, 'utf8') < LOCAL_CLEANUP_INPUT_MAX_BYTES,
    'local_cleanup_payload_capacity',
  );
  const result = await new Promise((resolve, reject) => {
    const child = spawn(python, [adapter], {
      cwd: sourceRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 32768) child.kill();
    });
    child.once('error', () => reject(new Error('local_cleanup_spawn_refused')));
    child.once('close', (code) => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return reject(new Error('local_cleanup_output_refused'));
      }
      if (code !== 0 || parsed?.ok !== true) {
        proof.cleanup.canonicalAdapterFailure = {
          code: /^[a-z0-9_]{1,100}$/.test(parsed?.code || '') ? parsed.code : 'unclassified',
          errorType: /^[A-Za-z]{1,80}$/.test(parsed?.errorType || '')
            ? parsed.errorType
            : undefined,
          stage: /^[a-z_]{1,100}$/.test(parsed?.stage || '') ? parsed.stage : undefined,
        };
        return reject(new Error('local_cleanup_refused'));
      }
      resolve(parsed);
    });
    child.stdin.once('error', () => reject(new Error('local_cleanup_stdin_refused')));
    child.stdin.end(input);
  });
  assert(Array.isArray(result.attempts), 'local_cleanup_attempts_refused');
  const attemptedIds = new Set(result.attempts.map((attempt) => attempt.id));
  assert(
    result.route === 'local_canonical_authmiddleware' &&
      result.provenance === 'local_router_and_service_hash_pinned' &&
      result.receiptCount === proven.size &&
      result.attempts.length === proven.size &&
      attemptedIds.size === proven.size &&
      [...proven].every((id) => attemptedIds.has(id)) &&
      result.attempts.every((attempt) =>
        ['already_cleaned', 'deleted_and_missing'].includes(attempt.terminal),
      ),
    'local_cleanup_proof_refused',
  );
  return result;
}
async function distributedReceiptCleanupFallback(proven) {
  assert(token && organizationId, 'distributed_cleanup_identity_refused');
  for (const id of proven) {
    assert(createdIds.has(id) && !baselineIds.has(id), 'distributed_cleanup_ownership_refused');
  }
  const result = await cleanupReceiptOwnedFallback({
    receiptIds: proven,
    request: createDistributedReceiptCleanupRequest({
      apiBaseUrl: API,
      token,
      organizationId,
      journalRequest: journalVaultMutationRequest,
      fetchImpl: fetch,
    }),
  });
  proof.cleanup.distributedFallback = result;
  return result;
}
async function attachPanelSession(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let nextId = 0;
  const pending = new Map();
  const eventListeners = new Set();
  let detached = false;
  const recordProtocolFailure = (method, category, error) => {
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    proof.panelProtocolFailure = {
      method,
      targetId,
      category,
      detached,
      errorCode: Number.isInteger(error?.code) ? error.code : null,
      messageClass: /session/.test(message)
        ? 'session'
        : /context/.test(message)
          ? 'context'
          : /target/.test(message)
            ? 'target'
            : /parameter|argument|invalid/.test(message)
              ? 'parameter'
              : 'other',
    };
    try {
      persist();
    } catch {
      // This diagnostic must never replace the original panel failure.
    }
  };
  const onDetached = ({ sessionId: received, targetId: receivedTarget }) => {
    if (received === sessionId || receivedTarget === targetId) detached = true;
  };
  const onMessage = ({ sessionId: received, message }) => {
    if (received !== sessionId) return;
    let envelope;
    try {
      envelope = JSON.parse(message);
    } catch {
      return;
    }
    const waiter = pending.get(envelope.id);
    if (!waiter) {
      if (typeof envelope.method === 'string') {
        for (const listener of eventListeners) {
          try {
            listener(envelope.method, envelope.params ?? {});
          } catch {
            /* diagnostic observers cannot affect the panel */
          }
        }
      }
      return;
    }
    pending.delete(envelope.id);
    clearTimeout(waiter.timer);
    if (envelope.error) {
      recordProtocolFailure(waiter.method, 'nested_response_error', envelope.error);
      waiter.reject(new Error('panel_protocol_refused'));
    } else {
      waiter.resolve(envelope.result);
    }
  };
  cdp.on('Target.receivedMessageFromTarget', onMessage);
  cdp.on('Target.detachedFromTarget', onDetached);
  return {
    dispose() {
      cdp.off('Target.receivedMessageFromTarget', onMessage);
      cdp.off('Target.detachedFromTarget', onDetached);
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('panel_session_closed'));
      }
      pending.clear();
      eventListeners.clear();
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const fail = (category, error) => {
          const waiter = pending.get(id);
          if (!waiter) return;
          clearTimeout(waiter.timer);
          pending.delete(id);
          recordProtocolFailure(method, category, error);
          reject(new Error('panel_protocol_refused'));
        };
        const timer = setTimeout(() => fail('reply_timeout'), 10000);
        pending.set(id, { resolve, reject, timer, method });
        cdp
          .send('Target.sendMessageToTarget', {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch((error) => fail('transport_rejection', error));
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}
async function openGenuineSidePanel(
  extensionId,
  popup,
  { existing = false, previousTargetId, browserContext = context, workerFacade = worker } = {},
) {
  if (!existing) {
    await popup.bringToFront();
    await popup.getByRole('button', { name: 'Open chat', exact: true }).click();
  }
  let contexts = [];
  if (!previousTargetId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      contexts = await workerFacade.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
      );
      if (
        contexts.length === 1 &&
        contexts[0].documentUrl === `chrome-extension://${extensionId}/sidepanel.html` &&
        contexts[0].tabId === -1
      )
        break;
      await wait(250);
    }
    assert(contexts.length === 1 && contexts[0].tabId === -1, 'real_side_panel_missing');
  }
  const host = browserContext.pages()[0];
  assert(host, 'cdp_host_missing');
  const cdp = await browserContext.newCDPSession(host);
  let target;
  let panel;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const targets = await cdp.send('Target.getTargets');
      target = targets.targetInfos.find(
        (candidate) =>
          candidate.url === `chrome-extension://${extensionId}/sidepanel.html` &&
          candidate.type === 'page' &&
          candidate.targetId !== previousTargetId,
      );
      if (target) break;
      await wait(250);
    }
    assert(target?.type === 'page', 'real_side_panel_target_missing');
    panel = await attachPanelSession(cdp, target.targetId);
    await panel.send('Network.enable');
  } catch (error) {
    panel?.dispose();
    await cdp.detach().catch(() => {});
    throw error;
  }
  const evaluate = async (expression) => {
    let result;
    try {
      result = await panel.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
    } catch (error) {
      if (error.message === 'panel_protocol_refused' && proof.panelProtocolFailure) {
        proof.panelProtocolFailure.callerLocations = safeVaultStackLocations(new Error().stack);
        try {
          persist();
        } catch {
          /* preserve the original protocol failure */
        }
      }
      throw error;
    }
    if (result.exceptionDetails) {
      proof.panelEvalFailure = {
        exceptionClass: result.exceptionDetails.exception?.className ?? 'unknown',
        stackLocations: safeVaultStackLocations(new Error().stack),
      };
      persist();
      throw new Error('real_side_panel_eval_refused');
    }
    return result.result.value;
  };
  const click = async (expression) => {
    let box;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      box = await evaluate(
        `(() => { const element = (${expression}); if (!element) return null; element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const rect = element.getBoundingClientRect(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, targetTag: element.tagName, hitTag: hit?.tagName ?? null, hitPath: (() => { const nodes = []; for (let node = hit; node && nodes.length < 4; node = node.parentElement) nodes.push({ tag: node.tagName, role: node.getAttribute('role'), classes: typeof node.className === 'string' ? node.className.slice(0, 240) : '', pointerEvents: getComputedStyle(node).pointerEvents }); return nodes; })(), disabled: element.disabled === true, viewport: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, hit: !!hit && (hit === element || element.contains(hit)) }; })()`,
      );
      if (box?.width > 0 && box?.height > 0 && box.viewport && box.hit) break;
      await wait(250);
    }
    if (!(box?.width > 0 && box?.height > 0 && box.viewport && box.hit)) {
      proof.panelControlFailure = {
        geometry: box,
        callerLocations: safeVaultStackLocations(new Error().stack),
      };
      try {
        // Failure-only diagnostic: mask generated DOM values before any image.
        // This does not alter product state or turn a failed click into a pass.
        await evaluate(
          `(() => { const style = document.createElement('style'); style.textContent = '[aria-label="Password generator"] code { visibility: hidden !important; }'; document.head.append(style); return true; })()`,
        );
        const captured = await panel.send('Page.captureScreenshot', { format: 'png' });
        if (typeof captured.data === 'string') {
          await fs.writeFile(
            path.join(root, 'panel-failure-masked.png'),
            Buffer.from(captured.data, 'base64'),
            { mode: 0o600 },
          );
          proof.panelControlFailure.maskedScreenshot = true;
        }
      } catch {
        proof.panelControlFailure.maskedScreenshot = false;
      }
      persist();
      throw new Error('real_side_panel_control_not_actionable');
    }
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
    await panel.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    });
  };
  const waitFor = async (expression, expected = true, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    do {
      if ((await evaluate(expression)) === expected) return;
      await wait(100);
    } while (Date.now() < deadline);
    throw new Error('panel_condition_timeout');
  };
  const fill = async (expression, value) => {
    await click(expression);
    assert(await evaluate(`document.activeElement === (${expression})`), 'panel_input_not_focused');
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      modifiers,
      windowsVirtualKeyCode: 65,
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      modifiers,
      windowsVirtualKeyCode: 65,
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await panel.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await panel.send('Input.insertText', { text: value });
    await waitFor(`(${expression})?.value === ${JSON.stringify(value)}`);
  };
  // Use Chrome's input protocol rather than a DOM click for keyboard-only
  // acceptance. This preserves the browser's native focus-visible behavior.
  const key = async ({ key, code, windowsVirtualKeyCode, modifiers = 0, text }) => {
    // A focused native button activates on Enter's text-bearing keyDown. This
    // matches Chrome's keyboard path; a key code alone only delivers events.
    const effectiveText = text ?? (key === 'Enter' ? '\r' : undefined);
    const params = {
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      modifiers,
    };
    if (effectiveText !== undefined) {
      params.text = effectiveText;
      params.unmodifiedText = effectiveText;
    }
    await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await panel.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  };
  const startKnobResolveProbe = () => {
    const calls = new Map();
    const stop = panel.onEvent((method, params) => {
      if (method === 'Network.requestWillBeSent') {
        let pathname;
        try {
          pathname = new URL(params.request?.url).pathname;
        } catch {
          return;
        }
        if (pathname !== '/rest/v1/rpc/knob_resolve') return;
        calls.set(params.requestId, { startedAt: Date.now(), status: null, completedAt: null });
      }
      if (method === 'Network.responseReceived' && calls.has(params.requestId)) {
        const call = calls.get(params.requestId);
        call.status = Number.isInteger(params.response?.status) ? params.response.status : null;
        call.completedAt = Date.now();
      }
    });
    return {
      snapshot: () => {
        const entries = [...calls.values()];
        return {
          requestCount: entries.length,
          responseCount: entries.filter((call) => call.completedAt !== null).length,
          pendingCount: entries.filter((call) => call.completedAt === null).length,
          statuses: entries.map((call) => call.status),
          elapsedMs: entries.map((call) => (call.completedAt ?? Date.now()) - call.startedAt),
        };
      },
      stop,
    };
  };
  const screenshot = async (expression, destination) => {
    const clip = await evaluate(
      `(() => { const element = (${expression}); if (!element) return null; element.scrollIntoView({ block: 'nearest' }); const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight ? { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } : null; })()`,
    );
    assert(clip, 'panel_screenshot_not_visible');
    const captured = await panel.send('Page.captureScreenshot', { format: 'png', clip });
    assert(typeof captured.data === 'string', 'panel_screenshot_refused');
    await fs.writeFile(destination, Buffer.from(captured.data, 'base64'), { mode: 0o600 });
  };
  return {
    targetId: target.targetId,
    send: (method, params) => panel.send(method, params),
    onEvent: panel.onEvent,
    evaluate,
    click,
    waitFor,
    fill,
    key,
    startKnobResolveProbe,
    screenshot,
    dispose: async () => {
      panel.dispose();
      await cdp.detach().catch(() => {});
    },
  };
}
async function openSidePanelFromActionPopup(
  extensionId,
  fixturePage,
  fixtureWindowId,
  workerFacade = worker,
  browserContext = context,
) {
  // This is intentionally not a normal popup.html tab. The action popup is
  // opened for the already-focused fixture window, then its existing product
  // control receives real target-directed CDP input.
  const cdp = await browserContext.newCDPSession(fixturePage);
  let handedOff = false;
  let panel;
  try {
    const targetUrl = `chrome-extension://${extensionId}/popup.html`;
    const before = await cdp.send('Target.getTargets');
    const knownPopupTargets = new Set(
      before.targetInfos
        .filter((target) => target.url === targetUrl)
        .map((target) => target.targetId),
    );
    const result = await workerFacade.evaluate(async (windowId) => {
      if (typeof chrome.action?.openPopup !== 'function') return { outcome: 'api_unavailable' };
      try {
        await chrome.action.openPopup({ windowId });
        return { outcome: 'requested' };
      } catch (error) {
        return { outcome: 'refused', error: error?.name === 'Error' ? 'error' : 'other' };
      }
    }, fixtureWindowId);
    if (result?.outcome !== 'requested')
      return { opened: false, reason: result?.outcome ?? 'action_popup_not_requested' };
    let popupTarget;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const targets = await cdp.send('Target.getTargets');
      popupTarget = targets.targetInfos.find(
        (target) =>
          target.url === targetUrl &&
          target.type === 'page' &&
          !knownPopupTargets.has(target.targetId),
      );
      if (popupTarget) break;
      await wait(100);
    }
    if (!popupTarget) return { opened: false, reason: 'action_popup_target_missing' };
    const popup = await attachPanelSession(cdp, popupTarget.targetId);
    try {
      let box;
      let attempts = 0;
      for (; attempts < 30; attempts += 1) {
        const response = await popup.send('Runtime.evaluate', {
          expression: `(() => { const control = Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === 'Open chat'); if (!control) return { control: false }; control.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const rect = control.getBoundingClientRect(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2; const hit = document.elementFromPoint(x, y); return { control: true, x, y, width: rect.width, height: rect.height, visible: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, hit: !!hit && (hit === control || control.contains(hit)) }; })()`,
          returnByValue: true,
        });
        box = response.result?.value;
        if (box?.control && box.width > 0 && box.height > 0 && box.visible && box.hit) break;
        await wait(100);
      }
      if (!(box?.control && box.width > 0 && box.height > 0 && box.visible && box.hit)) {
        return {
          opened: false,
          reason: 'action_popup_open_chat_not_actionable',
          readiness: {
            attempts,
            controlPresent: box?.control === true,
            positiveSize: box?.width > 0 && box?.height > 0,
            viewportHit: box?.visible === true && box?.hit === true,
          },
        };
      }
      await popup.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await popup.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      });
      await popup.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      });
    } finally {
      popup.dispose();
    }
    let contexts = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      contexts = await workerFacade.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
      );
      if (
        contexts.length === 1 &&
        contexts[0].documentUrl === `chrome-extension://${extensionId}/sidepanel.html` &&
        contexts[0].tabId === -1
      )
        break;
      await wait(100);
    }
    if (!(contexts.length === 1 && contexts[0].tabId === -1))
      return { opened: false, reason: 'reopened_side_panel_context_missing' };
    const targets = await cdp.send('Target.getTargets');
    const matchingPanels = targets.targetInfos.filter(
      (candidate) =>
        candidate.url === `chrome-extension://${extensionId}/sidepanel.html` &&
        candidate.type === 'page',
    );
    if (matchingPanels.length !== 1)
      return { opened: false, reason: 'reopened_side_panel_target_not_unique' };
    const target = matchingPanels[0];
    panel = await attachPanelSession(cdp, target.targetId);
    try {
      await panel.send('Network.enable');
    } catch (error) {
      panel.dispose();
      throw error;
    }
    const evaluate = async (expression) => {
      const evaluation = await panel.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (evaluation.exceptionDetails) throw new Error('reopened_side_panel_eval_refused');
      return evaluation.result.value;
    };
    const click = async (expression) => {
      const box = await evaluate(
        `(() => { const element = (${expression}); if (!element) return null; element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const rect = element.getBoundingClientRect(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, width: rect.width, height: rect.height, visible: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, hit: !!hit && (hit === element || element.contains(hit)) }; })()`,
      );
      assert(
        box?.width > 0 && box?.height > 0 && box.visible && box.hit,
        'reopened_side_panel_control_not_actionable',
      );
      await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await panel.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      });
      await panel.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
      });
    };
    const waitFor = async (expression, expected = true, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      do {
        if ((await evaluate(expression)) === expected) return;
        await wait(100);
      } while (Date.now() < deadline);
      throw new Error('reopened_panel_condition_timeout');
    };
    const key = async ({ key, code, windowsVirtualKeyCode, modifiers = 0, text }) => {
      const effectiveText = text ?? (key === 'Enter' ? '\r' : undefined);
      const params = {
        key,
        code,
        windowsVirtualKeyCode,
        nativeVirtualKeyCode: windowsVirtualKeyCode,
        modifiers,
      };
      if (effectiveText !== undefined) {
        params.text = effectiveText;
        params.unmodifiedText = effectiveText;
      }
      await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
      await panel.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    };
    const startKnobResolveProbe = () => {
      const calls = new Map();
      const stop = panel.onEvent((method, params) => {
        if (method === 'Network.requestWillBeSent') {
          let pathname;
          try {
            pathname = new URL(params.request?.url).pathname;
          } catch {
            return;
          }
          if (pathname === '/rest/v1/rpc/knob_resolve')
            calls.set(params.requestId, { startedAt: Date.now(), status: null, completedAt: null });
        }
        if (method === 'Network.responseReceived' && calls.has(params.requestId)) {
          const call = calls.get(params.requestId);
          call.status = Number.isInteger(params.response?.status) ? params.response.status : null;
          call.completedAt = Date.now();
        }
      });
      return {
        snapshot: () => {
          const entries = [...calls.values()];
          return {
            requestCount: entries.length,
            responseCount: entries.filter((call) => call.completedAt !== null).length,
            pendingCount: entries.filter((call) => call.completedAt === null).length,
            statuses: entries.map((call) => call.status),
            elapsedMs: entries.map((call) => (call.completedAt ?? Date.now()) - call.startedAt),
          };
        },
        stop,
      };
    };
    const screenshot = async (expression, destination) => {
      const clip = await evaluate(
        `(() => { const element = (${expression}); if (!element) return null; element.scrollIntoView({ block: 'nearest' }); const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight ? { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } : null; })()`,
      );
      assert(clip, 'reopened_panel_screenshot_not_visible');
      const captured = await panel.send('Page.captureScreenshot', { format: 'png', clip });
      assert(typeof captured.data === 'string', 'reopened_panel_screenshot_refused');
      await fs.writeFile(destination, Buffer.from(captured.data, 'base64'), { mode: 0o600 });
    };
    handedOff = true;
    return {
      opened: true,
      panel: {
        targetId: target.targetId,
        send: (method, params) => panel.send(method, params),
        onEvent: panel.onEvent,
        evaluate,
        click,
        waitFor,
        key,
        startKnobResolveProbe,
        screenshot,
        dispose: async () => {
          panel.dispose();
          await cdp.detach().catch(() => {});
        },
      },
    };
  } finally {
    if (!handedOff) {
      panel?.dispose();
      await cdp.detach().catch(() => {});
    }
  }
}

// This failure-only snapshot never persists panel text or identity values.
// It distinguishes an unopened Settings view from a hydrated view that lacks
// the already-required test identity, while preserving the original failure.
async function settingsIdentityFailureState(panel) {
  const observed = await panel.evaluate(`(() => {
    const text = document.body.innerText;
    const visibleButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
    return {
      settingsHeadingVisible: text.includes('Settings'),
      expectedIdentityVisible: text.includes('admin@admin.com'),
      signInVisible: visibleButtons.some((button) => button.textContent.trim() === 'Sign in'),
      signOutVisible: visibleButtons.some((button) => button.textContent.trim() === 'Sign out'),
    };
  })()`);
  return {
    snapshotUnavailable: false,
    settingsHeadingVisible: observed?.settingsHeadingVisible === true,
    expectedIdentityVisible: observed?.expectedIdentityVisible === true,
    signInVisible: observed?.signInVisible === true,
    signOutVisible: observed?.signOutVisible === true,
  };
}
async function chooseAuthorizedOrganization(extensionId) {
  const settingsPage = await context.newPage();
  const selection = {
    settingsReady: 'not_observed',
    organizationSectionOpened: false,
    actingAsVisible: false,
    outcome: 'in_progress',
  };
  proof.organizationSelection = selection;
  persist();
  try {
    checkpoint('organization_settings_navigation');
    await settingsPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    checkpoint('organization_settings_open');
    await settingsPage.getByTitle('Settings', { exact: true }).click();
    const actingAs = settingsPage.getByText('Acting as', { exact: true });
    const organizationButton = settingsPage.getByRole('button', {
      name: 'Organization',
      exact: true,
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await actingAs.isVisible()) {
        selection.settingsReady = 'acting_as_visible';
        selection.actingAsVisible = true;
        break;
      }
      if (await organizationButton.isVisible()) {
        selection.settingsReady = 'organization_button_visible';
        break;
      }
      await wait(250);
    }
    assert(selection.settingsReady !== 'not_observed', 'organization_settings_not_ready');
    persist();
    if (!selection.actingAsVisible) {
      checkpoint('organization_section_open');
      await organizationButton.click();
      selection.organizationSectionOpened = true;
      await actingAs.waitFor({ state: 'visible', timeout: 10000 });
      selection.actingAsVisible = true;
      persist();
    }
    checkpoint('organization_combobox_open');
    await actingAs.locator('xpath=../..').getByRole('combobox').click();
    checkpoint('organization_option_select');
    await settingsPage.getByRole('option', { name: 'AI Matrx', exact: true }).click();
    checkpoint('organization_persist');
    await waitForActiveOrganization();
    selection.outcome = 'persisted';
    persist();
  } catch (error) {
    selection.outcome = error?.name === 'TimeoutError' ? 'timeout' : 'refused_or_error';
    persist();
    throw error;
  } finally {
    await settingsPage.close();
  }
}
async function waitForActiveOrganization() {
  let active;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    active = (await storage(['matrx.org.active']))['matrx.org.active'];
    if (active?.name === 'AI Matrx' && typeof active.id === 'string' && active.id.length > 10)
      return active;
    await wait(500);
  }
  throw new Error('authorized_organization_not_persisted');
}
async function authenticate(extension, { reuseBrowser = false } = {}) {
  assert(typeof process.loadEnvFile === 'function', 'node_env_loader_unavailable');
  process.loadEnvFile('/Users/armanisadeghi/code/aidream/.env');
  const adminEmail = required('AI_ADMIN_USERNAME');
  const adminPassword = required('AI_ADMIN_PASSWORD');
  assert(adminEmail === 'admin@admin.com', 'admin_identity_configuration');
  if (!reuseBrowser) {
    proof.phase = 'browser_launch';
    persist();
    const placementPath = process.env.MATRX_VAULT_CANARY_WINDOW_PLACEMENT;
    const configuredExecutable = process.env.MATRX_VAULT_CANARY_CHROME_EXECUTABLE;
    const executablePath = configuredExecutable || chromium.executablePath();
    if (edgeBrowserMode) {
      assert(
        headlessNoClipboardMode && !isolatedHeadlessClipboard,
        'edge_requires_owned_headless_without_clipboard',
      );
      assert(
        configuredExecutable ===
          '/Users/armanisadeghi/Library/Caches/matrx-vault-test/edge-153.0.4234.48/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        'edge_requires_reviewed_runtime',
      );
    }
    if (headlessNoClipboardMode && !edgeBrowserMode) {
      // `chromium.executablePath()` can identify Playwright's headless shell;
      // extension/SIDE_PANEL acceptance needs the complete Chrome-for-Testing app.
      assert(
        typeof configuredExecutable === 'string' && configuredExecutable.length > 0,
        'headless_requires_explicit_chrome_for_testing',
      );
      assert(
        /Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing$/.test(
          configuredExecutable,
        ),
        'headless_requires_full_chrome_for_testing',
      );
      const executable = await fs.stat(configuredExecutable).catch(() => null);
      assert(executable?.isFile(), 'headless_chrome_for_testing_missing');
    }
    const placementArgs = placementPath
      ? (() => {
          const bounds = JSON.parse(syncFs.readFileSync(placementPath, 'utf8'));
          const coordinate = (value) =>
            Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
          assert(
            coordinate(bounds.left) &&
              coordinate(bounds.top) &&
              Number.isInteger(bounds.width) &&
              Number.isInteger(bounds.height) &&
              bounds.width > 0 &&
              bounds.width <= 2147483647 &&
              bounds.height > 0 &&
              bounds.height <= 2147483647,
            'window_placement_invalid',
          );
          return [
            `--window-position=${bounds.left},${bounds.top}`,
            `--window-size=${bounds.width},${bounds.height}`,
          ];
        })()
      : [];
    await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    const preparedOwnedProfile = await prepareOwnedProfile(profile);
    context = await chromium.launchPersistentContext(profile, {
      // This is the disposable, agent-owned Chrome-for-Testing profile only.
      // Headless mode still uses the full browser, never Playwright's shell.
      headless: headlessNoClipboardMode,
      executablePath,
      ...(edgeBrowserMode ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
      args: [
        ...(headlessNoClipboardMode ? ['--headless=new'] : []),
        ...(isolatedHeadlessClipboard || edgeBrowserMode ? ['--enable-automation'] : []),
        ...(edgeBrowserMode ? ['--enable-extensions'] : []),
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        ...placementArgs,
      ],
      ...(placementPath && { viewport: null }),
    });
    rawCdp = await connectOwnedCdp({
      preparedProfile: preparedOwnedProfile,
      chromeExecutable: executablePath,
    });
    if (edgeBrowserMode) {
      const version = await rawCdp.send('Browser.getVersion');
      const command = await rawCdp.send('Browser.getBrowserCommandLine');
      assert(version.product === 'Edg/153.0.4234.48', 'edge_runtime_not_reviewed');
      assert(
        command.arguments.includes('--headless=new') &&
          command.arguments.includes('--user-data-dir=' + profile) &&
          !command.arguments.includes('--disable-extensions'),
        'edge_process_not_owned_headless',
      );
      proof.browserRuntime = {
        product: version.product,
        ownedHeadlessProcess: true,
        clipboardTested: false,
      };
    }
    if (isolatedHeadlessClipboard) {
      const version = await rawCdp.send('Browser.getVersion');
      const command = await rawCdp.send('Browser.getBrowserCommandLine');
      assert(version.product === 'Chrome/153.0.8010.12', 'clipboard_runtime_not_reviewed');
      assert(
        command.arguments.includes('--headless=new') &&
          command.arguments.includes('--user-data-dir=' + profile),
        'clipboard_process_not_owned_headless',
      );
      proof.clipboardIsolation = {
        runtime: version.product,
        ownedHeadlessProcess: true,
        sourceAndProbe: 'd37f9103-bbb3-4eb3-9cf2-537eb75c7339',
      };
    }
    networkJournal = createVaultNetworkJournal({
      cdp: rawCdp,
      apiOrigin: API,
      onVaultRequest: ({ method, pathname, headers }) =>
        journalVaultMutationRequest(`${API}${pathname}`, method, headers),
    });
    await networkJournal.start();
    proof.networkJournal = {
      ownerVerified: rawCdp.ownerVerified === true,
      journalSemanticVersion: 2,
    };
    proof.phase = 'extension_worker';
    persist();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    extensionId = await worker.evaluate(() => chrome.runtime.id);
    assert(
      typeof extensionId === 'string' && extensionId.length > 10,
      'extension_runtime_identity',
    );
    // The flattened owned-browser journal accounts for page traffic. Playwright
    // observes only service-worker traffic, preventing page request duplicates.
    const requestStartedAt = new WeakMap();
    context.on('request', (request) => {
      if (request.serviceWorker()) {
        requestStartedAt.set(request, Date.now());
        journalVaultMutationRequest(request.url(), request.method(), request.headers());
      }
    });
    context.on('response', (response) => {
      const request = response.request();
      const url = new URL(response.url());
      if (!request.serviceWorker()) return;
      if (
        url.origin === DB &&
        ['/auth/v1/oauth/token', '/auth/v1/user', '/auth/v1/logout'].includes(url.pathname)
      ) {
        const route = url.pathname.endsWith('/token')
          ? 'oauth_token'
          : url.pathname.endsWith('/logout')
            ? 'logout'
            : 'user';
        (proof.authTransport ||= []).push({ route, status: response.status(), phase: proof.phase });
        persist();
      }
      if (url.origin !== API || !url.pathname.startsWith('/api/vault/')) return;
      // Only fixed route classes/statuses: never response bodies, IDs or values.
      const route = url.pathname.endsWith('/matches')
        ? 'matches'
        : /\/fields\/[^/]+$/.test(url.pathname)
          ? 'field'
          : /\/items\/[^/]+$/.test(url.pathname)
            ? 'item'
            : url.pathname.endsWith('/items')
              ? 'items'
              : 'other';
      (proof.apiResponses ||= []).push({
        route,
        method: response.request().method(),
        status: response.status(),
        phase: proof.phase,
        elapsedMs: requestStartedAt.has(response.request())
          ? Date.now() - requestStartedAt.get(response.request())
          : null,
      });
      persist();
    });
  }
  // Persist the zeroed journal before OAuth so an interruption still shows
  // whether the run had admitted any Vault POST before authentication.
  persist();
  proof.oauthUi = {
    popupNavigated: false,
    popupSignInClicked: false,
    authPageOpened: false,
    expectedOrigin: false,
    loginFieldsReady: false,
    authPageOpenOutcome: 'not_attempted',
    loginDisposition: 'not_observed',
    consentDisposition: 'not_observed',
    consentAuthorizeRenderedEnabled: false,
    callbackStorageObserved: false,
    consentApproveDisposition: 'not_attempted',
    consentApproval: null,
    callbackAfterApprove: 'not_observed',
  };
  const oauthUiStep = async (phase, failureCategory, operation) => {
    checkpoint(phase);
    try {
      return await operation();
    } catch {
      proof.oauthUi.failureCategory = failureCategory;
      persist();
      throw new Error(failureCategory);
    }
  };
  const popup = await oauthUiStep(
    'oauth_popup_navigation',
    'oauth_popup_navigation_failed',
    async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      return page;
    },
  );
  proof.oauthUi.popupNavigated = true;
  persist();
  const authPagePromise = context.waitForEvent('page', { timeout: 15000 });
  // Keep the wait observed if the click itself fails; its classified result is
  // still awaited on the successful-click path below.
  void authPagePromise.catch(() => {});
  await oauthUiStep('oauth_popup_sign_in_click', 'oauth_popup_sign_in_click_failed', () =>
    popup.getByRole('button', { name: 'Sign in' }).click(),
  );
  proof.oauthUi.popupSignInClicked = true;
  persist();
  const authPage = await oauthUiStep(
    'oauth_auth_page_opened',
    'oauth_auth_page_open_failed',
    async () => {
      try {
        return await authPagePromise;
      } catch (error) {
        proof.oauthUi.authPageOpenOutcome =
          error?.name === 'TimeoutError' ? 'page_not_observed_timeout' : 'page_wait_refused';
        persist();
        throw error;
      }
    },
  );
  proof.oauthUi.authPageOpened = true;
  proof.oauthUi.authPageOpenOutcome = 'page_observed';
  persist();
  await oauthUiStep('oauth_auth_expected_origin', 'oauth_auth_expected_origin_timeout', () =>
    authPage.waitForURL((url) => url.origin === 'https://www.aimatrx.com', { timeout: 30000 }),
  );
  try {
    assert(new URL(authPage.url()).origin === 'https://www.aimatrx.com', 'oauth_origin');
  } catch {
    proof.oauthUi.failureCategory = 'oauth_auth_expected_origin_mismatch';
    persist();
    throw new Error('oauth_auth_expected_origin_mismatch');
  }
  proof.oauthUi.expectedOrigin = true;
  try {
    proof.oauthUi.authPageRoute = new URL(authPage.url()).pathname.startsWith('/oauth/consent')
      ? 'consent'
      : 'provider_login_or_existing_session';
  } catch {
    // A managed auth page can close only after the product callback begins;
    // awaitOAuthRouteOrCallback still requires fresh extension storage below.
    proof.oauthUi.authPageRoute = 'closing_after_callback';
  }
  persist();
  const initialOAuthDisposition = await oauthUiStep(
    'oauth_login_or_existing_session',
    'oauth_login_or_existing_session_timeout',
    () => awaitOAuthRouteOrCallback({ authPage, storage, adminEmail, allowLoginForm: true }),
  );
  proof.authenticationAttempted = true;
  let postPasswordSubmission;
  if (initialOAuthDisposition === 'password_form') {
    proof.oauthUi.loginFieldsReady = true;
    proof.oauthUi.loginDisposition = 'password_form';
    persist();
    await oauthUiStep('oauth_login_form_fill', 'oauth_login_form_fill_failed', async () => {
      await authPage.locator('#email').fill(adminEmail);
      await authPage.locator('#password').fill(adminPassword);
    });
    proof.phase = 'oauth_sign_in';
    persist();
    postPasswordSubmission = observeOAuthPostPasswordSubmission(authPage);
    await submitOAuthPasswordWithDiagnostics(
      authPage,
      postPasswordSubmission,
      proof.oauthUi,
      persist,
    );
  } else {
    proof.oauthUi.loginDisposition = 'existing_web_session';
    proof.phase = 'oauth_existing_web_session';
    persist();
  }
  let consentDisposition;
  try {
    consentDisposition =
      initialOAuthDisposition === 'password_form'
        ? await oauthUiStep('oauth_consent_or_callback', 'oauth_consent_or_callback_timeout', () =>
            awaitOAuthRouteOrCallback({ authPage, storage, adminEmail }),
          )
        : initialOAuthDisposition;
  } catch (error) {
    if (postPasswordSubmission) {
      try {
        await finalizeOAuthPostPasswordSubmission(postPasswordSubmission, proof.oauthUi, persist);
      } catch {
        postPasswordSubmission.finish();
      }
      await recordOAuthConsentFailureSnapshot(authPage, proof.oauthUi, persist);
    }
    throw error;
  }
  if (postPasswordSubmission) {
    await finalizeOAuthPostPasswordSubmission(postPasswordSubmission, proof.oauthUi, persist);
  }
  proof.oauthUi.consentDisposition = consentDisposition;
  if (consentDisposition === 'consent_error') {
    await oauthUiStep('oauth_consent_error', 'oauth_consent_identity_error', async () => {
      throw new Error('oauth_consent_identity_error');
    });
  }
  if (consentDisposition === 'consent_ready') {
    await oauthUiStep('oauth_consent_approve_ready', 'oauth_consent_authorize_unavailable', () =>
      authPage
        .getByRole('button', { name: 'Authorize', exact: true })
        .waitFor({ state: 'visible', timeout: 30000 }),
    );
    assert(
      await authPage.getByRole('button', { name: 'Authorize', exact: true }).isEnabled(),
      'oauth_consent_authorize_disabled',
    );
    proof.oauthUi.consentAuthorizeRenderedEnabled = true;
    persist();
    const consentApproval = observeOAuthConsentApproval(authPage, DB);
    checkpoint('oauth_consent_approve');
    await oauthUiStep('oauth_consent_approve', 'oauth_consent_authorize_click_failed', () =>
      authPage.getByRole('button', { name: 'Authorize', exact: true }).click(),
    );
    proof.oauthUi.consentApproveDisposition = 'authorize_clicked';
    persist();
    await oauthUiStep(
      'oauth_consent_approval_response',
      'oauth_consent_approval_response_invalid',
      () => consentApproval.requireFirst2xx(),
    );
    const callback = await oauthUiStep(
      'oauth_callback_storage',
      'oauth_callback_storage_timeout',
      () => awaitOAuthCallbackStorage({ authPage, storage, adminEmail }),
    );
    proof.oauthUi.consentApproval = await oauthUiStep(
      'oauth_consent_approval_count',
      'oauth_consent_approval_count_invalid',
      () => consentApproval.finish(),
    );
    proof.oauthUi.callbackAfterApprove = callback.authPageClosed
      ? 'storage_after_window_closed'
      : 'storage_after_managed_callback';
    proof.oauthUi.callbackStorageObserved = callback.callbackStorageObserved;
    persist();
  } else if (consentDisposition === 'redirecting') {
    const callback = await oauthUiStep(
      'oauth_redirecting_callback_storage',
      'oauth_callback_storage_timeout',
      () => awaitOAuthCallbackStorage({ authPage, storage, adminEmail }),
    );
    proof.oauthUi.callbackAfterApprove = callback.authPageClosed
      ? 'storage_after_window_closed'
      : 'storage_after_managed_callback';
    proof.oauthUi.callbackStorageObserved = callback.callbackStorageObserved;
    persist();
  }
  let session;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    session = await storage(['matrx.user.profile', 'matrx.auth.accessToken', 'matrx.org.active']);
    if (session['matrx.user.profile']?.email && session['matrx.auth.accessToken']) break;
    await wait(500);
  }
  proof.authStorage = {
    profilePresent: !!session?.['matrx.user.profile'],
    accessTokenPresent: typeof session?.['matrx.auth.accessToken'] === 'string',
    activeOrganizationPresent: !!session?.['matrx.org.active'],
  };
  proof.oauthUi.callbackStorageObserved =
    proof.authStorage.profilePresent && proof.authStorage.accessTokenPresent;
  // OAuth/UI text can include provider details. Retain only a fixed category
  // that distinguishes a visible failure from an unfinished callback.
  const popupText = await popup
    .locator('body')
    .innerText()
    .catch(() => '');
  proof.authUiOutcome = /authorization page could not be loaded/i.test(popupText)
    ? 'authorization_page_unavailable'
    : /sign in to start using the extension/i.test(popupText)
      ? 'signed_out'
      : 'no_classified_popup_error';
  persist();
  assert(session?.['matrx.user.profile']?.email === adminEmail, 'extension_identity');
  userId = session['matrx.user.profile'].id;
  token = session['matrx.auth.accessToken'];
  assert(typeof token === 'string' && token.length > 20, 'extension_token');
  // This deliberately happens before reading or choosing an organization.
  // /auth/v1/user is independent token evidence and must remain so for a
  // fresh profile that has not selected its tenant yet.
  const identity = await api(`${DB}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY },
    label: 'identity',
  });
  assert(identity.id === userId && identity.email === adminEmail, 'independent_admin_identity');
  proof.checks.independentAdminIdentity = true;
  proof.identityProof = {
    extensionProfileEmail: adminEmail,
    independentUserIdMatchesProfile: true,
  };
  proof.extensionId = extensionId;
  // Retain independent identity evidence even if organization selection fails.
  persist();
  realPanel = await openGenuineSidePanel(extensionId, popup);
  await networkJournal.bindPanelTarget(realPanel.targetId);
  if (
    (extensionLifecycleMode || setupIdentityOnlyMode || identityOnlyMode) &&
    !lifecycleLogoutObserver
  ) {
    lifecycleLogoutObserver = observeOwnedPanelLogout({
      panel: realPanel,
      extensionId,
      onResponse: ({ status }) => {
        const observed = (proof.lifecycleSettingsLogoutResponses ||= []);
        observed.push({ status, phase: proof.phase, observer: 'raw_cdp_owned_sidepanel' });
        persist();
      },
    });
    proof.lifecycleSettingsLogoutObserver = 'raw_cdp_owned_sidepanel';
  }
  // The initial auth popup was an ordinary setup tab. It must not remain as a
  // same-URL target when a lifecycle probe later opens the declared action popup.
  await popup.close();
  let active = session['matrx.org.active'];
  if (!active?.id) {
    proof.phase = 'organization_selection';
    persist();
    await chooseAuthorizedOrganization(extensionId);
    active = await waitForActiveOrganization();
  }
  organizationId = active?.id;
  assert(
    active?.name === 'AI Matrx' && typeof organizationId === 'string' && organizationId.length > 10,
    'organization_not_selected',
  );
  proof.organizationProof = { label: 'AI Matrx', activeStorageObserved: true };
  // Both identity and organization evidence exist before the first fixture.
  persist();
  assert(!(await hasPendingCapture()), 'admin_password_pending_before_writes');
}
async function focusOwnedBrowser(expectedTabId) {
  if (!headlessNoClipboardMode && process.platform !== 'darwin') return;
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], {
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const matches = stdout
    .split('\n')
    .filter((line) => line.includes(`--user-data-dir=${profile}`) && !line.includes('--type='));
  assert(matches.length === 1, 'owned_browser_process_not_unique');
  const pid = Number(matches[0].trim().split(/\s+/, 1)[0]);
  assert(Number.isSafeInteger(pid) && pid > 1, 'owned_browser_process_missing');
  if (headlessNoClipboardMode) {
    assert(matches[0].includes('--headless=new'), 'owned_headless_browser_process_missing');
    // Headless Chrome can report a normal focused window while retaining a
    // different active tab. Activate the receipt-owned tab through the
    // extension API after the PID/profile proof above, so this never reaches
    // a browser outside this harness's Chrome profile.
    await worker.evaluate(async (tabId) => {
      if (!Number.isInteger(tabId)) throw new Error('owned_expected_tab_missing');
      const expectedTab = await chrome.tabs.get(tabId);
      const expectedWindow = await chrome.windows.get(expectedTab.windowId, {
        populate: false,
      });
      if (expectedWindow.type !== 'normal') throw new Error('owned_expected_tab_window_invalid');
      await chrome.windows.update(expectedWindow.id, { focused: true });
      await chrome.tabs.update(expectedTab.id, { active: true });
    }, expectedTabId);
    let chromeFocus;
    let focused = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      chromeFocus = await worker.evaluate(async (tabId) => {
        const current = await chrome.windows.getLastFocused({
          windowTypes: ['normal'],
          populate: true,
        });
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
        const targetTab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : null;
        return {
          normalWindowCount: windows.length,
          focused: current.focused === true,
          focusedType: current.type,
          focusedWindowHasActiveTab:
            Array.isArray(current.tabs) && current.tabs.some((tab) => tab.active === true),
          expectedTabActive: targetTab?.active === true,
          expectedTabWindowMatchesFocused: targetTab?.windowId === current.id,
        };
      }, expectedTabId);
      focused =
        chromeFocus.normalWindowCount >= 1 &&
        chromeFocus.focused &&
        chromeFocus.focusedType === 'normal' &&
        chromeFocus.focusedWindowHasActiveTab &&
        chromeFocus.expectedTabActive &&
        chromeFocus.expectedTabWindowMatchesFocused;
      if (focused) break;
      await wait(100);
    }
    if (!focused) {
      proof.headlessChromeFocusFailure = {
        hasNormalWindow: chromeFocus.normalWindowCount >= 1,
        focused: chromeFocus.focused,
        focusedTypeIsNormal: chromeFocus.focusedType === 'normal',
        focusedWindowHasActiveTab: chromeFocus.focusedWindowHasActiveTab,
        expectedTabActive: chromeFocus.expectedTabActive,
        expectedTabWindowMatchesFocused: chromeFocus.expectedTabWindowMatchesFocused,
      };
      persist();
    }
    assert(focused, 'headless_chrome_normal_window_not_focused');
    proof.headlessChromeFocus = chromeFocus;
    persist();
    return;
  }
  await execFileAsync(
    'osascript',
    [
      '-e',
      `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
    ],
    { timeout: 5000 },
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        `ObjC.import('AppKit'); Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)`,
      ],
      { timeout: 5000, maxBuffer: 1024 },
    );
    if (Number(stdout.trim()) === pid) return;
    await wait(100);
  }
  throw new Error('owned_browser_not_frontmost');
}
async function verifyRealVaultPanel() {
  assert(realPanel, 'real_side_panel_unavailable');
  const vaultControl = 'document.querySelector(`[title="Vault"]`)';
  await realPanel.click(vaultControl);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      await realPanel.evaluate(
        `(() => { const control = (${vaultControl}); return control?.getAttribute('aria-selected') === 'true' && !!document.querySelector('[role="tabpanel"]'); })()`,
      )
    ) {
      proof.checks.realSidePanelVaultVisible = true;
      persist();
      return;
    }
    await wait(250);
  }
  throw new Error('real_side_panel_vault_not_visible');
}
async function verifyObservedVaultPanelRead() {
  // The Vault tab's own read can settle after the panel becomes visible.
  // Wait for its paired request and response from the bound observer before
  // writing fixtures; never count an unrelated or pre-bind request.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = networkJournal.snapshot();
    if (snapshot.panelItemsReadRequestSeen && snapshot.panelItemsReadResponse2xxSeen) {
      proof.checks.realSidePanelVaultReadObserved = true;
      persist();
      return;
    }
    await wait(250);
  }
  throw new Error('vault_panel_items_read_sentinel_missing');
}
async function chooseDifferentOrganizationInPanel(panel, activeWorker) {
  await panel.click(visibleSettingsControl);
  await panel.waitFor(`document.body.innerText.includes('Settings')`);
  const section = `Array.from(document.querySelectorAll('button[aria-expanded]')).find(
    (button) => button.textContent?.trim() === 'Organization')`;
  const expanded = await panel.evaluate(`(${section})?.getAttribute('aria-expanded') === 'true'`);
  if (!expanded) await panel.click(section);
  const trigger = `(() => {
    const labels = Array.from(document.querySelectorAll('span')).filter(
      (span) => span.textContent?.trim() === 'Acting as');
    return labels.length === 1 ? labels[0].parentElement?.parentElement?.querySelector('[role="combobox"]') : null;
  })()`;
  await panel.waitFor(`(${trigger}) !== null`);
  const before = await activeWorker.evaluate(async () => {
    const stored = await chrome.storage.local.get('matrx.org.active');
    return stored['matrx.org.active']?.id ?? null;
  });
  assert(typeof before === 'string' && before.length > 10, 'org_switch_initial_org_missing');
  await panel.click(trigger);
  const options = await panel.evaluate(`(() => {
    const visible = Array.from(document.querySelectorAll('[role="option"]')).filter((option) => {
      const rect = option.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const selected = visible.map((option, index) =>
      option.getAttribute('aria-selected') === 'true' || option.getAttribute('data-state') === 'checked'
        ? index : -1).filter((index) => index >= 0);
    return { count: visible.length, selectedCount: selected.length, next: visible.findIndex((_, index) => index !== selected[0]) };
  })()`);
  assert(
    options?.count >= 2 && options.selectedCount === 1 && options.next >= 0,
    'org_switch_second_membership_missing',
  );
  const choice = `Array.from(document.querySelectorAll('[role="option"]')).filter((option) => {
    const rect = option.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })[${options.next}]`;
  await panel.click(choice);
  let after;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    after = await activeWorker.evaluate(async () => {
      const stored = await chrome.storage.local.get('matrx.org.active');
      return stored['matrx.org.active']?.id ?? null;
    });
    if (typeof after === 'string' && after.length > 10 && after !== before) break;
    await wait(250);
  }
  assert(typeof after === 'string' && after !== before, 'org_switch_selection_not_persisted');
  return { before, after, memberOptionCount: options.count };
}
async function verifyPanelReadInOrganization(panel, expectedOrganizationId) {
  assert(typeof panel?.onEvent === 'function', 'org_switch_panel_observer_missing');
  const requests = new Map();
  const expectedApiOrigin = new URL(API).origin;
  const stop = panel.onEvent((method, params) => {
    if (method === 'Network.requestWillBeSent') {
      let requestUrl;
      try {
        requestUrl = new URL(params.request?.url);
      } catch {
        return;
      }
      if (
        requestUrl.origin !== expectedApiOrigin ||
        requestUrl.pathname !== '/api/vault/items' ||
        requestUrl.searchParams.get('principal_type') !== 'user' ||
        params.request?.method !== 'GET'
      )
        return;
      const header = Object.entries(params.request?.headers || {}).find(
        ([name]) => name.toLowerCase() === 'x-organization-id',
      )?.[1];
      requests.set(params.requestId, { correctOrganization: header === expectedOrganizationId });
    }
    if (method === 'Network.responseReceived' && requests.has(params.requestId)) {
      const request = requests.get(params.requestId);
      request.status = params.response?.status;
    }
    if (method === 'Network.loadingFinished' && requests.has(params.requestId)) {
      requests.get(params.requestId).finished = true;
    }
  });
  try {
    await panel.click(visibleVaultControl);
    await panel.waitFor(`(() => {
      const control = (${visibleVaultControl});
      return control?.getAttribute('aria-selected') === 'true' &&
        !!document.querySelector('[role="tabpanel"]');
    })()`);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const completed = [...requests].find(
        ([, entry]) =>
          entry.correctOrganization &&
          entry.status >= 200 &&
          entry.status < 300 &&
          entry.finished === true,
      );
      if (completed) {
        const response = await panel.send('Network.getResponseBody', { requestId: completed[0] });
        const body = response.base64Encoded
          ? Buffer.from(response.body, 'base64').toString('utf8')
          : response.body;
        const payload = JSON.parse(body);
        assert(Array.isArray(payload?.items), 'org_switch_panel_items_response_invalid');
        const count = payload.items.length;
        await panel.waitFor(`(() => {
          const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
          return tabs.some((tab) => tab.getAttribute('aria-selected') === 'true' &&
            tab.textContent?.trim() === 'Mine (${count})');
        })()`);
        return true;
      }
      await wait(250);
    }
    throw new Error('org_switch_new_panel_read_unverified');
  } finally {
    stop();
  }
}
async function prewriteVaultPanelScreenshot() {
  // The Vault navigation control contains no credential value. Verify the
  // actual panel screenshot channel before any fixture write can occur.
  const screenshot = path.join(root, 'prewrite-vault-control.png');
  const vaultControl = 'document.querySelector(`[title="Vault"]`)';
  checkpoint('prewrite_vault_screenshot');
  await realPanel.screenshot(vaultControl, screenshot);
  proof.prewritePanelScreenshot = {
    path: 'prewrite-vault-control.png',
    sha256: await sha256(screenshot),
    region: 'vault_navigation_control_no_secret',
  };
  proof.checks.prewritePanelScreenshot = true;
  persist();
}
async function dismissResolvedInitialOrganizationNotice() {
  // A fresh profile can announce its missing workspace before the normal
  // Settings selection finishes. Acknowledge only that resolved setup notice
  // through its real Dismiss control; never clear stores or dismiss other errors.
  const active = (await storage(['matrx.org.active']))['matrx.org.active'];
  assert(
    proof.checks.independentAdminIdentity && active?.id === organizationId,
    'setup_notice_context_not_verified',
  );
  const notice = `Array.from(document.querySelectorAll('[role="alert"]')).find(node => node.querySelector('.font-medium')?.textContent?.trim() === 'Capture list unavailable' && node.textContent.includes('NO_ORGANIZATION'))`;
  const observed = await realPanel.evaluate(`!!(${notice})`);
  proof.initialOrganizationNotice = {
    observed,
    dismissed: false,
    currentOrganizationVerified: true,
  };
  if (observed) {
    await realPanel.click(`(${notice}).querySelector('button[aria-label="Dismiss"]')`);
    await realPanel.waitFor(`!(${notice})`);
    proof.initialOrganizationNotice.dismissed = true;
  }
  persist();
}
async function submitLogin(page, username, password) {
  await page.goto(localUrl, { waitUntil: 'domcontentloaded' });
  // The manifest loads the real bridge at document_idle. Observe readiness
  // in its isolated world before typing, without injecting a replacement.
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    ready = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find((entry) => entry.url === url);
      if (!tab?.id) return false;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: () => window.__matrx_bridge_mounted === true,
      });
      return results[0]?.result === true;
    }, localUrl);
    if (ready) break;
    await wait(100);
  }
  assert(ready, 'site_capture_bridge_not_ready');
  await page.locator('#email').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function prompt(page) {
  const host = page.locator('#matrx-login-capture-host');
  await host.waitFor({ state: 'visible', timeout: 15000 });
  return host;
}
const captureHeading =
  'Array.from(document.querySelectorAll("p")).find((element) => element.textContent.trim() === "Save this login to your Vault?")';
const captureCard = `(${captureHeading})?.parentElement?.parentElement?.parentElement`;
const updateButtons = `Array.from((${captureCard})?.querySelectorAll('button') || []).filter((element) => /^Update/.test(element.textContent.trim()))`;
function uniqueCaptureButton(name, prefix = false) {
  return `(() => { const matches = Array.from((${captureCard})?.querySelectorAll('button') || []).filter((element) => { const text = element.textContent.trim().replace(/\\s+/g, ' '); return ${prefix ? `text.startsWith('Update') && text.includes(${JSON.stringify(name)})` : `text === ${JSON.stringify(name)} || (text.length === 0 && element.getAttribute('title') === ${JSON.stringify(name)})`}; }); return matches.length === 1 ? matches[0] : null; })()`;
}
async function pendingCard() {
  try {
    await realPanel.waitFor(
      `!!(${captureHeading}) && (${captureHeading}).getBoundingClientRect().height > 0`,
    );
  } catch {
    proof.captureDiagnostics = { candidatePresent: await hasPendingCapture() };
    persist();
    throw new Error('pending_capture_card_not_visible');
  }
}
async function waitForCaptureDecision() {
  try {
    await realPanel.waitFor(`!!(${captureHeading})`, false, 10000);
  } catch {
    const snapshot = () =>
      realPanel.evaluate(`({
        cardPresent: !!(${captureCard}),
        busy: Array.from((${captureCard})?.querySelectorAll('button') || []).some((button) => button.disabled),
        headingPresent: !!(${captureHeading}),
        vaultError: document.body.innerText.includes('The Vault could not save that. Try again from the Vault tab.'),
        noAnswer: document.body.innerText.includes('Matrx did not answer. Try again.')
      })`);
    proof.decisionDiagnostics = await snapshot();
    // The initial wait is an observation boundary, not a failure verdict. A
    // delayed success is accepted only after the exact heading is gone, neither
    // error is present, and the pending capture has cleared. All data retained
    // here is structural timing/status evidence, never Vault values.
    const settlement = await observeDelayedCaptureDecisionSettlement({
      waitForHeadingGone: () => realPanel.waitFor(`!(${captureHeading})`, true, 90000),
      snapshot,
      pendingCapture: hasPendingCapture,
    });
    Object.assign(proof.decisionDiagnostics, {
      lateCompletion: settlement.settled,
      lateCompletionMs: settlement.latencyMs,
      delayedSettlementWaitTimedOut: settlement.waitTimedOut,
      headingPresentAfterDelay: settlement.headingPresent,
      vaultErrorAfterDelay: settlement.vaultError,
      noAnswerAfterDelay: settlement.noAnswer,
      pendingAfterObservation: settlement.pendingCapture,
    });
    persist();
    if (settlement.settled) return;
    throw new Error('capture_decision_not_completed');
  }
}
async function materializedPassword(id) {
  const response = await api(
    `${API}/api/vault/browser-login/${encodeURIComponent(id)}/materialize`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page_url: localUrl,
        tool_invocation_id: crypto.randomUUID(),
        client_build: 'vault-realbrowser-canary',
      }),
      label: 'materialize',
    },
  );
  assert(typeof response?.password === 'string', 'materialize_shape');
  return response.password;
}

(async () => {
  let acceptanceLease;
  let failure;
  let artifactAdmitted = false;
  // Generator mode starts non-durable and becomes durable only after a
  // successful unlocked-session probe, before any artifact/browser/auth work.
  let generatorFocusPreflightRefused = generatorTransportMode && headedMode;
  try {
    // This must precede artifact admission and persistence. A locked desktop
    // cannot produce compositor focus, so recording it as an acceptance run
    // would create a false durable cleanup obligation without any browser or
    // credential activity.
    if (generatorTransportMode && headedMode) {
      const sessionLocked = await generatorSessionLocked();
      proof.generatorFocusPreflight = { screenLocked: sessionLocked };
      if (sessionLocked) throw new Error('generator_session_locked');
      generatorFocusPreflightRefused = false;
    } else if (generatorTransportMode) {
      proof.generatorFocusPreflight = { disposition: 'not_run_headless_no_clipboard' };
    }
    await refuseUnreconciledPriorRun();
    const extension = await verifyArtifact();
    proof.helperSha256 = {
      rawAdapter: await sha256(path.join(__dirname, 'vault-owned-cdp.cjs')),
      journal: await sha256(path.join(__dirname, 'vault-network-journal.cjs')),
      capture: await sha256(path.join(__dirname, 'vault-capture-decisions-acceptance.cjs')),
      authenticator: await sha256(path.join(__dirname, 'vault-authenticator-preservation.cjs')),
      responseLoss: await sha256(path.join(__dirname, 'vault-save-response-loss.cjs')),
      savedForms: await sha256(path.join(__dirname, 'vault-saved-form-matrix.cjs')),
      realSiteFill: await sha256(path.join(__dirname, 'vault-real-site-fill-acceptance.cjs')),
      preferences: await sha256(path.join(__dirname, 'vault-preferences-acceptance.cjs')),
      setupRecovery: await sha256(path.join(__dirname, 'vault-setup-recovery-acceptance.cjs')),
      nativePanelFetchFailure: await sha256(
        path.join(__dirname, 'vault-native-panel-fetch-failure.cjs'),
      ),
      fixtureSetupRetry: await sha256(path.join(__dirname, 'vault-fixture-create-retry.cjs')),
      acceptanceLease: await sha256(path.join(__dirname, 'vault-acceptance-lease.cjs')),
      historicalReconciliation: await sha256(
        path.join(__dirname, 'vault-historical-reconciliation.cjs'),
      ),
      recovery7356: await sha256(path.join(__dirname, 'vault-7356-reconciliation.cjs')),
      accessibility: await sha256(path.join(__dirname, 'vault-accessibility-acceptance.cjs')),
      passwordChange: await sha256(path.join(__dirname, 'vault-password-change-acceptance.cjs')),
      browserRestart: await sha256(
        path.join(__dirname, 'vault-extension-browser-restart-acceptance.cjs'),
      ),
    };
    // A known local canonical-cleanup drift cannot create a durable run or
    // spend authentication work. Recheck it again with the baseline payload
    // immediately before fixture writes.
    await verifyPinnedLocalCanonicalSource();
    // An invalid/tampered artifact is rejected before a durable run record,
    // so a safe negative test cannot create a fictional cleanup obligation.
    acceptanceLease = await acquireVaultAcceptanceLease({
      runId,
      kind: edgeBrowserMode ? 'edge' : 'chrome',
    });
    proof.acceptanceLeaseAcquired = true;
    artifactAdmitted = true;
    persist();
    await authenticate(extension);
    await dismissResolvedInitialOrganizationNotice();
    if (extensionLifecycleMode) {
      const initialWorker = worker;
      const workerUrl = await initialWorker.evaluate(() => location.href);
      const initialTargets = await rawCdp.send('Target.getTargets');
      const initialTarget = initialTargets.targetInfos.find(
        (target) => target.type === 'service_worker' && target.url === workerUrl,
      );
      assert(initialTarget, 'lifecycle_initial_worker_target_missing');
      const disableEnable = await runExtensionDisableEnable({
        worker: initialWorker,
        cdp: rawCdp,
        workerUrl,
        previousTargetId: initialTarget.targetId,
        panelTargetId: realPanel.targetId,
        extensionId,
        context,
        refreshWorker: async (replacementTarget) =>
          exactCdpWorkerFacade(rawCdp, replacementTarget.targetId),
        disposePanel: async () => {
          await realPanel?.dispose();
          realPanel = undefined;
        },
        reopenPanel: async (fixturePage, replacement) => {
          const active = await replacement.evaluate(async () => {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            return Number.isInteger(tab?.windowId) ? { windowId: tab.windowId } : null;
          });
          assert(active?.windowId, 'lifecycle_reenabled_window_missing');
          const reopened = await openSidePanelFromActionPopup(
            extensionId,
            fixturePage,
            active.windowId,
            replacement,
          );
          assert(reopened.opened && reopened.panel, 'lifecycle_reenabled_panel_missing');
          realPanel = reopened.panel;
          await networkJournal.bindPanelTarget(realPanel.targetId);
          return realPanel;
        },
        verifySettingsIdentity: async (_replacement, panel) => {
          await panel.click(visibleSettingsControl);
          try {
            await panel.waitFor(
              `document.body.innerText.includes('Settings') && document.body.innerText.includes('admin@admin.com')`,
            );
          } catch (error) {
            proof.lifecycle ||= {};
            try {
              proof.lifecycle.disableEnableSettingsIdentityFailure =
                await settingsIdentityFailureState(panel);
            } catch {
              proof.lifecycle.disableEnableSettingsIdentityFailure = { snapshotUnavailable: true };
            }
            try {
              persist();
            } catch {
              /* preserve the Settings identity failure */
            }
            throw error;
          }
          return true;
        },
        checkpoint,
        proof,
        wait,
      });
      worker = disableEnable.worker;
      realPanel = disableEnable.panel;
      const enabledTarget = (await rawCdp.send('Target.getTargets')).targetInfos.find(
        (target) => target.type === 'service_worker' && target.url === workerUrl,
      );
      assert(enabledTarget, 'lifecycle_enabled_worker_target_missing');
      const enabledPanelTargetId = realPanel.targetId;
      worker = await runExtensionReload({
        worker,
        cdp: rawCdp,
        workerUrl,
        extensionId,
        previousWorkerTargetId: enabledTarget.targetId,
        previousPanelTargetId: enabledPanelTargetId,
        assertPreviousTargetsGone: async () => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const targets = await rawCdp.send('Target.getTargets');
            const workerTargetGone = !targets.targetInfos.some(
              (target) => target.targetId === enabledTarget.targetId,
            );
            const panelTargetGone = !targets.targetInfos.some(
              (target) => target.targetId === enabledPanelTargetId,
            );
            if (workerTargetGone && panelTargetGone) return { workerTargetGone, panelTargetGone };
            await wait(250);
          }
          throw new Error('lifecycle_reload_previous_target_retirement_timeout');
        },
        reopenPanel: async (replacement) => {
          await realPanel?.dispose();
          realPanel = undefined;
          // A fresh owned page supplies the focused window for the extension's
          // real action.openPopup -> Open chat path. Never navigate directly
          // to popup.html: Chrome blocks that during an extension reload.
          const reloadFixture = await context.newPage();
          try {
            await reloadFixture.bringToFront();
            const active = await replacement.evaluate(async () => {
              const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
              return Number.isInteger(tab?.windowId) ? { windowId: tab.windowId } : null;
            });
            assert(active?.windowId, 'lifecycle_reload_window_missing');
            const reopened = await openSidePanelFromActionPopup(
              extensionId,
              reloadFixture,
              active.windowId,
              replacement,
            );
            assert(reopened.opened && reopened.panel, 'lifecycle_reload_panel_missing');
            realPanel = reopened.panel;
            await networkJournal.bindPanelTarget(realPanel.targetId);
            return realPanel;
          } finally {
            if (!reloadFixture.isClosed()) await reloadFixture.close();
          }
        },
        refreshWorker: async (replacementTarget) => {
          proof.lifecycle ||= {};
          proof.lifecycle.extensionReloadCdp = {
            initialTargetId: enabledTarget.targetId,
            replacementTargetId: replacementTarget.targetId,
            replacementTargetObserved: true,
          };
          return exactCdpWorkerFacade(rawCdp, replacementTarget.targetId);
        },
        verifySettingsIdentity: async (panel) => {
          await panel.click(visibleSettingsControl);
          await panel.waitFor(
            `document.body.innerText.includes('Settings') && document.body.innerText.includes('admin@admin.com')`,
          );
          return true;
        },
        checkpoint,
        proof,
        wait,
      });
      // A browser restart must start a distinct owned Chrome process from the
      // same disposable profile. The helper closes the initial browser and its
      // journal before launch; on success this runner becomes the sole owner of
      // the replacement for the ordinary final cleanup below.
      const configuredExecutable = process.env.MATRX_VAULT_CANARY_CHROME_EXECUTABLE;
      const restartExecutable = configuredExecutable || chromium.executablePath();
      const restartLaunchOptions = {
        headless: headlessNoClipboardMode,
        executablePath: restartExecutable,
        ...(edgeBrowserMode ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
        args: [
          ...(headlessNoClipboardMode ? ['--headless=new'] : []),
          ...(isolatedHeadlessClipboard || edgeBrowserMode ? ['--enable-automation'] : []),
          ...(edgeBrowserMode ? ['--enable-extensions'] : []),
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0',
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      };
      const initialBrowser = await ownedBrowserProcess({
        candidateProfile: profile,
        executablePath: restartExecutable,
        launchOptions: restartLaunchOptions,
      });
      const restartInitialTarget = (await rawCdp.send('Target.getTargets')).targetInfos.filter(
        (target) => target.type === 'service_worker' && target.url === workerUrl,
      );
      assert(restartInitialTarget.length === 1, 'browser_restart_initial_worker_ambiguous');
      const initialPanelTargetId = realPanel.targetId;
      const restartCustody = {
        profileSha256: sha256Value(profile),
        executableSha256: sha256Value(restartExecutable),
        replacementLaunchAttempted: false,
        failedLaunchCleanupProven: false,
        initial: {
          browserPid: initialBrowser.browserPid,
          cdpOwnerVerified: rawCdp.ownerVerified === true,
          workerTargetId: restartInitialTarget[0].targetId,
          panelTargetId: initialPanelTargetId,
        },
        replacement: null,
      };
      proof.lifecycle.browserRestartCustody = restartCustody;
      assert(restartCustody.initial.cdpOwnerVerified, 'browser_restart_initial_cdp_unowned');
      lifecycleLogoutObserver?.();
      lifecycleLogoutObserver = undefined;
      let replacementPreparedProfile;
      const restarted = await runOwnedBrowserRestart({
        profile,
        extensionId,
        workerUrl,
        initialContext: context,
        initialPanel: realPanel,
        initialWorker: worker,
        initialWorkerTargetId: restartInitialTarget[0].targetId,
        initialPanelTargetId,
        initialBrowserPid: initialBrowser.browserPid,
        initialCdp: rawCdp,
        initialJournal: networkJournal,
        assertOwnedProfile: async (candidateProfile) => {
          const stat = await fs.lstat(candidateProfile).catch(() => null);
          return (
            path.resolve(candidateProfile) === profile &&
            path.dirname(candidateProfile) === root &&
            stat?.isDirectory() === true &&
            stat.isSymbolicLink() === false
          );
        },
        launchOptions: restartLaunchOptions,
        launchOwnedPersistentContext: async ({ profile: candidateProfile, launchOptions }) => {
          replacementPreparedProfile = await prepareOwnedProfile(candidateProfile);
          restartCustody.replacementLaunchAttempted = true;
          let replacementContext;
          try {
            replacementContext = await chromium.launchPersistentContext(
              candidateProfile,
              launchOptions,
            );
            const replacementBrowser = await ownedBrowserProcess({
              candidateProfile,
              executablePath: launchOptions.executablePath,
              launchOptions,
            });
            return { context: replacementContext, browserPid: replacementBrowser.browserPid };
          } catch (error) {
            let contextClosed = replacementContext == null;
            try {
              if (replacementContext) await replacementContext.close();
              contextClosed = true;
            } catch {
              contextClosed = false;
            }
            try {
              restartCustody.failedLaunchCleanupProven =
                contextClosed && (await verifyNoBrowserProcessForProfile(candidateProfile));
            } catch {
              restartCustody.failedLaunchCleanupProven = false;
            }
            throw error;
          }
        },
        assertLaunchProvenance: async ({
          profile: candidateProfile,
          launchOptions,
          context: candidateContext,
          browserPid,
        }) =>
          candidateProfile === profile &&
          candidateContext?.close &&
          (await verifyOwnedBrowserProcess({
            profile: candidateProfile,
            launchOptions,
            browserPid,
          })),
        verifyProcessExited: verifyBrowserProcessExited,
        verifyOwnedBrowserProcess,
        connectOwnedCdp: async (replacementContext, candidateProfile) => {
          assert(
            replacementPreparedProfile?.profile === candidateProfile,
            'browser_restart_prelaunch_profile_provenance_missing',
          );
          const replacementCdp = await connectOwnedCdp({
            preparedProfile: replacementPreparedProfile,
            chromeExecutable: restartExecutable,
          });
          const command = await replacementCdp.send('Browser.getBrowserCommandLine');
          assert(
            command.arguments.includes(`--user-data-dir=${candidateProfile}`) &&
              restartLaunchOptions.args.every((argument) => command.arguments.includes(argument)),
            'browser_restart_cdp_launch_provenance_unverified',
          );
          assert(replacementContext?.close, 'browser_restart_replacement_context_unowned');
          return replacementCdp;
        },
        createReplacementJournal: async ({ cdp }) =>
          createVaultNetworkJournal({
            cdp,
            apiOrigin: API,
            onVaultRequest: ({ method, pathname, headers }) =>
              journalVaultMutationRequest(`${API}${pathname}`, method, headers),
          }),
        acquireWorker: async (replacementContext, replacementCdp) => {
          const replacementTarget = await waitForReplacementExtensionWorkerTarget({
            cdp: replacementCdp,
            workerUrl,
            previousTargetId: restartInitialTarget[0].targetId,
            wait,
          });
          assert(replacementContext?.pages, 'browser_restart_replacement_context_unowned');
          return {
            worker: exactCdpWorkerFacade(replacementCdp, replacementTarget.targetId),
            targetId: replacementTarget.targetId,
          };
        },
        openPanel: async ({ context: replacementContext, worker: replacementWorker }) => {
          const fixturePage = await replacementContext.newPage();
          try {
            await fixturePage.bringToFront();
            const active = await replacementWorker.evaluate(async () => {
              const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
              return Number.isInteger(tab?.windowId) ? { windowId: tab.windowId } : null;
            });
            assert(active?.windowId, 'browser_restart_window_missing');
            const reopened = await openSidePanelFromActionPopup(
              extensionId,
              fixturePage,
              active.windowId,
              replacementWorker,
              replacementContext,
            );
            assert(reopened.opened && reopened.panel, 'browser_restart_action_panel_missing');
            assert(
              reopened.panel.targetId !== initialPanelTargetId,
              'browser_restart_panel_target_reused',
            );
            return reopened.panel;
          } finally {
            if (!fixturePage.isClosed()) await fixturePage.close();
          }
        },
        verifyPostBindVaultRead: async ({ panel: replacementPanel, journal }) => {
          // Leave the startup route after binding: any startup GET predates the
          // journal epoch and cannot prove this replacement panel can read.
          await replacementPanel.click(visibleSettingsControl);
          await replacementPanel.waitFor(`document.body.innerText.includes('Settings')`);
          await replacementPanel.click(visibleVaultControl);
          await replacementPanel.waitFor(`(() => {
            const control = (${visibleVaultControl});
            return control?.getAttribute('aria-selected') === 'true' &&
              !!document.querySelector('[role="tabpanel"]');
          })()`);
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const snapshot = journal.snapshot();
            if (snapshot?.panelItemsReadRequestSeen && snapshot?.panelItemsReadResponse2xxSeen)
              return true;
            await wait(250);
          }
          throw new Error('browser_restart_post_bind_panel_read_missing');
        },
        verifySettingsIdentity: async (_replacementWorker, replacementPanel) => {
          await replacementPanel.click(visibleSettingsControl);
          await replacementPanel.waitFor(
            `document.body.innerText.includes('Settings') && document.body.innerText.includes('admin@admin.com')`,
          );
          return true;
        },
        vaultWriteCount: () => proof.vaultMutationRequests,
        proof,
      });
      context = restarted.context;
      rawCdp = restarted.cdp;
      networkJournal = restarted.journal;
      realPanel = restarted.panel;
      worker = restarted.worker;
      const replacementBrowser = await ownedBrowserProcess({
        candidateProfile: profile,
        executablePath: restartExecutable,
        launchOptions: restartLaunchOptions,
      });
      restartCustody.replacement = {
        browserPid: replacementBrowser.browserPid,
        cdpOwnerVerified: rawCdp.ownerVerified === true,
        workerTargetId: proof.lifecycle.browserRestart.replacementWorkerTargetId,
        panelTargetId: realPanel.targetId,
        journal: networkJournal.snapshot(),
      };
      assert(
        restartCustody.replacement.cdpOwnerVerified,
        'browser_restart_replacement_cdp_unowned',
      );
      lifecycleLogoutObserver = observeOwnedPanelLogout({
        panel: realPanel,
        extensionId,
        onResponse: ({ status }) => {
          const observed = proof.lifecycleSettingsLogoutResponses || [];
          proof.lifecycleSettingsLogoutResponses = observed;
          observed.push({ status, phase: proof.phase, observer: 'raw_cdp_owned_sidepanel' });
          persist();
        },
      });
      proof.lifecycleSettingsLogoutObserver = 'raw_cdp_owned_sidepanel';
      proof.lifecycle.partialDisposition =
        'disable_enable_reload_browser_restart_observed_organization_switch_pending';
      persist();
    } else if (setupIdentityOnlyMode) {
      const initial = await inspectIdentity(worker);
      proof.lifecycle = {
        initialIdentitySha256: initial.identitySha256,
        extensionReload: { disposition: 'not_run', reason: 'setup_identity_only_mode' },
        partialDisposition: 'setup_transport_signout_fresh_recovery_pending_reload',
      };
      persist();
    } else if (identityOnlyMode) {
      const initial = await inspectIdentity(worker);
      proof.lifecycle = {
        initialIdentitySha256: initial.identitySha256,
        extensionReload: { disposition: 'not_run', reason: 'identity_only_mode' },
        partialDisposition: 'signout_fresh_recovery_pending_reload_browser_restart_and_org_switch',
      };
      proof.setupTransportRecovery = {
        disposition: 'not_run',
        reason: 'already_accepted_in_prior_setup_run',
      };
      persist();
    }
    proof.phase = 'vault_baseline';
    persist();
    const baseline = await items();
    baselineIds = new Set(baseline.map((entry) => entry.id));
    proof.baselineMetadataSha256 = baselineMetadataSha256(baseline);
    proof.baselineItems = baseline
      .map((entry) => ({ id: entry.id, metadataSha256: baselineMetadataSha256([entry]) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (readOnlyAdmissionMode) proof.admission.baselineRead = true;
    await verifyRealVaultPanel();
    await verifyObservedVaultPanelRead();
    await prewriteLocalCanonicalPreflight();
    const helperHashesBeforeWrites = {
      rawAdapter: await sha256(path.join(__dirname, 'vault-owned-cdp.cjs')),
      journal: await sha256(path.join(__dirname, 'vault-network-journal.cjs')),
      capture: await sha256(path.join(__dirname, 'vault-capture-decisions-acceptance.cjs')),
      authenticator: await sha256(path.join(__dirname, 'vault-authenticator-preservation.cjs')),
      responseLoss: await sha256(path.join(__dirname, 'vault-save-response-loss.cjs')),
      savedForms: await sha256(path.join(__dirname, 'vault-saved-form-matrix.cjs')),
      realSiteFill: await sha256(path.join(__dirname, 'vault-real-site-fill-acceptance.cjs')),
      preferences: await sha256(path.join(__dirname, 'vault-preferences-acceptance.cjs')),
      setupRecovery: await sha256(path.join(__dirname, 'vault-setup-recovery-acceptance.cjs')),
      nativePanelFetchFailure: await sha256(
        path.join(__dirname, 'vault-native-panel-fetch-failure.cjs'),
      ),
      fixtureSetupRetry: await sha256(path.join(__dirname, 'vault-fixture-create-retry.cjs')),
      acceptanceLease: await sha256(path.join(__dirname, 'vault-acceptance-lease.cjs')),
      historicalReconciliation: await sha256(
        path.join(__dirname, 'vault-historical-reconciliation.cjs'),
      ),
      recovery7356: await sha256(path.join(__dirname, 'vault-7356-reconciliation.cjs')),
      accessibility: await sha256(path.join(__dirname, 'vault-accessibility-acceptance.cjs')),
      passwordChange: await sha256(path.join(__dirname, 'vault-password-change-acceptance.cjs')),
      browserRestart: await sha256(
        path.join(__dirname, 'vault-extension-browser-restart-acceptance.cjs'),
      ),
    };
    assert(
      JSON.stringify(helperHashesBeforeWrites) === JSON.stringify(proof.helperSha256),
      'helper_source_changed_before_writes',
    );
    if (extensionLifecycleMode || setupIdentityOnlyMode || identityOnlyMode) {
      if (extensionLifecycleMode || setupIdentityOnlyMode)
        await runVaultListTransportRecoveryChecks({
          context,
          realPanel,
          minimumOwnListRows: baseline.length,
          apiOrigin: API,
          exactPanelDocumentUrl: `chrome-extension://${extensionId}/sidepanel.html`,
          getVaultWriteCount: () => proof.vaultMutationRequests,
          snapshotOwnedReceiptState: () => ({
            createKeys: [...createKeys],
            createdIds: [...createdIds],
          }),
          assert,
          checkpoint,
          proof,
          verifyRealVaultPanel,
        });
      await runSettingsSignOut({
        worker,
        panel: realPanel,
        checkpoint,
        proof,
        waitForLogout204: async () => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const observed = proof.lifecycleSettingsLogoutResponses;
            if (Array.isArray(observed) && observed.length === 1 && observed[0].status === 204)
              return true;
            if (Array.isArray(observed) && observed.length > 1) return false;
            await wait(250);
          }
          return false;
        },
        verifySignedOutVaultHidden: async () => {
          return (await realPanel.evaluate(`(${visibleVaultControl}) === null`)) === true;
        },
        verifyBearerlessVaultApiRefusal: async () => {
          const endpoint = `${API}/api/vault/items?principal_type=user`;
          const request = `fetch(${JSON.stringify(endpoint)}, { method: 'GET', headers: { 'X-Organization-Id': ${JSON.stringify(organizationId)} } }).then((response) => ({ status: response.status, authorizationHeaderAbsent: true }))`;
          const result = await realPanel.evaluate(request);
          const authorizationHeaderAbsent = result?.authorizationHeaderAbsent === true;
          const status = result?.status;
          return {
            status,
            authorizationHeaderAbsent,
            refused: authorizationHeaderAbsent && (status === 401 || status === 403),
          };
        },
      });
      // Only the Settings sign-out response belongs to this observation.
      // Final teardown uses a separate client and must never satisfy it.
      lifecycleLogoutObserver?.();
      lifecycleLogoutObserver = undefined;
      // Reuse the same disposable profile and the production OAuth UI. This
      // proves recovery is a fresh interactive session, never retained panel state.
      await realPanel.dispose();
      await authenticate(extension, { reuseBrowser: true });
      await dismissResolvedInitialOrganizationNotice();
      const recovered = await storage([
        'matrx.user.profile',
        'matrx.auth.accessToken',
        'matrx.auth.refreshTokenEnc',
        'matrx.auth.refreshTokenIv',
      ]);
      const recoveryIdentity =
        typeof recovered['matrx.user.profile']?.id === 'string'
          ? crypto.createHash('sha256').update(recovered['matrx.user.profile'].id).digest('hex')
          : null;
      proof.lifecycle.freshRecovery = {
        disposition: 'in_progress',
        interactiveSignInCompleted: true,
        settingsUiRecovered: false,
        localAuthMaterialPresent:
          typeof recovered['matrx.auth.accessToken'] === 'string' &&
          typeof recovered['matrx.auth.refreshTokenEnc'] === 'string' &&
          typeof recovered['matrx.auth.refreshTokenIv'] === 'string',
        verifiedIdentityRecovered: sameLifecycleIdentity(
          proof.lifecycle.initialIdentitySha256,
          recoveryIdentity,
        ),
        identitySha256: recoveryIdentity,
      };
      await realPanel.click(visibleSettingsControl);
      await realPanel.waitFor(
        `document.body.innerText.includes('Settings') && document.body.innerText.includes('admin@admin.com')`,
      );
      proof.lifecycle.freshRecovery.settingsUiRecovered = await realPanel.evaluate(
        `document.body.innerText.includes('Settings') && document.body.innerText.includes('admin@admin.com')`,
      );
      proof.lifecycle.freshRecovery.disposition =
        proof.lifecycle.freshRecovery.interactiveSignInCompleted &&
        proof.lifecycle.freshRecovery.localAuthMaterialPresent &&
        proof.lifecycle.freshRecovery.verifiedIdentityRecovered &&
        proof.lifecycle.freshRecovery.settingsUiRecovered
          ? 'passed'
          : 'failed';
      proof.lifecycle.accountInvalidation = {
        disposition:
          proof.lifecycle.signOut?.settingsSignOutClicked &&
          proof.lifecycle.signOut?.localAuthMaterialAbsent &&
          proof.lifecycle.signOut?.bearerlessVaultApiRefusal?.refused === true &&
          proof.lifecycle.signOut?.remoteLogout204 &&
          proof.lifecycle.freshRecovery.verifiedIdentityRecovered
            ? 'passed'
            : 'failed',
        preSignOutIdentityWasObserved: true,
        signedOutBearerlessVaultRefused:
          proof.lifecycle.signOut?.bearerlessVaultApiRefusal?.refused === true,
        freshSameIdentityRecoveredAfterInteractiveSignIn:
          proof.lifecycle.freshRecovery.verifiedIdentityRecovered === true,
      };
      proof.lifecycle.partialDisposition = setupIdentityOnlyMode
        ? 'setup_transport_signout_fresh_recovery_observed_reload_browser_restart_and_org_switch_pending'
        : identityOnlyMode
          ? 'signout_fresh_recovery_observed_reload_browser_restart_and_org_switch_pending'
          : 'reload_setup_recovery_signout_fresh_recovery_observed_browser_restart_and_org_switch_pending';
      // One real Vault read after recovery establishes the new bearer works;
      // it is intentionally mutation-free and skips the legacy generator tail.
      const recoveredItems = await items();
      proof.lifecycle.freshVaultRead = Array.isArray(recoveredItems);
      assert(proof.lifecycle.freshVaultRead, 'lifecycle_fresh_vault_read_refused');
      proof.lifecycle.freshRecovery.disposition = 'in_progress';
      proof.lifecycle.freshPanelVaultReadObserved = false;
      persist();
      // authenticate() rebinds the panel target and starts a fresh journal
      // epoch. Prove the recovered panel itself can read with the new session;
      // the direct API read above cannot satisfy that panel boundary.
      await verifyRealVaultPanel();
      await verifyObservedVaultPanelRead();
      proof.lifecycle.freshPanelVaultReadObserved = true;
      proof.lifecycle.freshRecovery.disposition =
        proof.lifecycle.freshRecovery.interactiveSignInCompleted &&
        proof.lifecycle.freshRecovery.localAuthMaterialPresent &&
        proof.lifecycle.freshRecovery.verifiedIdentityRecovered &&
        proof.lifecycle.freshRecovery.settingsUiRecovered &&
        proof.lifecycle.freshVaultRead &&
        proof.lifecycle.freshPanelVaultReadObserved
          ? 'passed'
          : 'failed';
      if (extensionLifecycleMode) {
        proof.phase = 'organization_switch_lifecycle';
        persist();
        const beforeOrganizationMetadata = baselineMetadataSha256(await items());
        assert(
          beforeOrganizationMetadata === proof.baselineMetadataSha256,
          'org_switch_initial_personal_vault_drift',
        );
        let switchedOrganization;
        const offerProbe = await runOrganizationSwitchOfferProbe({
          context,
          worker,
          panel: realPanel,
          wait,
          assert,
          focusOwnedBrowser,
          switchOrganization: async () => {
            switchedOrganization = await chooseDifferentOrganizationInPanel(realPanel, worker);
            organizationId = switchedOrganization.after;
            return switchedOrganization;
          },
        });
        assert(switchedOrganization, 'org_switch_ui_transition_missing');
        const newPanelRead = await verifyPanelReadInOrganization(
          realPanel,
          switchedOrganization.after,
        );
        const personalVaultScopePreserved =
          baselineMetadataSha256(await items()) === beforeOrganizationMetadata;
        proof.lifecycle.organizationInvalidation = {
          disposition:
            offerProbe.staleResponse === true &&
            offerProbe.newActorOfferReady === true &&
            offerProbe.noCompetingBrowserInvalidation === true &&
            offerProbe.fieldsUnchanged === true &&
            offerProbe.noWebsiteSubmission === true &&
            offerProbe.portClosed === true &&
            offerProbe.ownedFixturePageClosed === true &&
            offerProbe.ownedFixtureServerClosed === true &&
            offerProbe.focusWitnessDisposed === true &&
            newPanelRead === true &&
            personalVaultScopePreserved
              ? 'passed'
              : 'failed',
          twoAdminMembershipsObserved: switchedOrganization.memberOptionCount >= 2,
          oldOrganizationAuthorityRefusedAfterSwitch: offerProbe.staleResponse === true,
          newOrganizationResolvedAfterSwitch: newPanelRead === true,
          personalVaultScopePreserved,
          oldOrganizationSha256: sha256Value(switchedOrganization.before),
          newOrganizationSha256: sha256Value(switchedOrganization.after),
          offerProbe,
        };
        assert(
          proof.lifecycle.organizationInvalidation.disposition === 'passed',
          'org_switch_lifecycle_incomplete',
        );
        proof.lifecycle.verdict = { disposition: 'in_progress' };
        persist();
        assertVaultExtensionLifecycleVerdict({ lifecycle: proof.lifecycle });
        proof.lifecycle.verdict = { disposition: 'passed' };
        persist();
      }
      persist();
    } else if (readOnlyAdmissionMode && !identityOnlyMode) {
      proof.admission.baselineRead = true;
      proof.admission.prewriteLocalCanonicalPreflight = localCanonicalCleanupArmed;
      proof.admission.noFixtureWrites =
        proof.vaultMutationRequests === 0 &&
        proof.vaultItemPosts.total === 0 &&
        createKeys.size === 0 &&
        createdIds.size === 0;
      assert(proof.admission.noFixtureWrites, 'admission_fixture_write_refused');
      persist();
      if (generatorTransportMode) {
        proof.generatorHarnessSha256 = await sha256(
          path.join(__dirname, 'vault-generator-acceptance.cjs'),
        );
        const generatorHarness = require('./vault-generator-acceptance.cjs');
        await generatorHarness.runGeneratorChecks({
          context,
          worker,
          panel: realPanel,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          screenshotPath: path.join(root, 'generator-masked.png'),
          verifyRealVaultPanel,
          displayMode,
          panelCloseLifecycleMode,
          workerRestartLifecycleMode,
          windowSwitchLifecycleMode,
          isolatedHeadlessClipboard,
          refreshWorker: async (previous, { cdp, workerUrl }) => {
            const diagnostic = (proof.generatorWorkerRefresh = {
              disposition: 'in_progress',
              playwrightFacadeReused: false,
              exactCdpWorkerHandleUsed: false,
            });
            checkpoint('generator_worker_restart_refresh_start');
            try {
              const current = await previous.evaluate(() => ({
                runtimeId: chrome.runtime.id,
                location: location.href,
              }));
              if (current?.runtimeId === extensionId && current.location === workerUrl) {
                diagnostic.playwrightFacadeReused = true;
                diagnostic.disposition = 'reused_reachable_playwright_facade';
                worker = previous;
                checkpoint('generator_worker_restart_refresh_acquired');
                return worker;
              }
            } catch {}
            for (let attempt = 0; attempt < 60; attempt += 1) {
              const targets = await cdp.send('Target.getTargets');
              const currentTarget = targets.targetInfos.find(
                (target) => target.type === 'service_worker' && target.url === workerUrl,
              );
              if (currentTarget) {
                diagnostic.exactCdpWorkerHandleUsed = true;
                diagnostic.disposition = 'exact_cdp_worker_handle_acquired';
                worker = exactCdpWorkerFacade(cdp, currentTarget.targetId);
                checkpoint('generator_worker_restart_refresh_acquired');
                return worker;
              }
              await wait(250);
            }
            diagnostic.disposition = 'not_acquired_before_timeout';
            checkpoint('generator_worker_restart_refresh_timeout');
            throw new Error('generator_worker_restart_reacquisition_timeout');
          },
          reopenPanelFromAction: async (fixturePage, fixtureWindowId) => {
            const reopened = await openSidePanelFromActionPopup(
              extensionId,
              fixturePage,
              fixtureWindowId,
            );
            if (reopened.opened) {
              await realPanel?.dispose();
              realPanel = reopened.panel;
              await networkJournal.bindPanelTarget(realPanel.targetId);
            }
            return reopened;
          },
        });
        if (isolatedHeadlessClipboard) {
          assert(
            generatorHarness.hasIsolatedHeadlessClipboardProof(proof),
            'generator_isolated_clipboard_proof_incomplete',
          );
        }
        assertRequestedLifecycleVerdicts({
          panelCloseRequested: panelCloseLifecycleMode,
          workerRestartRequested: workerRestartLifecycleMode,
          windowSwitchRequested: windowSwitchLifecycleMode,
          generator: proof.generator,
        });
      }
    } else {
      // Capture-decision coverage deliberately precedes this runner's local
      // server and all receipt fixtures. Its callback sees only the central
      // metadata-safe mutation count, never Vault rows or request payloads.
      if (receiptBackedSaveUpdateMode) {
        assert((await hasPendingCapture()) === false, 'capture_decision_pending_before_fixture');
        assert(
          proof.vaultMutationRequests === 0 &&
            proof.vaultItemPosts.total === 0 &&
            createKeys.size === 0 &&
            createdIds.size === 0,
          'capture_decision_write_before_fixture',
        );
        proof.captureHarnessSha256 = await sha256(
          path.join(__dirname, 'vault-capture-decisions-acceptance.cjs'),
        );
        await runCaptureDecisionChecks({
          context,
          worker,
          realPanel,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
          vaultWriteCount: () => proof.vaultMutationRequests,
          pendingCapturePresent: hasPendingCapture,
        });
        assert(
          proof.captureDecisions?.noVaultWriteRequests === true &&
            proof.captureDecisions?.pagesClosed === true &&
            proof.captureDecisions?.fixtureServersClosed === true,
          'capture_decision_cleanup_unverified',
        );
        assert((await hasPendingCapture()) === false, 'capture_decision_pending_after_fixture');
        assert(
          proof.vaultMutationRequests === 0 &&
            proof.vaultItemPosts.total === 0 &&
            createKeys.size === 0 &&
            createdIds.size === 0,
          'capture_decision_write_after_fixture',
        );
        const helperHashesAfterCapture = {
          rawAdapter: await sha256(path.join(__dirname, 'vault-owned-cdp.cjs')),
          journal: await sha256(path.join(__dirname, 'vault-network-journal.cjs')),
          capture: await sha256(path.join(__dirname, 'vault-capture-decisions-acceptance.cjs')),
          authenticator: await sha256(path.join(__dirname, 'vault-authenticator-preservation.cjs')),
          responseLoss: await sha256(path.join(__dirname, 'vault-save-response-loss.cjs')),
          savedForms: await sha256(path.join(__dirname, 'vault-saved-form-matrix.cjs')),
          realSiteFill: await sha256(path.join(__dirname, 'vault-real-site-fill-acceptance.cjs')),
          preferences: await sha256(path.join(__dirname, 'vault-preferences-acceptance.cjs')),
          setupRecovery: await sha256(path.join(__dirname, 'vault-setup-recovery-acceptance.cjs')),
          nativePanelFetchFailure: await sha256(
            path.join(__dirname, 'vault-native-panel-fetch-failure.cjs'),
          ),
          fixtureSetupRetry: await sha256(path.join(__dirname, 'vault-fixture-create-retry.cjs')),
          acceptanceLease: await sha256(path.join(__dirname, 'vault-acceptance-lease.cjs')),
          historicalReconciliation: await sha256(
            path.join(__dirname, 'vault-historical-reconciliation.cjs'),
          ),
          recovery7356: await sha256(path.join(__dirname, 'vault-7356-reconciliation.cjs')),
          accessibility: await sha256(path.join(__dirname, 'vault-accessibility-acceptance.cjs')),
          passwordChange: await sha256(
            path.join(__dirname, 'vault-password-change-acceptance.cjs'),
          ),
          browserRestart: await sha256(
            path.join(__dirname, 'vault-extension-browser-restart-acceptance.cjs'),
          ),
        };
        assert(
          JSON.stringify(helperHashesAfterCapture) === JSON.stringify(proof.helperSha256),
          'helper_source_changed_after_capture',
        );
      }
      local = await startLocalSite();
      localUrl = local.url;
      await prewriteVaultPanelScreenshot();
      const suffix = crypto.randomUUID().slice(0, 8);
      const username = `canary-${suffix}@example.invalid`;
      const oldPassword = `old-${crypto.randomUUID()}`;
      const newPassword = `new-${crypto.randomUUID()}`;
      const targetName = `Canary target ${suffix}`;
      checkpoint('fixture_creation');
      const targetFields = [
        { field_key: 'username', value: username, handling: 'revealable' },
        { field_key: 'password', value: oldPassword, handling: 'revealable' },
        ...(!receiptBackedSaveUpdateMode
          ? [{ field_key: 'totp_seed', value: `mfa-${crypto.randomUUID()}`, handling: 'sealed' }]
          : []),
      ];
      const targetId = await createFixture(targetName, targetFields);
      if (receiptBackedSaveUpdateMode) {
        const authenticatorRequest = async ({ method, path: route, body }) => {
          const url = `${API}/api/authenticator${route}`;
          const headers = { Authorization: `Bearer ${token}`, 'X-Organization-Id': organizationId };
          if (body !== undefined) headers['content-type'] = 'application/json';
          journalVaultMutationRequest(url, method, headers);
          try {
            const response = await fetch(url, {
              method,
              headers,
              signal: AbortSignal.timeout(15_000),
              ...(body !== undefined && { body: JSON.stringify(body) }),
            });
            let responseBody = null;
            if (response.status !== 204) responseBody = await response.json().catch(() => null);
            return { status: response.status, body: responseBody };
          } catch {
            return { status: 'transport' };
          }
        };
        authenticator = createAuthenticatorPreservation({
          request: authenticatorRequest,
          markCleanupObligation: async (handle) => {
            authenticatorHandle = handle;
            proof.authenticator = { cleanupObligationArmed: true };
            persist();
          },
          journal: ({ method, route, status }) => {
            (proof.authenticatorJournal ||= []).push({ method, route, status });
            persist();
          },
        });
        checkpoint('authenticator_enroll_before_update');
        authenticatorHandle = await authenticator.beforeUpdate({ credentialItemId: targetId });
        assert(
          authenticatorHandle?.enrolled === true && authenticatorHandle.acceptanceFailed !== true,
          'authenticator_enrollment_failed',
        );
      }
      const otherIds = [
        await createFixture(`Canary duplicate ${suffix}`, [
          { field_key: 'username', value: username, handling: 'revealable' },
          { field_key: 'password', value: `other-${crypto.randomUUID()}`, handling: 'revealable' },
        ]),
        await createFixture(`Canary no username ${suffix}`, [
          {
            field_key: 'password',
            value: `missing-${crypto.randomUUID()}`,
            handling: 'revealable',
          },
        ]),
        await createFixture(`Canary alternate ${suffix}`, [
          {
            field_key: 'username',
            value: `alternate-${suffix}@example.invalid`,
            handling: 'revealable',
          },
          {
            field_key: 'password',
            value: `alternate-${crypto.randomUUID()}`,
            handling: 'revealable',
          },
        ]),
      ];
      const otherBefore = await Promise.all(otherIds.map(item));
      const targetBefore = await item(targetId);
      const sealedFieldBefore = !receiptBackedSaveUpdateMode
        ? targetBefore.fields.find((field) => field.field_key === 'totp_seed' && field.is_active)
        : null;
      if (!receiptBackedSaveUpdateMode)
        assert(sealedFieldBefore?.id, 'fixture_sealed_field_missing');
      checkpoint('open_vault');
      website = await context.newPage();
      await verifyRealVaultPanel();
      await website.bringToFront();
      checkpoint('submit_login');
      await submitLogin(website, username, newPassword);
      assert(
        (await website.locator('#matrx-login-capture-host').count()) === 0,
        'quiet_default_overlay',
      );
      checkpoint('await_capture');
      await pendingCard();
      // The card can mount before the asynchronous matching response arrives.
      // Require all four choices after bounded UI settlement, not its first render.
      try {
        await realPanel.waitFor(`${updateButtons}.length >= 4`);
      } catch {
        proof.captureDiagnostics = {
          updateButtonCount: await realPanel.evaluate(`${updateButtons}.length`),
          cardPresent: await realPanel.evaluate(`!!(${captureCard})`),
        };
        persist();
        throw new Error('four_update_targets_not_reachable');
      }
      assert(
        (await website.locator('#matrx-login-capture-host').count()) === 0,
        'quiet_delayed_overlay',
      );
      checkpoint('filter_update_target');
      await realPanel.fill(
        `document.querySelector('[aria-label="Search saved logins to update"]')`,
        targetName,
      );
      const targetButton = uniqueCaptureButton(targetName, true);
      await realPanel.waitFor(`!!(${targetButton}) && ${updateButtons}.length === 1`);
      const cardScreenshot = path.join(root, 'synthetic-update-choices.png');
      checkpoint('capture_screenshot');
      await realPanel.screenshot(captureCard, cardScreenshot);
      proof.choiceScreenshot = {
        path: 'synthetic-update-choices.png',
        sha256: await sha256(cardScreenshot),
      };

      const submitsBeforeUpdateChoice = local.state.submits;
      checkpoint('update_decision');
      await realPanel.click(targetButton);
      await waitForCaptureDecision();
      assert(local.state.submits === submitsBeforeUpdateChoice, 'update_choice_submitted_site');
      checkpoint('verify_update');
      const targetAfter = await item(targetId);
      const sealedFieldAfter = !receiptBackedSaveUpdateMode
        ? targetAfter.fields.find((field) => field.field_key === 'totp_seed' && field.is_active)
        : null;
      if (!receiptBackedSaveUpdateMode)
        assert(sealedFieldAfter?.id === sealedFieldBefore.id, 'sealed_field_not_preserved');
      if (receiptBackedSaveUpdateMode) {
        checkpoint('authenticator_verify_after_update');
        assert(
          (await authenticator.afterUpdate(authenticatorHandle)) === true,
          'authenticator_not_preserved',
        );
        proof.checks.enrolledAuthenticatorPreserved = true;
      }
      assert(
        (await materializedPassword(targetId)) === newPassword,
        'selected_target_password_not_updated',
      );
      const otherAfter = await Promise.all(otherIds.map(item));
      assert(
        JSON.stringify(otherAfter) === JSON.stringify(otherBefore),
        'unselected_fixture_changed',
      );
      proof.checks.fourUpdateTargetsReachable = true;
      proof.checks.displayNameSearchSelectedExactTarget = true;
      proof.checks.selectedTargetOnlyUpdated = true;
      if (!receiptBackedSaveUpdateMode) proof.checks.unrelatedSealedFieldPreserved = true;
      proof.checks.updateChoiceDidNotSubmit = true;
      if (receiptBackedSaveUpdateMode) {
        // This helper exercises Fill with the updated, receipt-owned target. It
        // shares the parent's exact origin and never creates another Vault
        // fixture or a sixth receipt-owned item.
        const parentLogin = new URL(localUrl);
        const parentOrigin = parentLogin.origin;
        assert(parentLogin.hostname === '127.0.0.1', 'saved_login_parent_host_refused');
        const fixtureIdsBeforeSavedLogin = new Set(createdIds);
        const fixtureKeysBeforeSavedLogin = new Set(createKeys);
        const itemPostsBeforeSavedLogin = proof.vaultItemPosts.total;
        proof.savedLoginHarnessSha256 = await sha256(
          path.join(__dirname, 'vault-saved-login-acceptance.cjs'),
        );
        checkpoint('saved_login_fill');
        await runSavedLoginChecks({
          context,
          worker,
          realPanel,
          targetName,
          username,
          password: newPassword,
          parentLoginUrl: localUrl,
          parentOrigin,
          getSubmitCount: () => local.state.submits,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
        });
        await runSavedFormMatrix({
          context,
          worker,
          realPanel,
          targetName,
          username,
          password: newPassword,
          parentOrigin,
          getSubmitCount: () => local.state.submits,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
        });
        await runVaultPreferencesChecks({
          context,
          worker,
          realPanel,
          targetName,
          username,
          password: newPassword,
          parentLoginUrl: localUrl,
          getSubmitCount: () => local.state.submits,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
          snapshotOwnedReceiptState: () => ({
            vaultItemPosts: { ...proof.vaultItemPosts },
            ownedCreateMutationKeys: [...createKeys],
            ownedFixtureIds: [...createdIds],
          }),
        });
        await runVaultSetupRecoveryChecks({
          context,
          worker,
          realPanel,
          targetName,
          parentLoginUrl: localUrl,
          getSubmitCount: () => local.state.submits,
          getVaultWriteCount: () => proof.vaultMutationRequests,
          snapshotOwnedReceiptState: () => ({
            vaultItemPosts: { ...proof.vaultItemPosts },
            ownedCreateMutationKeys: [...createKeys].sort(),
            ownedFixtureIds: [...createdIds].sort(),
          }),
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
        });
        assert(
          proof.setupRecovery?.closedRootManualRecovery === true &&
            proof.setupRecovery?.restrictedPageManualRecovery === true &&
            proof.setupRecovery?.inaccessiblePagesNoWritesOrSubmit === true &&
            proof.setupRecovery?.normalPagePanelReadinessRecovered === true &&
            proof.setupRecovery?.wholeHelperNoWritesOrSubmit === true &&
            proof.setupRecovery?.fixturePagesClosed === true,
          'setup_recovery_helper_unverified',
        );
        const changedPassword = `changed-${crypto.randomUUID()}`;
        await runPasswordChangeCaptureChecks({
          context,
          worker,
          realPanel,
          parentOrigin,
          targetName,
          username,
          currentPassword: newPassword,
          nextPassword: changedPassword,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
          pendingCard,
          waitForCaptureDecision,
          captureButton: uniqueCaptureButton,
          pendingCapturePresent: hasPendingCapture,
          getSubmitCount: () => local.state.submits,
          getVaultWriteCount: () => proof.vaultMutationRequests,
          snapshotOwnedReceiptState: () => ({
            vaultItemPosts: { ...proof.vaultItemPosts },
            ownedCreateMutationKeys: [...createKeys].sort(),
            ownedFixtureIds: [...createdIds].sort(),
          }),
          inspectCaptureDiagnostic: inspectPendingCaptureDiagnostic,
          verifySelectedUpdate: async (expectedPassword) => {
            assert(
              (await materializedPassword(targetId)) === expectedPassword,
              'password_change_target_mismatch',
            );
            assert(
              JSON.stringify(await Promise.all(otherIds.map(item))) === JSON.stringify(otherBefore),
              'password_change_unselected_changed',
            );
            assert(
              (await authenticator.afterUpdate(authenticatorHandle)) === true,
              'password_change_authenticator_changed',
            );
            return true;
          },
        });
        const realLoginUrl = 'https://www.aimatrx.com/login';
        // The preceding form matrix uses the owned localhost destination. Move
        // only these four disposable fixtures to the real HTTPS destination so
        // that the localhost control is genuinely a wrong-site refusal check.
        for (const fixtureId of [targetId, ...otherIds]) {
          const updated = await api(`${API}/api/vault/items/${encodeURIComponent(fixtureId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ login_urls: [realLoginUrl] }),
            label: 'real_site_fixture_destination',
          });
          assert(
            updated?.id === fixtureId &&
              JSON.stringify(updated.login_urls) === JSON.stringify([realLoginUrl]),
            'real_site_fixture_destination_mismatch',
          );
        }
        proof.checks.realSiteFixtureDestinationsRetargeted = true;
        // This is the only real HTTPS destination in the receipt-backed journey.
        // The helper selects this exact receipt-owned account, fills without
        // submission, and proves that the same account is absent on the owned
        // cross-origin control before closing both pages.
        proof.realSiteFillHarnessSha256 = await sha256(
          path.join(__dirname, 'vault-real-site-fill-acceptance.cjs'),
        );
        checkpoint('real_site_fill');
        await runRealSiteFillChecks({
          context,
          worker,
          realPanel,
          targetName,
          username,
          password: changedPassword,
          realLoginUrl,
          wrongSiteUrl: localUrl,
          assert,
          wait,
          checkpoint,
          proof,
          focusOwnedBrowser,
          verifyRealVaultPanel,
          recoverRealPanel: async (fixturePage, tabId) => {
            const failedTargetId = realPanel.targetId;
            let reopened;
            let route = 'existing_global_panel';
            try {
              reopened = await openGenuineSidePanel(extensionId, null, { existing: true });
              assert(
                (await reopened.evaluate('true')) === true,
                'real_site_panel_recovery_probe_refused',
              );
            } catch (error) {
              if (
                !['real_side_panel_missing', 'real_side_panel_target_missing'].includes(
                  error.message,
                ) &&
                error.message !== 'panel_protocol_refused'
              )
                throw error;
              await reopened?.dispose();
              reopened = undefined;
              route = 'genuine_action_popup';
              const windowId = await worker.evaluate(
                async (id) => (await chrome.tabs.get(id)).windowId,
                tabId,
              );
              const result = await openSidePanelFromActionPopup(extensionId, fixturePage, windowId);
              assert(result.opened === true, 'real_site_panel_recovery_reopen_refused');
              reopened = result.panel;
            }
            assert(reopened?.targetId, 'real_site_panel_recovery_target_missing');
            try {
              await networkJournal.bindPanelTarget(reopened.targetId);
            } catch (error) {
              await reopened.dispose();
              throw error;
            }
            await realPanel?.dispose();
            realPanel = reopened;
            proof.realSiteFill.panelRecovery = {
              route,
              failedTargetId,
              recoveredTargetId: reopened.targetId,
            };
            persist();
            return reopened;
          },
        });
        assert(
          proof.realSiteFill?.realHttpsLoginFormReady === true &&
            proof.realSiteFill?.exactSavedAccountFilled === true &&
            proof.realSiteFill?.noWebsiteSubmission === true &&
            proof.realSiteFill?.wrongSiteRefused === true &&
            proof.realSiteFill?.pageClosed === true,
          'real_site_fill_evidence_unverified',
        );
        assert(
          createdIds.size === fixtureIdsBeforeSavedLogin.size &&
            [...fixtureIdsBeforeSavedLogin].every((id) => createdIds.has(id)),
          'saved_login_helper_created_fixture',
        );
        assert(
          createKeys.size === fixtureKeysBeforeSavedLogin.size &&
            [...fixtureKeysBeforeSavedLogin].every((key) => createKeys.has(key)),
          'saved_login_helper_created_fixture_key',
        );
        assert(
          proof.vaultItemPosts.total === itemPostsBeforeSavedLogin,
          'saved_login_helper_item_post',
        );
        assert(proof.savedLoginFill?.pagesClosed === true, 'saved_login_helper_pages_not_closed');
        proof.checks.savedLoginUsesReceiptOwnedFixture = true;
        proof.checks.savedLoginNoAdditionalVaultFixture = true;
        // Save as New resumes on the owned localhost page. Restore only the
        // same receipt-owned fixtures after every real-site assertion, so the
        // prior HTTPS fill proof cannot turn this next capture into an Update.
        for (const fixtureId of [targetId, ...otherIds]) {
          const restored = await api(`${API}/api/vault/items/${encodeURIComponent(fixtureId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ login_urls: [localUrl] }),
            label: 'real_site_fixture_destination_restore',
          });
          assert(
            restored?.id === fixtureId &&
              JSON.stringify(restored.login_urls) === JSON.stringify([localUrl]),
            'real_site_fixture_destination_restore_mismatch',
          );
        }
        proof.checks.realSiteFixtureDestinationsRestored = true;
      }
      checkpoint('save_as_new');
      const beforeSave = new Set((await items()).map((entry) => entry.id));
      await submitLogin(website, `save-${suffix}@example.invalid`, `save-${crypto.randomUUID()}`);
      await pendingCard();
      const submitsBeforeSaveChoice = local.state.submits;
      const postsBeforeSave = proof.vaultItemPosts.total;
      const keysBeforeSave = new Set(createKeys);
      responseLossPostsBefore = postsBeforeSave;
      responseLossKeysBefore = keysBeforeSave;
      if (receiptBackedSaveUpdateMode) {
        for (const key of keysBeforeSave) responseLossFixtureKeys.add(key);
        assert(
          await worker.evaluate(async () => {
            const rows = Object.values(
              (await chrome.storage.session.get('matrx.credentials.capture.pending.v1'))[
                'matrx.credentials.capture.pending.v1'
              ] || {},
            );
            if (rows.length !== 1) return false;
            const c = rows[0];
            if (
              typeof c.id !== 'string' ||
              !Number.isInteger(c.tabId) ||
              typeof c.sourceDocumentId !== 'string'
            )
              return false;
            globalThis.__vaultCanaryPendingIdentity = JSON.stringify([
              c.id,
              c.tabId,
              c.sourceDocumentId,
            ]);
            return true;
          }),
          'response_loss_candidate_identity_missing',
        );
        responseLoss = createVaultSaveResponseLoss({
          context,
          apiOrigin: API,
          exactExtensionWorkerUrl: worker.url(),
          existingFixtureKeys: keysBeforeSave,
          onRejectedBeforeForwardKey: (key) => {
            rejectedBeforeForwardKeys.add(key);
            proof.rejectedBeforeForwardCreateKeys = [...rejectedBeforeForwardKeys];
            persist();
          },
        });
        await responseLoss.install();
        responseLossInstalled = true;
      }
      await realPanel.click(uniqueCaptureButton('Save as new'));
      if (responseLoss) {
        await responseLoss.waitForFirstLoss();
        await realPanel.waitFor(
          `Array.from((${captureCard})?.querySelectorAll('p') || []).filter((p) => p.textContent?.trim() === 'The Vault could not save that. Try again from the Vault tab.').length === 1 && !!(${uniqueCaptureButton('Save as new')}) && !(${uniqueCaptureButton('Save as new')}).disabled`,
          true,
          15000,
        );
        const identityPreserved = await worker.evaluate(async () => {
          const rows = Object.values(
            (await chrome.storage.session.get('matrx.credentials.capture.pending.v1'))[
              'matrx.credentials.capture.pending.v1'
            ] || {},
          );
          const c = rows.length === 1 ? rows[0] : null;
          return (
            !!c &&
            globalThis.__vaultCanaryPendingIdentity ===
              JSON.stringify([c.id, c.tabId, c.sourceDocumentId])
          );
        });
        assert(identityPreserved, 'response_loss_candidate_changed');
        const newKeys = [...createKeys].filter((key) => !keysBeforeSave.has(key));
        assert(
          proof.vaultItemPosts.total === postsBeforeSave + 1 && newKeys.length === 1,
          'response_loss_automatic_retry_or_missing_key',
        );
        responseLossKey = newKeys[0];
        proof.checks.lostResponsePreservesCandidate = true;
        responseLoss.allowExplicitRetry();
        await realPanel.click(uniqueCaptureButton('Save as new'));
      }
      await waitForCaptureDecision();
      if (responseLoss) {
        responseLoss.assertCompleted();
        assert(
          proof.vaultItemPosts.total === postsBeforeSave + 2 &&
            createKeys.size === keysBeforeSave.size + 1,
          'response_loss_retry_key_or_count',
        );
        proof.responseLoss = responseLoss.snapshot();
      }
      assert(local.state.submits === submitsBeforeSaveChoice, 'save_choice_submitted_site');
      const afterSave = await items();
      const delta = afterSave.filter((entry) => !beforeSave.has(entry.id));
      assert(delta.length === 1, 'save_not_exactly_one_item');
      createdIds.add(delta[0].id);
      proof.ownedFixtureIds = [...createdIds];
      if (artifactAdmitted) persist();
      if (responseLoss) {
        await responseLoss.dispose();
        proof.responseLoss = responseLoss.snapshot();
        proof.cleanup.responseLossRouteRemoved =
          proof.responseLoss.unrouteSucceeded && proof.responseLoss.handlerCount === 0;
        assert(proof.cleanup.responseLossRouteRemoved, 'response_loss_route_cleanup_unproven');
        persist();
        await reconcile();
        assert(
          receiptKeys().length === 5 && receiptItemByKey.get(responseLossKey) === delta[0].id,
          'response_loss_receipt_result_mismatch',
        );
        proof.checks.lostResponseRetryExactlyOne = true;
      }
      proof.checks.saveAsNewExactOne = true;
      proof.checks.saveChoiceDidNotSubmit = true;
      proof.openProof = [
        ...(!responseLoss ? ['lost-response retry is not exercised by this canary'] : []),
        'browser restart and distributed-release acceptance are separate gates',
      ];
    }
    if (responseLoss) {
      assert(
        proof.vaultItemPosts.total === responseLossPostsBefore + 2 &&
          createKeys.size === responseLossKeysBefore.size + 1 &&
          [...responseLossKeysBefore].every((key) => createKeys.has(key)) &&
          createKeys.has(responseLossKey),
        'response_loss_terminal_attempt_or_key_count',
      );
    }
    proof.networkJournal.preDisposalSnapshot = networkJournal.snapshot();
    persist();
    await networkJournal.assertCoverage();
    proof.networkJournal.preDisposalCoverage = true;
    persist();
  } catch (error) {
    failure = error;
    proof.failurePhase = proof.phase;
    proof.failureType = /^[A-Za-z]+$/.test(error?.name || '') ? error.name : 'Error';
    proof.failureCode =
      String(error?.message || 'canary_failure').match(/^[a-z0-9_]{1,100}$/)?.[0] ||
      'canary_failure';
    if (proof.failureCode === 'canary_failure') {
      proof.failureLocations = safeVaultStackLocations(error?.stack);
    }
    if (artifactAdmitted) persist();
  } finally {
    if (responseLoss && responseLossInstalled) {
      try {
        await responseLoss.dispose();
      } catch (error) {
        if (!failure) {
          failure = error;
          proof.failurePhase ||= 'response_loss_cleanup';
          proof.failureCode ||= 'response_loss_cleanup_failed';
        }
      }
      proof.responseLoss = responseLoss.snapshot();
      proof.cleanup.responseLossRouteRemoved =
        proof.responseLoss.unrouteSucceeded && proof.responseLoss.handlerCount === 0;
    }
    // The enrolled authenticator is an independent receipt-owned resource. Its
    // cleanup must run before item deletion and must not suppress that deletion.
    if (authenticatorHandle) {
      try {
        const cleaned = await authenticator.cleanup(authenticatorHandle);
        proof.cleanup.authenticator = { cleanupProven: cleaned === true };
        if (cleaned !== true) throw new Error('authenticator_cleanup_unproven');
      } catch (error) {
        proof.cleanup.authenticator = { cleanupProven: authenticatorHandle.cleanupProven === true };
        if (!failure) {
          failure = error;
          proof.failurePhase ||= 'authenticator_cleanup';
          proof.failureCode ||= 'authenticator_cleanup_failed';
        }
      }
    }
    try {
      if (website && !website.isClosed()) {
        await website
          .goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
          .catch(() => {});
        await website
          .evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          })
          .catch(() => {});
        proof.cleanup.localWebsiteSignedOut = true;
      }
      if (token && organizationId && createKeys.size) {
        proof.cleanup.stage = 'receipt_reconciliation';
        const proven = await reconcile();
        for (const id of proven) {
          assert(createdIds.has(id) && !baselineIds.has(id), 'cleanup_ownership_refused');
        }
        if (localCanonicalCleanupArmed) {
          proof.cleanup.stage = 'canonical_adapter';
          try {
            const localCleanup = await localCanonicalCleanup(proven);
            proof.cleanup.localCanonical = {
              route: localCleanup.route,
              provenance: localCleanup.provenance,
              sourceSha256: localCleanup.sourceSha256,
              receiptCount: localCleanup.receiptCount,
              attempts: localCleanup.attempts,
            };
          } catch (error) {
            // Only the observed broad-package boot TypeError can use the
            // distributed route, and it stays restricted to receipt-owned IDs.
            if (!isKnownLocalAdapterBootTypeError(proof.cleanup.canonicalAdapterFailure))
              throw error;
            proof.cleanup.stage = 'canonical_distributed_fallback';
            await distributedReceiptCleanupFallback(proven);
          }
          proof.cleanup.receiptReconciled = proven.size === createdIds.size;
          const baselineAfter = await items();
          const remaining = new Set(baselineAfter.map((entry) => entry.id));
          proof.cleanup.baselineUntouched =
            proof.baselineMetadataSha256 ===
            baselineMetadataSha256(baselineAfter.filter((entry) => baselineIds.has(entry.id)));
          proof.cleanup.createdItemsGone = [...createdIds].every((id) => !remaining.has(id));
          proof.cleanup.finalItemIdsMatchBaseline =
            remaining.size === baselineIds.size &&
            [...baselineIds].every((id) => remaining.has(id));
        } else {
          for (const id of proven)
            await api(`${API}/api/vault/items/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              label: 'cleanup_delete',
            });
          const remaining = new Set((await items()).map((entry) => entry.id));
          proof.cleanup.receiptReconciled = proven.size === createdIds.size;
          const baselineAfter = await items();
          proof.cleanup.baselineUntouched =
            [...baselineIds].every((id) => remaining.has(id)) &&
            proof.baselineMetadataSha256 ===
              baselineMetadataSha256(baselineAfter.filter((entry) => baselineIds.has(entry.id)));
          proof.cleanup.createdItemsGone = [...createdIds].every((id) => !remaining.has(id));
          proof.cleanup.finalItemIdsMatchBaseline =
            remaining.size === baselineIds.size &&
            [...baselineIds].every((id) => remaining.has(id));
        }
      }
    } catch (error) {
      proof.cleanup.failure = 'cleanup_refused';
      proof.cleanup.failureCode = /^[a-z0-9_]{1,100}$/.test(error?.message || '')
        ? error.message
        : 'cleanup_exception';
    }
    // A receipt-mode run that observed a baseline must prove its own cleanup
    // left that exact baseline intact, even when it failed before any create.
    // Do not invent this evidence when baseline capture never occurred.
    if (
      (receiptBackedSaveUpdateMode || readOnlyAdmissionMode) &&
      typeof proof.baselineMetadataSha256 === 'string'
    ) {
      try {
        const baselineAfterFailure = await items();
        const finalIds = new Set(baselineAfterFailure.map((entry) => entry.id));
        proof.cleanup.finalItems = baselineAfterFailure
          .map((entry) => ({ id: entry.id, metadataSha256: baselineMetadataSha256([entry]) }))
          .sort((a, b) => a.id.localeCompare(b.id));
        proof.cleanup.baselineDifference = {
          addedIds: [...finalIds].filter((id) => !baselineIds.has(id)),
          removedIds: [...baselineIds].filter((id) => !finalIds.has(id)),
          changedIds: proof.baselineItems
            .filter(
              (before) =>
                finalIds.has(before.id) &&
                proof.cleanup.finalItems.find((after) => after.id === before.id)?.metadataSha256 !==
                  before.metadataSha256,
            )
            .map((entry) => entry.id),
        };
        proof.cleanup.finalBaselineIdSetMatches =
          finalIds.size === baselineIds.size && [...baselineIds].every((id) => finalIds.has(id));
        proof.cleanup.finalBaselineMetadataMatches =
          proof.baselineMetadataSha256 ===
          baselineMetadataSha256(baselineAfterFailure.filter((entry) => baselineIds.has(entry.id)));
      } catch {
        proof.cleanup.finalBaselineIdSetMatches = false;
        proof.cleanup.finalBaselineMetadataMatches = false;
      }
    }
    // Authentication cleanup is independent of mutation cleanup. If identity
    // failed before assigning `token`, read the still-live disposable profile
    // once for a bearer presence bit and revoke only that exact local session.
    // No profile/token values leave memory or enter proof.
    if (!token && worker) {
      try {
        const stored = await storage(['matrx.user.profile', 'matrx.auth.accessToken']);
        const observedToken = stored['matrx.auth.accessToken'];
        proof.cleanup.authStorageAtCleanup = {
          profilePresent: !!stored['matrx.user.profile'],
          accessTokenPresent: typeof observedToken === 'string',
        };
        if (typeof observedToken === 'string' && observedToken.length > 20) token = observedToken;
      } catch {
        proof.cleanup.authStorageAtCleanup = { unavailable: true };
      }
    }
    // Revocation is safe for the exact bearer recovered from this disposable
    // profile and requires no broader account/session lookup.
    if (token) {
      proof.cleanup.localAuthLogoutAttempts = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const logout = await fetch(`${DB}/auth/v1/logout?scope=local`, {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: {
              apikey: process.env.SUPABASE_MATRIX_PUBLISHABLE_KEY,
              Authorization: `Bearer ${token}`,
            },
          });
          proof.cleanup.localAuthLogoutAttempts.push(logout.status);
          proof.cleanup.localAuthLogoutStatus = logout.status;
          proof.cleanup.remoteAuthRevocationStatus = logout.status;
          if (logout.status === 204) break;
        } catch {
          proof.cleanup.localAuthLogoutAttempts.push('transport_error');
        }
        if (attempt < 2) await wait(1000);
      }
      if (proof.cleanup.remoteAuthRevocationStatus !== 204) {
        proof.cleanup.localAuthLogoutFailure = true;
        proof.cleanup.remoteAuthRevocation = 'failed';
      }
    } else if (proof.authenticationAttempted) {
      proof.cleanup.remoteAuthRevocation = 'not_observed';
    } else {
      proof.cleanup.remoteAuthRevocation = 'not_applicable';
    }
    try {
      if (networkJournal) {
        proof.networkJournal.beforeCleanupSnapshot = networkJournal.snapshot();
        if (artifactAdmitted) persist();
        await networkJournal.dispose();
        const snapshot = networkJournal.snapshot();
        proof.networkJournal = {
          ...(proof.networkJournal || {}),
          postDisposalSnapshot: snapshot,
          disposalSucceeded:
            snapshot.cleanupPhase === 'complete' &&
            snapshot.observerError === false &&
            snapshot.transportFatal === false &&
            snapshot.remainingOwnedSessionCount === 0 &&
            snapshot.pendingSetupCount === 0,
        };
        if (proof.networkJournal.disposalSucceeded !== true)
          throw new Error('vault_network_disposal_unproven');
      } else if (rawCdp) {
        await rawCdp.detach();
        proof.cleanup.networkJournal = 'adapter_closed_before_journal_start';
      }
    } catch (error) {
      proof.cleanup.networkJournal = 'failed';
      if (!failure) {
        failure = error;
        proof.failurePhase ||= 'network_journal_cleanup';
        proof.failureCode ||= 'vault_network_cleanup_failed';
      }
    }
    lifecycleLogoutObserver?.();
    lifecycleLogoutObserver = undefined;
    await realPanel?.dispose();
    try {
      if (context) await context.close();
      proof.cleanup.browserClosed = true;
    } catch {
      proof.cleanup.browserClosed = false;
    }
    const restartReplacementPid = proof.lifecycle?.browserRestart?.replacementBrowserPid;
    if (Number.isSafeInteger(restartReplacementPid) && restartReplacementPid > 1) {
      try {
        proof.cleanup.restartReplacementProcessExited =
          await verifyBrowserProcessExited(restartReplacementPid);
      } catch {
        proof.cleanup.restartReplacementProcessExited = false;
      }
      if (!proof.cleanup.restartReplacementProcessExited) proof.cleanup.browserClosed = false;
    }
    try {
      if (local)
        await new Promise((resolve, reject) =>
          local.server.close((error) => (error ? reject(error) : resolve())),
        );
      proof.cleanup.localFixtureServerClosed = local ? true : 'not_started';
    } catch {
      proof.cleanup.localFixtureServerClosed = false;
    }
    await fs.rm(profile, { recursive: true, force: true });
    proof.cleanup.profileRemoved = !(await fs.stat(profile).then(
      () => true,
      () => false,
    ));
    proof.cleanup.localCredentialDisposal = proof.cleanup.profileRemoved
      ? 'profile_removed'
      : 'profile_removal_failed';
    proof.cleanup.vaultMutationFree =
      proof.vaultMutationRequests === 0 &&
      proof.vaultItemPosts.total === 0 &&
      createKeys.size === 0 &&
      createdIds.size === 0 &&
      proof.cleanup.browserClosed === true &&
      proof.networkJournal?.preDisposalCoverage === true &&
      proof.networkJournal?.disposalSucceeded === true &&
      proof.networkJournal?.postDisposalSnapshot?.observerError === false &&
      proof.networkJournal?.postDisposalSnapshot?.transportFatal === false;
    if (readOnlyAdmissionMode) {
      proof.admission.noFixtureWrites =
        proof.vaultMutationRequests === 0 &&
        proof.vaultItemPosts.total === 0 &&
        createKeys.size === 0 &&
        createdIds.size === 0;
      proof.admission.cleanup = {
        noVaultMutationRequests: proof.cleanup.vaultMutationFree,
        localAuthLogoutStatus: proof.cleanup.localAuthLogoutStatus,
        browserClosed: proof.cleanup.browserClosed,
        profileRemoved: proof.cleanup.profileRemoved,
      };
      proof.admission.ok =
        !failure &&
        proof.admission.baselineRead === true &&
        proof.admission.noFixtureWrites === true &&
        proof.cleanup.vaultMutationFree === true &&
        proof.cleanup.localAuthLogoutStatus === 204 &&
        proof.cleanup.browserClosed === true &&
        proof.cleanup.profileRemoved === true &&
        proof.networkJournal?.preDisposalCoverage === true &&
        proof.networkJournal?.disposalSucceeded === true;
      // `ok` remains reserved for a full Save/Update acceptance proof.
      proof.ok = false;
    } else {
      proof.ok =
        !failure &&
        proof.cleanup.receiptReconciled &&
        proof.cleanup.baselineUntouched &&
        proof.cleanup.createdItemsGone &&
        proof.cleanup.finalItemIdsMatchBaseline === true &&
        proof.cleanup.profileRemoved &&
        proof.cleanup.localAuthLogoutStatus === 204 &&
        proof.cleanup.browserClosed === true &&
        proof.networkJournal?.preDisposalCoverage === true &&
        proof.networkJournal?.disposalSucceeded === true &&
        (!receiptBackedSaveUpdateMode ||
          (proof.cleanup.localFixtureServerClosed === true &&
            proof.cleanup.finalBaselineIdSetMatches === true &&
            proof.cleanup.finalBaselineMetadataMatches === true &&
            proof.cleanup.authenticator?.cleanupProven === true &&
            proof.checks.enrolledAuthenticatorPreserved === true));
    }
    if (acceptanceLease) {
      // A read-only lifecycle probe can fail before the first panel list read
      // (for example, while its worker is restarting). That is a failed
      // acceptance, but a healthy closed journal with zero writes and no
      // owned fixture still proves the Vault custody needed to release its
      // exclusive lease. Do not promote this to vaultMutationFree or ok.
      const earlyReadOnlyNoWriteCleanup = hasEarlyReadOnlyNoWriteCleanup(proof);
      const vaultCleanupProven =
        proof.cleanup.vaultMutationFree === true ||
        earlyReadOnlyNoWriteCleanup ||
        hasPreAuthNoWriteCleanup(proof) ||
        (proof.cleanup.receiptReconciled === true &&
          proof.cleanup.createdItemsGone === true &&
          proof.cleanup.finalItemIdsMatchBaseline === true &&
          proof.cleanup.baselineUntouched === true &&
          (!receiptBackedSaveUpdateMode ||
            (proof.cleanup.finalBaselineIdSetMatches === true &&
              proof.cleanup.finalBaselineMetadataMatches === true)));
      const safeToRelease =
        vaultCleanupProven &&
        (!proof.lifecycle?.browserRestartCustody?.replacementLaunchAttempted ||
          Number.isSafeInteger(restartReplacementPid) ||
          proof.lifecycle.browserRestartCustody.failedLaunchCleanupProven === true) &&
        (!Number.isSafeInteger(restartReplacementPid) ||
          (proof.cleanup.restartReplacementProcessExited === true &&
            (proof.lifecycle.browserRestart.cleanupProven === true ||
              proof.lifecycle.browserRestart.replacementOwnership === 'caller'))) &&
        proof.cleanup.browserClosed === true &&
        proof.cleanup.profileRemoved === true &&
        [true, 'not_started'].includes(proof.cleanup.localFixtureServerClosed) &&
        (!proof.authenticationAttempted || proof.cleanup.remoteAuthRevocationStatus === 204);
      try {
        assert(safeToRelease, 'vault_acceptance_lease_retained_for_cleanup');
        await acceptanceLease.release();
        proof.acceptanceLeaseReleased = true;
      } catch {
        proof.acceptanceLeaseReleased = false;
        proof.ok = false;
        if (proof.admission) proof.admission.ok = false;
        proof.failureCode ||= 'vault_acceptance_lease_cleanup_failed';
      }
    }
    const succeeded = readOnlyAdmissionMode ? proof.admission.ok : proof.ok;
    // Persist outside the disposable profile only as a value-free, caller-chosen path.
    // Artifact admission is the first durable boundary. A rejected/missing
    // artifact has no browser, auth, or cleanup obligation to journal.
    if (artifactAdmitted && !generatorFocusPreflightRefused) {
      persist();
      if (process.env.MATRX_VAULT_CANARY_PROOF)
        await fs.writeFile(
          process.env.MATRX_VAULT_CANARY_PROOF,
          `${JSON.stringify(proof, null, 2)}\n`,
          { mode: 0o600 },
        );
    }
    if (!succeeded) process.stderr.write(`Acceptance refused: ${proof.failureCode || 'cleanup'}\n`);
    else if (readOnlyAdmissionMode)
      process.stdout.write(
        'PASS: read-only extension Vault admission and mutation-free Vault cleanup\n',
      );
    else
      process.stdout.write(
        'PASS: real extension Vault Save/Update acceptance and receipt-backed cleanup\n',
      );
  }
  if (!(readOnlyAdmissionMode ? proof.admission?.ok : proof.ok)) process.exitCode = 1;
})();
