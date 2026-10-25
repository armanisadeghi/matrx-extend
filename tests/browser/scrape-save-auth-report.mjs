import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  memberAuthFailureReport,
  safeMemberAuthFailureCode,
} from './settings-member-auth-diagnostic.mjs';

const NATIVE_STAGES = new Set([
  'receipt',
  'artifact_verify',
  'browser_runtime',
  'profile_prepare',
  'browser_spawn',
  'cdp_connect',
  'endpoint_read',
  'command_line_query',
  'command_line_verify',
  'extension_worker',
  'spawn_owner',
  'local_server',
  'playwright_connect',
  'page_create',
  'local_page_navigation',
  'panel_open',
  'panel_reply',
  'panel_target',
  'panel_context',
  'panel_settle',
  'demo_navigation',
  'screenshot',
  'exercise_panel',
]);
const AUTH_STAGES = new Set([
  'member_credential_validation',
  'member_web_identity_observation',
  'member_demo_route_assertion',
  'member_extension_signin_ready',
  'member_extension_token_observation',
  'member_nonadmin_role_observation',
  'member_organization_availability',
  'member_organization_selection',
  'member_organization_selected',
  'member_organization_storage_resolution',
  'member_rendered_identity',
  'member_logical_organization_proof',
]);
const PHASES = new Set([
  'canonical_role_verify_failed',
  'organization_trigger_click',
  'organization_option_visibility',
  'organization_option_click',
  'organization_selected',
  'logical_organization_request',
]);
const TARGETS = new Set([
  'organization_tools_gate',
  'organization_tools_click',
  'organization_records_gate',
  'organization_records_click',
  'organization_request_wait',
  'organization_settings_return',
]);
const BOOLEAN_FIELDS = [
  'organization_selected',
  'expected_organization_matches',
  'click_settled',
  'trigger_enabled',
  'menu_open',
  'target_in_viewport',
  'target_center_hit',
];
const COUNT_FIELDS = [
  'trigger_count',
  'visible_trigger_count',
  'visible_option_count',
  'exact_match_count',
  'exact_visible_match_count',
  'matched_target_count',
  'visible_target_count',
];
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/** Project only the member driver's finite labels, booleans and counts. */
export function safeScrapeSaveAuthDiagnostic(value) {
  if (!PHASES.has(value?.phase)) return {};
  const safe = { phase: value.phase };
  if (TARGETS.has(value.target)) safe.target = value.target;
  for (const field of BOOLEAN_FIELDS) {
    if (typeof value[field] === 'boolean' || value[field] === null) safe[field] = value[field];
  }
  for (const field of COUNT_FIELDS) {
    if (count(value[field]) !== null || value[field] === null) safe[field] = count(value[field]);
  }
  if (['active', 'archived', 'all', 'unknown'].includes(value.archive_filter))
    safe.archive_filter = value.archive_filter;
  if (
    typeof value.failure_code === 'string' &&
    safeMemberAuthFailureCode({ message: value.failure_code }, 'member_organization_selection') ===
      value.failure_code
  )
    safe.failure_code = value.failure_code;
  if (value.canonical_role_observation) {
    const observation = value.canonical_role_observation;
    const outcomes = new Set([
      'pending',
      'complete',
      'invalid_body_shape',
      'invalid_body',
      'body_unavailable',
      'request_failed',
    ]);
    safe.canonical_role_observation = {
      observed_request_count: count(observation.observed_request_count),
      current_user_requests: Array.isArray(observation.current_user_requests)
        ? observation.current_user_requests.map((entry) => ({
            status:
              Number.isInteger(entry?.status) && entry.status >= 100 && entry.status <= 599
                ? entry.status
                : null,
            row_count: count(entry?.row_count),
            outcome: outcomes.has(entry?.outcome) ? entry.outcome : 'unknown',
          }))
        : [],
    };
  }
  if (value.canonical_role_network) {
    const network = value.canonical_role_network;
    safe.canonical_role_network = {
      total_requests: count(network.total_requests),
      database_requests: count(network.database_requests),
      boundaries: Array.isArray(network.boundaries)
        ? network.boundaries.map((entry) => ({
            boundary: ['memberships', 'organizations', 'account_choice', 'role'].includes(
              entry?.boundary,
            )
              ? entry.boundary
              : 'unknown',
            status:
              Number.isInteger(entry?.status) && entry.status >= 100 && entry.status <= 599
                ? entry.status
                : null,
            outcome: ['pending', 'complete', 'request_failed'].includes(entry?.outcome)
              ? entry.outcome
              : 'unknown',
            count: count(entry?.count),
          }))
        : [],
      role_mismatches: Object.fromEntries(
        ['origin', 'method', 'schema', 'selection', 'user_filter']
          .filter((key) => count(network.role_mismatches?.[key]) !== null)
          .map((key) => [key, network.role_mismatches[key]]),
      ),
    };
  }
  return safe;
}

function safeArtifact(value) {
  if (
    value?.kind !== 'ci_development_test' ||
    value.eligible_store !== false ||
    !/^[a-f0-9]{40}$/.test(value?.source_sha ?? '') ||
    !/^[a-f0-9]{64}$/.test(value?.tree_sha256 ?? '') ||
    !/^\d+\.\d+\.\d+$/.test(value?.version ?? '') ||
    !Number.isSafeInteger(value?.run_id) ||
    value.run_id <= 0 ||
    !Number.isSafeInteger(value?.artifact_id) ||
    value.artifact_id <= 0
  )
    return null;
  return {
    kind: 'ci_development_test',
    eligible_store: false,
    source_sha: value.source_sha,
    run_id: value.run_id,
    artifact_id: value.artifact_id,
    tree_sha256: value.tree_sha256,
    version: value.version,
  };
}

