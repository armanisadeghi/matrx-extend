import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assertFirstSaveIdentity } from './profile-empty-row-restoration.mjs';
import { safeProfileFailureCode } from './profile-native-failure.mjs';

const source = await readFile(new URL('./profile-native-acceptance.mjs', import.meta.url), 'utf8');
const start = source.indexOf('if (!initialRow.row_present) {');
const end = source.indexOf('ownerConfig =', start);
assert.ok(start >= 0 && end > start, 'first_save_runner_gate_missing');
const gate = source.slice(start, end);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const userId = 'db4a31ad-6b18-4d33-a296-593f1e7288c9';
const organizationId = 'edb9a817-d8c1-4d2c-8205-af047333fd60';
const input = {
  identity: { userId, email: 'admin@admin.com' },
  stored: {
    profileId: userId,
    isAdmin: true,
    accessTokenPresent: true,
    organizationId,
    organizationName: 'Matrx Org',
  },
  selectedOrg: 'Matrx Org',
  memberAuthentication: null,
};

async function run(mode, overrides = {}) {
  const values = { ...input, ...overrides };
  const execute = new AsyncFunction(
    'assert',
    'assertFirstSaveIdentity',
    'AUTH_MODE',
    'identity',
    'stored',
    'selectedOrg',
    'memberAuthentication',
    `const initialRow = { row_present: false }; const report = { member_authentication: memberAuthentication }; ${gate} } return true;`,
  );
  return execute(assert, assertFirstSaveIdentity, mode, ...Object.values(values));
}

test('actual first-save gate admits verified designated admin and member identities', async () => {
  assert.equal(await run('admin'), true);
  assert.equal(
    await run('member', {
      identity: { userId, email: 'designated-member@example.test' },
      stored: { ...input.stored, isAdmin: false },
      selectedOrg: true,
      memberAuthentication: {
        first_party_identity_verified: true,
        canonical_nonadmin_check: { returned_rows: 0 },
      },
    }),
    true,
  );
});

test('actual first-save gate refuses unverified or mismatched admin identity, role, and device organization', async () => {
  for (const [code, overrides] of [
    [
      'first_save_designated_admin_unverified',
      { identity: { userId, email: 'other@example.test' } },
    ],
    [
      'first_save_identity_mismatch',
      { stored: { ...input.stored, profileId: '45ca31d1-20c0-427a-965d-c891ae334c94' } },
    ],
    ['first_save_role_mismatch', { stored: { ...input.stored, isAdmin: false } }],
    ['first_save_token_missing', { stored: { ...input.stored, accessTokenPresent: false } }],
    [
      'first_save_organization_mismatch',
      { stored: { ...input.stored, organizationName: 'Different Org' } },
    ],
    [
      'first_save_device_organization_unverified',
      { stored: { ...input.stored, organizationId: null } },
    ],
  ]) {
    await assert.rejects(run('admin', overrides), (error) => {
      assert.equal(safeProfileFailureCode(error), code);
      return true;
    });
  }
});

test('member first-save still requires the helper proof and canonical nonadmin result', async () => {
  const member = {
    identity: { userId, email: 'designated-member@example.test' },
    stored: { ...input.stored, isAdmin: false },
    selectedOrg: true,
    memberAuthentication: {
      first_party_identity_verified: true,
      canonical_nonadmin_check: { returned_rows: 0 },
    },
  };
  for (const [code, overrides] of [
    [
      'first_save_member_unverified',
      {
        memberAuthentication: {
          ...member.memberAuthentication,
          first_party_identity_verified: false,
        },
      },
    ],
    [
      'first_save_member_role_unverified',
      {
        memberAuthentication: {
          ...member.memberAuthentication,
          canonical_nonadmin_check: { returned_rows: 1 },
        },
      },
    ],
    ['first_save_organization_mismatch', { selectedOrg: false }],
  ]) {
    await assert.rejects(run('member', { ...member, ...overrides }), (error) => {
      assert.equal(safeProfileFailureCode(error), code);
      return true;
    });
  }
});
