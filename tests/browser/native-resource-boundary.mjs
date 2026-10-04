import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resourceLeaseRoot } from '../../scripts/stabilization-resource-lease.mjs';

const RUN_ID = /^[A-Za-z0-9_.-]+$/;

function refuse(reason) {
  throw new Error(`NATIVE_RESOURCE_BOUNDARY_REFUSED:${reason}`);
}

async function optionalStat(path) {
  try {
    return await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    refuse('state_unreadable');
  }
}

// Read the guard's own pending journal at the point of a native UI batch. The
// guard alone samples resources and owns the sustained-stop policy.
export async function requireNativeResourceHealth({
  repo,
  env = process.env,
  leaseRoot = resourceLeaseRoot(),
  clock = Date.now,
  readEvidence = readFile,
} = {}) {
  const runId = env.MATRX_RESOURCE_RUN_ID;
  const stopFile = env.MATRX_RESOURCE_STOP_FILE;
  if (!runId || !RUN_ID.test(runId) || !env.MATRX_RESOURCE_OWNER || !stopFile)
    refuse('identity_missing');
  if (await optionalStat(stopFile)) refuse('stop_requested');
  if (await optionalStat(join(leaseRoot, 'unsafe-hold.json'))) refuse('unsafe_hold');
  let owner;
  let policy;
  let journal;
  try {
    owner = JSON.parse(await readEvidence(join(leaseRoot, 'heavy', 'owner.json'), 'utf8'));
    policy = JSON.parse(
      await readEvidence(join(repo, 'docs/stabilization/resource-policy.json'), 'utf8'),
    );
    journal = await readEvidence(
      join(repo, 'docs/stabilization/resource-journals', `${runId}.pending.jsonl`),
      'utf8',
    );
  } catch {
    refuse('evidence_missing');
  }
  if (
    owner.runId !== runId ||
    owner.nonce !== env.MATRX_RESOURCE_OWNER ||
    owner.kind !== 'run' ||
    stopFile !== join(leaseRoot, `stop-${owner.nonce}.json`)
  )
    refuse('wrong_run');
  const maxAgeMs = policy.watchIntervalSeconds * 1000;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) refuse('policy_invalid');
  if (!journal.endsWith('\n')) refuse('journal_incomplete');
  let events;
  try {
    events = journal
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    refuse('journal_invalid');
  }
  const admissionIndex = events.findIndex((event) => event.code === 'RESOURCE_ADMITTED');
  if (
    !events.length ||
    events.some(
      (event, index) =>
        event.schema !== 1 ||
        (event.runId !== runId &&
          !(
            event.runId === undefined &&
            event.code === 'RESOURCE_RECOVERY_SAMPLES_READY' &&
            typeof event.previousRunId === 'string' &&
            index < admissionIndex
          )),
    )
  )
    refuse('wrong_run');
  if (events.some((event) => event.code === 'RESOURCE_WATCH_UNSAFE')) refuse('unsafe_sample');
  if (
    events.some((event) =>
      [
        'RESOURCE_STOP_REQUESTED',
        'RESOURCE_STOP_AT_SAFE_BOUNDARY',
        'RESOURCE_GROUP_STOP_REQUESTED',
        'RESOURCE_JOB_EXIT',
        'RESOURCE_JOURNAL_WRITE_FAILED',
        'RESOURCE_SAFETY_STATE_WRITE_FAILED',
        'RESOURCE_FINAL_DECISION',
      ].includes(event.code),
    )
  )
    refuse('run_stopped');
  const admitted = events.find(
    (event) =>
      event.code === 'RESOURCE_ADMITTED' &&
      event.sample &&
      Array.isArray(event.reasons) &&
      event.reasons.length === 0,
  );
  if (!admitted) refuse('admission_missing');
  const latest = [...events]
    .reverse()
    .find((event) => event.code === 'RESOURCE_WATCH_HEALTHY' || event.code === 'RESOURCE_ADMITTED');
  if (
    !latest ||
    !latest.sample ||
    !Array.isArray(latest.reasons) ||
    latest.reasons.length ||
    !Number.isFinite(Date.parse(latest.at))
  )
    refuse('health_missing');
  const ageMs = clock() - Date.parse(latest.at);
  if (ageMs < 0 || ageMs > maxAgeMs) refuse('stale_health');
  return { runId, event: latest.code, at: latest.at, ageMs };
}

export async function runNativeResourceAction(requireHealth, action) {
  await requireHealth();
  return action();
}