function safeAuthentication(value) {
  if (value?.mode !== 'member') return null;
  return {
    mode: 'member',
    ...Object.fromEntries(
      [
        'web_signed_in',
        'extension_signed_in',
        'non_admin_role_verified',
        'selected_organization_verified',
      ].map((key) => [key, typeof value[key] === 'boolean' ? value[key] : null]),
    ),
    organization_resolution: ['load_ladder', 'device_choice'].includes(
      value.organization_resolution,
    )
      ? value.organization_resolution
      : null,
  };
}

/** One synchronous atomic replacement serves both interrupted checkpoints and final reports. */
function publishScrapeSaveReport(report, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const destination = join(outputDir, 'scrape-save-native-acceptance.json');
  const temporary = join(outputDir, `.scrape-save-native-acceptance-${randomUUID()}.json`);
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, destination);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

export function recordScrapeSaveCheckpoint(report, kind, value, outputDir = 'test-results') {
  if (
    (kind === 'native_stage' && !NATIVE_STAGES.has(value)) ||
    (kind === 'auth_stage' && !AUTH_STAGES.has(value)) ||
    ![
      'native_stage',
      'auth_stage',
      'auth_diagnostic',
      'auth_start',
      'auth_complete',
      'pre_save',
    ].includes(kind)
  )
    throw new Error('scrape_save_checkpoint_boundary_invalid');
  let nextDiagnostic = safeScrapeSaveAuthDiagnostic(report.auth_diagnostic);
  if (kind === 'auth_diagnostic') {
    const projected = safeScrapeSaveAuthDiagnostic(value);
    if (Object.keys(projected).length === 0) return;
    const previousDiagnostic = safeScrapeSaveAuthDiagnostic(report.auth_diagnostic);
    const next = {
      ...(previousDiagnostic.phase === projected.phase ? previousDiagnostic : {}),
      ...projected,
    };
    if (JSON.stringify(next) === JSON.stringify(report.auth_diagnostic)) return;
    nextDiagnostic = next;
  }
  const label =
    kind === 'auth_diagnostic'
      ? [nextDiagnostic.phase, nextDiagnostic.target].filter(Boolean).join(':')
      : ['native_stage', 'auth_stage'].includes(kind)
        ? value
        : kind;
  const key = `${kind}:${label}`;
  const prior = report.diagnostic_progress ?? { sequence: 0, boundaries: [] };
  const previous = prior.boundaries.find((entry) => entry.key === key);
  if (previous && prior.latest?.key === key && kind !== 'auth_diagnostic') return;
  const at = new Date().toISOString();
  const latest = { key, kind, label, at, sequence: prior.sequence + 1 };
  const nextProgress = {
    sequence: latest.sequence,
    latest,
    boundaries: [
      ...prior.boundaries.filter((entry) => entry.key !== key),
      {
        ...latest,
        first_at: previous?.first_at ?? at,
      },
    ],
  };
  publishScrapeSaveReport(
    {
      schema_version: 1,
      feature_id: 'EXT-F-1007',
      auth_mode: 'member',
      artifact: safeArtifact(report.artifact),
      authentication: safeAuthentication(report.authentication),
      harness_checkout_sha: /^[a-f0-9]{40}$/.test(report.harness_checkout_sha ?? '')
        ? report.harness_checkout_sha
        : null,
      execution_run_id: /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '')
        ? process.env.GITHUB_RUN_ID
        : null,
      execution_run_attempt: /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
        ? process.env.GITHUB_RUN_ATTEMPT
        : null,
      status: 'unverified',
      resource_run_id: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(process.env.MATRX_RESOURCE_RUN_ID ?? '')
        ? process.env.MATRX_RESOURCE_RUN_ID
        : null,
      native_stage:
        kind === 'native_stage'
          ? value
          : NATIVE_STAGES.has(report.native_stage)
            ? report.native_stage
            : null,
      auth_stage:
        kind === 'auth_stage'
          ? value
          : AUTH_STAGES.has(report.auth_stage)
            ? report.auth_stage
            : null,
      auth_diagnostic: nextDiagnostic,
      diagnostic_progress: nextProgress,
    },
    outputDir,
  );
  report.diagnostic_progress = nextProgress;
  if (kind === 'native_stage') report.native_stage = value;
  if (kind === 'auth_stage') report.auth_stage = value;
  if (kind === 'auth_diagnostic') report.auth_diagnostic = nextDiagnostic;
}

export function recordScrapeMemberAuthFailure(report, error) {
  report.auth_failure = memberAuthFailureReport(error, report.auth_stage);
}

export function safeScrapeSaveFailureCode(error) {
  const candidate = String(error?.message ?? 'native_acceptance_error').split(/[:\n]/, 1)[0];
  return /^[a-z][a-z0-9_-]{1,100}$/.test(candidate) ? candidate : 'native_acceptance_error';
}

export function recordScrapeSaveFailure(report, error) {
  report.status = 'fail';
  report.failure_stage = report.stage;
  report.error_code = safeScrapeSaveFailureCode(error);
  return `SCRAPE_SAVE_NATIVE_ACCEPTANCE_FAILED ${report.stage} ${report.error_code}\n`;
}

export function writeScrapeSaveReport(report, outputDir = 'test-results') {
  publishScrapeSaveReport(report, outputDir);
}
