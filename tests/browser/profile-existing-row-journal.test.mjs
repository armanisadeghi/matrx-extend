import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createExistingProfileWriteJournal,
  PROFILE_TESTED_COLUMNS,
} from './profile-existing-row-journal.mjs';

const original = {
  user_id: 'db4a31ad-6b18-4d33-a296-593f1e7288c9',
  organization_id: 'edb9a817-d8c1-4d2c-8205-af047333fd60',
  created_at: '2026-10-03T22:52:00Z',
  version: 7,
  legal_first_name: 'Marin',
  legal_middle_name: null,
  legal_last_name: 'Vale',
  preferred_name: null,
  name_suffix: null,
  pronouns: null,
  date_of_birth: null,
  company_name: 'Harbor Studio',
  job_title: 'Design Lead',
  phones: [{ number: '+14155550123', primary: true, hidden: false }],
  billing_city: 'Berkeley',
  updated_at: '2026-10-03T22:53:00Z',
};
function setup() {
  let row = structuredClone(original);
  let beforePatch = null;
  const receipts = [];
  const patches = [];
  const persist = async (record) => receipts.push(structuredClone(record));
  const read = async () => structuredClone(row);
  const patch = async (url, fields) => {
    patches.push({ url, fields: structuredClone(fields) });
    if (beforePatch) await beforePatch();
    const query = new URL(url).searchParams;
    if (Number(query.get('version')?.slice(3)) !== row.version) return [];
    for (const key of PROFILE_TESTED_COLUMNS) {
      const filter = query.get(key);
      if (filter !== (row[key] === null ? 'is.null' : `eq.${row[key]}`)) return [];
    }
    row = { ...row, ...fields, version: row.version + 1 };
    return [{ user_id: row.user_id, version: row.version }];
  };
  return {
    async journal() {
      return createExistingProfileWriteJournal({
        original,
        baseUrl: 'https://db.example.test',
        read,
        persist,
        patch,
      });
    },
    receipts,
    patches,
    read,
    write(fields) {
      row = { ...row, ...fields, version: row.version + 1 };
    },
    beforePatch(action) {
      beforePatch = action;
    },
    mutate(fields) {
      row = { ...row, ...fields };
    },
  };
}

test('existing Profile caller captures a private baseline before editing and restores only original tested fields', async () => {
  const s = setup();
  const journal = await s.journal();
  assert.equal(s.receipts[0].original_row_absent, false);
  assert.equal(s.receipts[0].expected_version, 7);
  assert.deepEqual(
    Object.keys(s.receipts[0].original_fields).sort(),
    [...PROFILE_TESTED_COLUMNS].sort(),
  );
  await journal.save(
    'Maren',
    async () => s.write({ preferred_name: 'Maren', legal_first_name: 'Maren' }),
    { legal_first_name: 'Maren' },
  );
  assert.equal(s.receipts.at(-1).expected_version, 8);
  await journal.restore();
  assert.equal(s.patches.length, 1);
  assert.deepEqual(Object.keys(s.patches[0].fields).sort(), [...PROFILE_TESTED_COLUMNS].sort());
  const row = await s.read();
  for (const key of PROFILE_TESTED_COLUMNS) assert.deepEqual(row[key], original[key]);
  for (const key of ['user_id', 'organization_id', 'created_at', 'phones', 'billing_city'])
    assert.deepEqual(row[key], original[key]);
  assert.equal(row.version, 9);
  assert.equal(s.receipts.at(-1).pending_write, null);
});

test('existing Profile journal refuses concurrent changes and does not patch them away', async () => {
  const s = setup();
  const journal = await s.journal();
  s.write({ legal_first_name: 'Other writer' });
  await assert.rejects(journal.restore(), /profile_existing_concurrent_change/);
  assert.equal(s.patches.length, 0);
});

test('conditional restore refuses a successor that appears after journal verification', async () => {
  const s = setup();
  const journal = await s.journal();
  await journal.save('Maren', async () => s.write({ preferred_name: 'Maren' }));
  s.beforePatch(async () => s.write({ company_name: 'Another employer' }));
  await assert.rejects(journal.restore(), /profile_restore_conditional_patch_missed/);
  assert.equal((await s.read()).company_name, 'Another employer');
});

