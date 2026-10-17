import { panelFailureCategory } from './settings-panel-driver.mjs';

const ACCOUNT_BOOLEAN_KEYS = [
  'emailMatchesReviewer',
  'signOutVisible',
  'signInVisible',
  'organizationSelected',
  'organizationPickerAvailable',
  'organizationLoading',
  'chatVisible',
  'swipeFileVisible',
];
const STORAGE_BOOLEAN_KEYS = ['accessTokenPresent', 'profilePresent', 'activeOrganizationPresent'];
const ROLE_CATEGORIES = new Set(['absent', 'admin', 'non_admin']);
const WAIT_CATEGORIES = new Set([
  'panel_target_unavailable',
  'panel_runtime_unavailable',
  'panel_observation_unavailable',
]);

function safeShape(value, keys, includeRole = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { status: 'unavailable', category: 'observation_invalid' };
  const shape = Object.fromEntries(
    keys.filter((key) => typeof value[key] === 'boolean').map((key) => [key, value[key]]),
  );
  if (includeRole && ROLE_CATEGORIES.has(value.observedRoleCategory))
    shape.observedRoleCategory = value.observedRoleCategory;
  if (
    includeRole &&
    Number.isInteger(value.actingAsPickerCount) &&
    value.actingAsPickerCount >= 0 &&
    value.actingAsPickerCount <= 100
  )
    shape.actingAsPickerCount = value.actingAsPickerCount;
  return Object.keys(shape).length
    ? shape
    : { status: 'unavailable', category: 'observation_invalid' };
}

async function boundedObservation(read, timeoutMs, keys, includeRole = false) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(read)
        .then((value) => safeShape(value, keys, includeRole))
        .catch((error) => ({ status: 'unavailable', category: panelFailureCategory(error) })),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ status: 'unavailable', category: 'observation_timeout' }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function waitCategory(error) {
  if (WAIT_CATEGORIES.has(error?.waitFailureCategory)) return error.waitFailureCategory;
  const message = String(error?.message ?? '');
  if (/Target closed|Session closed|WebSocket closed|detached|No target/i.test(message))
    return 'panel_target_unavailable';
  if (message.includes('panel_runtime_exception')) return 'panel_runtime_unavailable';
  return 'identity_not_observed';
}

async function recordFailureObservation({
  report,
  waitError,
  observeAccount,
  observeStorage,
  captureScreenshot,
  observationTimeoutMs = 2000,
}) {
  const [account, storage] = await Promise.all([
    boundedObservation(observeAccount, observationTimeoutMs, ACCOUNT_BOOLEAN_KEYS, true),
    boundedObservation(observeStorage, observationTimeoutMs, STORAGE_BOOLEAN_KEYS),
  ]);
  report.account = {
    ...report.account,
    ...(waitError && { identity_wait_failure_category: waitCategory(waitError) }),
    timeout_observation: account,
    storage_shape: storage,
  };
  report.screenshots = { timeout_panel: null, timeout_panel_status: 'unavailable' };
  let screenshotTimer;
  try {
    const path = await Promise.race([
      Promise.resolve().then(captureScreenshot),
      new Promise((_, reject) => {
        screenshotTimer = setTimeout(
          () => reject(new Error('screenshot_timeout')),
          observationTimeoutMs,
        );
      }),
    ]);
    report.screenshots = { timeout_panel: path, timeout_panel_status: 'captured' };
  } catch {
    // Screenshot is optional evidence; the identity failure remains authoritative.
  } finally {
    clearTimeout(screenshotTimer);
  }
}

export async function recordIdentityWaitFailure(options) {
  await recordFailureObservation(options);
  throw new Error('reviewer_extension_identity_unverified');
}

// Identity readiness and canonical role proof are separate acceptance gates.
// Persist the first success before entering the second, even when it fails.
export async function verifyReviewerRole({
  report,
  onStage,
  adminCheck,
  userId,
  failureObservations,
}) {
  report.account = { ...report.account, extension_identity_observed: true };
  onStage('extension_canonical_role_verify');
  try {
    return await adminCheck.verify(userId);
  } catch {
    report.account.canonical_role_observation = adminCheck.snapshot?.(userId) ?? {
      status: 'unavailable',
    };
    if (adminCheck.networkSnapshot)
      report.account.canonical_role_network = adminCheck.networkSnapshot();
    if (failureObservations) await recordFailureObservation({ ...failureObservations, report });
    throw new Error('reviewer_canonical_role_unverified');
  }
}
