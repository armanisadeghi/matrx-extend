import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { reloadExecutionRetired } from './reload-lifetime-diagnostic.mjs';

// User case: reloading Matrx Extend after Scrape media capture in native Chrome.
// Real captured protocol sequence; alterations below model named unsafe outcomes.
const captured = JSON.parse(
  await readFile(new URL('./fixtures/reload-stopped-redundant.json', import.meta.url)),
);
function evidence() {
  return {
    availability: 'ready',
    old_version_mapping: 'correlated',
    old_version_id: '0',
    pre_click_version_count: 1,
    version_events_dropped: 0,
    versions: structuredClone(captured.versions),
  };
}
const verdict = (value) =>
  reloadExecutionRetired(value, captured.old_target_id, captured.replacement_target_id);

test('captured stopped/redundant execution retires even without debugger-host destruction', () => {
  assert.equal(verdict(evidence()), true);
});

for (const [name, corrupt] of [
  [
    'old worker is only stopping',
    (e) => {
      e.versions.findLast((v) => v.version_id === '0').running_status = 'stopping';
    },
  ],
  [
    'stopped old version remains restartable',
    (e) => {
      e.versions.findLast((v) => v.version_id === '0').status = 'activated';
    },
  ],
  [
    'old version later reports running',
    (e) => {
      e.versions.push({ ...e.versions[0] });
    },
  ],
  [
    'old identity never measured before click',
    (e) => {
      e.pre_click_version_count = 0;
    },
  ],
  [
    'only pre-click retirement evidence',
    (e) => {
      e.pre_click_version_count = e.versions.length;
    },
  ],
  [
    'ambiguous old target mapping',
    (e) => {
      e.versions.splice(0, 0, { ...e.versions[0], version_id: '2' });
      e.pre_click_version_count++;
    },
  ],
  [
    'old registration changes',
    (e) => {
      e.versions.findLast((v) => v.version_id === '0').registration_id = '2';
    },
  ],
  [
    'old target changes',
    (e) => {
      e.versions.findLast((v) => v.version_id === '0').target_id = captured.replacement_target_id;
    },
  ],
  [
    'replacement is only installing',
    (e) => {
      e.versions.at(-1).status = 'installing';
    },
  ],
  [
    'replacement is stopped',
    (e) => {
      e.versions.at(-1).running_status = 'stopped';
    },
  ],
  [
    'wrong replacement target',
    (e) => {
      e.versions.at(-1).target_id = captured.old_target_id;
    },
  ],
  [
    'replacement identity changes',
    (e) => {
      e.versions.find((v) => v.version_id === '1').registration_id = '2';
    },
  ],
  [
    'ambiguous replacement mapping',
    (e) => {
      e.versions.push({ ...e.versions.at(-1), version_id: '2' });
    },
  ],
  [
    'replacement existed before click',
    (e) => {
      e.versions.splice(0, 0, { ...e.versions.at(-1) });
      e.pre_click_version_count++;
    },
  ],
  [
    'dropped protocol evidence',
    (e) => {
      e.version_events_dropped = 1;
    },
  ],
  [
    'unavailable protocol domain',
    (e) => {
      e.availability = 'unavailable';
    },
  ],
])
  test(`execution proof refuses ${name}`, () => {
    const e = evidence();
    corrupt(e);
    assert.equal(verdict(e), false);
  });