test('existing Profile journal refuses ambiguous save successors and retains pending receipt', async () => {
  const s = setup();
  const journal = await s.journal();
  await assert.rejects(
    journal.save('Maren', async () => s.write({ preferred_name: 'Someone else' })),
    /profile_existing_preferred_name_unexpected_successor/,
  );
  assert.equal(s.receipts.at(-1).pending_write.version, 8);
  await assert.rejects(journal.restore(), /profile_existing_preferred_name_unexpected_successor/);
  assert.equal(s.patches.length, 0);
});

test('existing Profile journal never writes when baseline receipt cannot persist', async () => {
  let writes = 0;
  await assert.rejects(
    createExistingProfileWriteJournal({
      original,
      baseUrl: 'https://db.example.test',
      read: async () => original,
      persist: async () => {
        throw Error('disk_failure');
      },
      patch: async () => {
        writes++;
        return [];
      },
    }),
    /disk_failure/,
  );
  assert.equal(writes, 0);
});

const source = await readFile(new URL('./profile-native-acceptance.mjs', import.meta.url), 'utf8');
test('actual native caller chooses the existing-row journal and passes it into admin field cases', async () => {
  const start = source.indexOf(
    "} else {\n            executionOperation = 'existing_profile_owner_read_before_write';",
  );
  const end = source.indexOf("executionOperation = 'warm_profile';", start);
  assert.ok(start >= 0 && end > start, 'existing_profile_runner_branch_missing');
  const branch = source.slice(start, end);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction(
    'assert',
    'profileApiConfig',
    'stored',
    'readProfileOwnerRow',
    'panel',
    'identity',
    'original',
    'createExistingProfileWriteJournal',
    'persistPrivateOwnership',
    'profileOwnerRequest',
    'RUN_ID',
    `let executionOperation; let ownerConfig; let existingJournal = null; let cleanupPanel = panel; let ownedJournal = null; if (false) { ${branch} return existingJournal;`,
  );
  const s = setup();
  const saved = [];
  const journal = await run(
    assert,
    async () => ({ url: 'https://db.example.test' }),
    { organizationId: original.organization_id },
    async () => s.read(),
    {},
    { userId: original.user_id },
    '',
    createExistingProfileWriteJournal,
    async (record, create) => saved.push({ record, create }),
    async (_panel, _config, url, _method, fields) => {
      const query = new URL(url).searchParams;
      assert.equal(query.get('organization_id'), `eq.${original.organization_id}`);
      assert.deepEqual(Object.keys(fields).sort(), [...PROFILE_TESTED_COLUMNS].sort());
      return [{ user_id: original.user_id }];
    },
    'test-run',
  );
  assert.equal(saved[0].create, true);
  assert.equal(saved[0].record.original_row_absent, false);
  assert.ok(journal.save && journal.restore);
  const extended = source.slice(
    source.indexOf('async function runExtendedCases('),
    source.indexOf('async function caseT25('),
  );
  assert.match(extended, /runProfileFieldCase\([\s\S]*ownedJournal/);
  assert.match(source, /'warm',\s*ownedJournal \?\? existingJournal,\s*heldFieldCases/);
  assert.match(source, /'extension_reload',\s*ownedJournal \?\? existingJournal/);
});

test('actual native cleanup restores the existing row after a case failure without delete authority', async () => {
  const start = source.indexOf('} else if (existingJournal) {');
  const end = source.indexOf('} else if (!pendingMarker', start);
  assert.ok(start >= 0 && end > start, 'existing_profile_cleanup_branch_missing');
  const branch = source.slice(start, end);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction(
    'existingJournal',
    `const report = {}; let deleted = false; let pendingMarker = null; let initialRow = {row_present:true}; if (false) { ${branch} } return {report,deleted};`,
  );
  let restored = 0;
  const result = await run({
    async restore() {
      restored++;
    },
  });
  assert.equal(restored, 1);
  assert.deepEqual(result.report.restoration, {
    verified: true,
    original_tested_fields_restored: true,
    original_row_preserved: true,
  });
  assert.equal(result.deleted, false);
});

test('empty UI Preferred maps to stored null while the original baseline remains exact', async () => {
  const s = setup();
  const journal = await s.journal();
  await journal.save('Maren', async () => s.write({ preferred_name: 'Maren' }));
  await journal.save('', async () => s.write({ preferred_name: null }));
  await journal.restore();
  assert.equal((await s.read()).preferred_name, null);
  assert.equal(s.patches.length, 0);
});
