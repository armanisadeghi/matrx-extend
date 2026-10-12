import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeHostedResourceJournal } from './copy-hosted-resource-journal.mjs';
import { cpuBusyFraction } from './stabilization-resource-safety.mjs';

// SEO run 38198573143 refused before browser admission with a duplicate detail.
// Losing it prevents the official copier from preserving the terminal refusal.
const runId = 'hosted-browser-38198573143-1';
const opened = {
  schema: 1,
  at: '2026-10-12T03:12:30.846Z',
  runId,
  code: 'RESOURCE_JOURNAL_OPENED',
};
const measurement = {
  schema: 1,
  at: '2026-10-12T03:13:38.285Z',
  runId,
  code: 'RESOURCE_MEASUREMENT_INVALID:cpu-busy',
};
const final = {
  schema: 1,
  at: '2026-10-12T03:13:38.328Z',
  runId,
  admitted: false,
  resourceInvalid: false,
  exitCode: 2,
  decision: 'refused',
  code: 'RESOURCE_FINAL_DECISION',
};
const source = (...events) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

test('copies the captured measurement refusal without changing its terminal verdict', () => {
  const journal = source(opened, { ...measurement, detail: measurement.code }, final);
  assert.equal(sanitizeHostedResourceJournal(journal, runId), source(opened, measurement, final));
});

test('copies CPU shape refusals from the real sampler without changing their terminal verdict', async () => {
  const header = 'cpu load average\nus sy id 1m 5m 15m';
  const row = '12 7 80 2.61 2.60 2.84';
  for (const [raw, code] of [
    ['private-header-probe', 'RESOURCE_MEASUREMENT_INVALID:cpu-busy:header'],
    [`${header}\n${row}`, 'RESOURCE_MEASUREMENT_INVALID:cpu-busy:sample-count'],
    [`${header}\n${row}\nprivate-row-probe`, 'RESOURCE_MEASUREMENT_INVALID:cpu-busy:row-format'],
  ]) {
    // Drive the producer so a reason lost at the journal boundary fails here.
    await assert.rejects(
      cpuBusyFraction(async () => raw),
      { message: code },
    );
    const journal = source(opened, { ...measurement, code }, final);
    assert.equal(sanitizeHostedResourceJournal(journal, runId), journal);
    assert.equal(
      sanitizeHostedResourceJournal(
        source(opened, { ...measurement, code, detail: code }, final),
        runId,
      ),
      journal,
    );
    assert.throws(
      () =>
        sanitizeHostedResourceJournal(
          source(opened, { ...measurement, code, detail: raw }, final),
          runId,
        ),
      { message: 'JOURNAL_EVENT_VALUE_UNSUPPORTED' },
    );
    assert.throws(
      () =>
        sanitizeHostedResourceJournal(
          source(opened, { ...measurement, code, stdout: raw }, final),
          runId,
        ),
      { message: 'JOURNAL_EVENT_FIELD_UNSUPPORTED' },
    );
  }
});

test('copies only the finite guard-owned measurement failure codes', () => {
  for (const name of [
    'cpu-busy',
    'cpu-idle',
    'cpu-or-memory',
    'available-memory',
    'load',
    'swap',
    'logical-cpus',
    'pressure',
    'physical-memory',
    'repo-disk',
    'profile-disk',
    'safety-disk',
    'system-disk',
  ]) {
    const journal = source(
      opened,
      { ...measurement, code: `RESOURCE_MEASUREMENT_INVALID:${name}` },
      final,
    );
    assert.equal(sanitizeHostedResourceJournal(journal, runId), journal);
    const detailed = source(
      opened,
      {
        ...measurement,
        code: `RESOURCE_MEASUREMENT_INVALID:${name}`,
        detail: `RESOURCE_MEASUREMENT_INVALID:${name}`,
      },
      final,
    );
    assert.equal(sanitizeHostedResourceJournal(detailed, runId), journal);
  }
  const journal = source(opened, { ...measurement, code: 'RESOURCE_MEASUREMENT_FAILED' }, final);
  assert.equal(sanitizeHostedResourceJournal(journal, runId), journal);
  assert.equal(
    sanitizeHostedResourceJournal(
      source(
        opened,
        {
          ...measurement,
          code: 'RESOURCE_MEASUREMENT_FAILED',
          detail: 'RESOURCE_MEASUREMENT_FAILED',
        },
        final,
      ),
      runId,
    ),
    journal,
  );
});

test('refuses unknown measurement codes instead of treating the prefix as permission', () => {
  for (const code of [
    'RESOURCE_MEASUREMENT_INVALID:private-path',
    'RESOURCE_MEASUREMENT_FAILED:private-path',
    'RESOURCE_MEASUREMENT_INVALID:cpu-busy:private-path',
    'RESOURCE_MEASUREMENT_INVALID:cpu-busy:header:private-path',
  ])
    assert.throws(
      () => sanitizeHostedResourceJournal(source(opened, { ...measurement, code }, final), runId),
      /JOURNAL_EVENT_UNSUPPORTED/,
    );
});

test('refuses arbitrary measurement detail before copying any diagnostic payload', () => {
  for (const detail of [
    '/private/measurement',
    '',
    null,
    1,
    'RESOURCE_MEASUREMENT_INVALID:cpu-idle',
  ])
    assert.throws(
      () => sanitizeHostedResourceJournal(source(opened, { ...measurement, detail }, final), runId),
      /JOURNAL_EVENT_VALUE_UNSUPPORTED/,
    );
});

test('refuses extra measurement fields before copying any diagnostic payload', () => {
  for (const extra of [{ sample: {} }, { token: 'never-copy' }])
    assert.throws(
      () =>
        sanitizeHostedResourceJournal(source(opened, { ...measurement, ...extra }, final), runId),
      /JOURNAL_EVENT_FIELD_UNSUPPORTED/,
    );
});

test('a measurement failure still requires one truthful terminal refusal', () => {
  assert.throws(
    () => sanitizeHostedResourceJournal(source(opened, measurement), runId),
    /JOURNAL_FINAL_DECISION_MISSING/,
  );
  assert.throws(
    () =>
      sanitizeHostedResourceJournal(source(opened, measurement, { ...final, exitCode: 0 }), runId),
    /JOURNAL_FINAL_DECISION_INVALID/,
  );
});
