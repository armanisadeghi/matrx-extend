import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('./prepare-reviewer-magic-link.mjs', import.meta.url),
  'utf8',
);
const fingerprint = createHash('sha256').update('reviewer@example.com').digest('hex').slice(0, 16);
const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '10000000-0000-4000-8000-000000000002';

// Execute the real mint orchestration; only filesystem/SDK boundaries and the
// private identity fingerprint constant are replaced with sanitized fixtures.
async function run(overrides = {}) {
  const org = overrides.org ?? orgA;
  const identity = {
    id: 'reviewer-id',
    email: 'reviewer@example.com',
    project_ref: 'brsgrqvjdzwihsvnfqkf',
    fingerprint,
    ...overrides.identity,
  };
  const approval = {
    approved_organization_id: org,
    reviewer_email_fingerprint: fingerprint,
    ...overrides.approval,
  };
  const rows = {
    admins: [],
    memberships: [
      {
        container_id: orgB,
        user_id: identity.id,
        container_type: 'organization',
        status: 'active',
        deleted_at: null,
        role: 'owner',
      },
      {
        container_id: org,
        user_id: identity.id,
        container_type: 'organization',
        status: 'active',
        deleted_at: null,
        role: 'member',
        ...overrides.membership,
      },
    ],
    organizations: [
      {
        id: org,
        name: 'Approved fixture',
        archived_at: null,
        settings: { test_fixture: true },
        ...overrides.organization,
      },
    ],
  };
  if (overrides.duplicate) rows.memberships.push({ ...rows.memberships[1] });
  const written = [];
  const calls = [];
  const admin = {
    schema: (schema) => ({
      from: (table) => {
        let selected = rows[table];
        const query = {
          select: () => query,
          eq: (key, value) => {
            selected = selected.filter((row) => row[key] === value);
            return query;
          },
          is: (key, value) => {
            selected = selected.filter((row) => row[key] === value);
            return query;
          },
          single: async () => ({
            data: selected.length === 1 ? selected[0] : null,
            error: selected.length === 1 ? null : { message: 'cardinality' },
          }),
          // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable SDK boundaries.
          then: (resolve) =>
            resolve({
              data: selected,
              count: overrides.adminCount ?? selected.length,
              error: overrides.databaseError ? { message: 'unavailable' } : null,
            }),
        };
        calls.push(`${schema}.${table}`);
        return query;
      },
    }),
    auth: {
      admin: {
        getUserById: async () => ({
          data: {
            user: {
              id: identity.id,
              email: identity.email,
              email_confirmed_at: '2026-10-17',
              ...overrides.user,
            },
          },
          error: null,
        }),
        generateLink: async () => {
          calls.push('mint');
          return {
            data: { properties: { hashed_token: 'private-test-token' }, user: { id: identity.id } },
            error: null,
          };
        },
      },
    },
  };
  const script = source
    .slice(0, source.lastIndexOf('\ntry {'))
    .replace(/^import .*;\n/gm, '')
    .replace(
      /const REVIEWER_FINGERPRINT = '[^']+';/,
      `const REVIEWER_FINGERPRINT = '${fingerprint}';`,
    );
  const context = {
    createHash,
    createClient: () => admin,
    URL,
    process: {
      env: {
        MATRX_REVIEWER_IDENTITY_FILE: 'identity',
        MATRX_ADMIN_ENV_FILE: 'env',
        MATRX_REVIEWER_MAGIC_LINK_FILE: 'link',
        MATRX_REVIEWER_ORGANIZATION_CONFIG_FILE: 'approval',
      },
      stdout: { write: () => {} },
    },
    stat: async (path) => ({
      mode: path === 'approval' && overrides.publicApproval ? 0o644 : 0o600,
    }),
    readFile: async (path) =>
      path === 'identity'
        ? JSON.stringify(identity)
        : path === 'env'
          ? `SUPABASE_MATRIX_URL=${overrides.url ?? 'https://db.matrxserver.com'}\nSUPABASE_MATRIX_SECRET_KEY=private-test-key`
          : JSON.stringify(approval),
    writeFile: async (_path, value) => written.push(JSON.parse(value)),
  };
  try {
    await runInNewContext(`${script}\nmain()`, context);
  } catch (error) {
    return { error: error.message, calls, written };
  }
  return { error: null, calls, written };
}

test('mints only for the approved active fixture despite an older archived-org membership', async () => {
  const result = await run();
  assert.equal(result.error, null);
  assert.equal(result.written[0].organization_id, orgA);
  assert.equal(result.calls.filter((call) => call === 'mint').length, 1);
});

test('follows a different approved fixture rather than a pinned organization', async () => {
  const result = await run({ org: '20000000-0000-4000-8000-000000000001' });
  assert.equal(result.error, null);
  assert.equal(result.written[0].organization_id, '20000000-0000-4000-8000-000000000001');
});

for (const [name, override] of Object.entries({
  archived: { organization: { archived_at: '2026-10-16' } },
  untagged: { organization: { settings: {} } },
  deleted: { membership: { deleted_at: '2026-10-16' } },
  inactive: { membership: { status: 'inactive' } },
  elevated_org_role: { membership: { role: 'admin' } },
  missing_archive_state: { organization: { archived_at: undefined } },
  wrong_user: { membership: { user_id: 'someone-else' } },
  wrong_org: { membership: { container_id: 'another-org' } },
  duplicate: { duplicate: true },
  wrong_approval_identity: { approval: { reviewer_email_fingerprint: 'other' } },
  invalid_approved_id: { approval: { approved_organization_id: 'not-a-uuid' } },
  public_approval: { publicApproval: true },
  admin: { adminCount: 1 },
  database_error: { databaseError: true },
  wrong_project: { identity: { project_ref: 'another-project' } },
  wrong_auth_identity: { user: { email: 'someone-else@example.com' } },
  banned: { user: { banned_until: '2027-01-01' } },
  wrong_authority: { url: 'https://example.com' },
}))
  test(`refuses ${name} before minting or writing a link`, async () => {
    const result = await run(override);
    assert.notEqual(result.error, null);
    assert.equal(result.calls.includes('mint'), false);
    assert.equal(result.written.length, 0);
  });
