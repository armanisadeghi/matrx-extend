#!/usr/bin/env node
/** Mint a private, single-use first-party sign-in URL for an existing nonadmin reviewer. */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const IDENTITY_FILE = process.env.MATRX_REVIEWER_IDENTITY_FILE;
const ADMIN_ENV_FILE = process.env.MATRX_ADMIN_ENV_FILE;
const LINK_FILE = process.env.MATRX_REVIEWER_MAGIC_LINK_FILE;
const ORGANIZATION_CONFIG_FILE =
  process.env.MATRX_REVIEWER_ORGANIZATION_CONFIG_FILE ??
  'test-results/files-saved-private-config.json';
const PROJECT_REF = 'brsgrqvjdzwihsvnfqkf';
const REVIEWER_FINGERPRINT = '3d6137db6c081c07';
const WEB_ORIGIN = 'https://www.aimatrx.com';
let stage = 'input';

function valueFromEnv(source, key) {
  const line = source.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) throw new Error(`missing_${key.toLowerCase()}`);
  const value = line
    .slice(key.length + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!value) throw new Error(`empty_${key.toLowerCase()}`);
  return value;
}

async function privateJson(path) {
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) throw new Error('identity_file_not_private');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  if (!IDENTITY_FILE || !ADMIN_ENV_FILE || !LINK_FILE)
    throw new Error('identity_admin_env_and_link_paths_required');
  const identity = await privateJson(IDENTITY_FILE);
  stage = 'identity';
  if (
    typeof identity.id !== 'string' ||
    typeof identity.email !== 'string' ||
    identity.project_ref !== PROJECT_REF ||
    identity.fingerprint !== REVIEWER_FINGERPRINT ||
    identity.fingerprint !==
      createHash('sha256').update(identity.email.toLowerCase()).digest('hex').slice(0, 16)
  )
    throw new Error('reviewer_identity_unverified');

  const env = await readFile(ADMIN_ENV_FILE, 'utf8');
  const url = valueFromEnv(env, 'SUPABASE_MATRIX_URL');
  if (new URL(url).origin !== 'https://db.matrxserver.com')
    throw new Error('auth_project_unverified');
  const key = valueFromEnv(env, 'SUPABASE_MATRIX_SECRET_KEY');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  stage = 'auth_user';
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(identity.id);
  const user = userData?.user;
  if (
    userError ||
    !user ||
    user.email?.toLowerCase() !== identity.email.toLowerCase() ||
    !user.email_confirmed_at ||
    user.banned_until
  )
    throw new Error('existing_reviewer_auth_identity_unverified');
  const { count, error: roleError } = await admin
    .schema('admin')
    .from('admins')
    .select('user_id', { head: true, count: 'exact' })
    .eq('user_id', identity.id);
  stage = 'admin_role';
  if (roleError || count !== 0) throw new Error('reviewer_nonadmin_role_unverified');
  stage = 'approved_organization';
  const approval = await privateJson(ORGANIZATION_CONFIG_FILE);
  if (
    approval.reviewer_email_fingerprint !== REVIEWER_FINGERPRINT ||
    typeof approval.approved_organization_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      approval.approved_organization_id,
    )
  )
    throw new Error('reviewer_approved_organization_unverified');
  const organizationId = approval.approved_organization_id;
  const { data: organization, error: organizationError } = await admin
    .schema('iam')
    .from('organizations')
    .select('id, archived_at, settings')
    .eq('id', organizationId)
    .single();
  if (
    organizationError ||
    organization?.id !== organizationId ||
    organization.archived_at !== null ||
    organization.settings?.test_fixture !== true
  )
    throw new Error('reviewer_test_organization_unverified');
  // A historical membership in an archived organization may still be active.
  // Bind the live membership to the explicitly approved fixture, not a count
  // of every organization the reviewer has ever joined or a stale pinned id.
  const { data: memberships, error: membershipError } = await admin
    .schema('iam')
    .from('memberships')
    .select('container_id, role')
    .eq('user_id', identity.id)
    .eq('container_type', 'organization')
    .eq('container_id', organizationId)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (
    membershipError ||
    memberships?.length !== 1 ||
    memberships[0].container_id !== organizationId ||
    memberships[0].role !== 'member'
  )
    throw new Error('reviewer_organization_membership_unverified');
  if (process.env.MATRX_REVIEWER_DRY_RUN === '1') {
    process.stdout.write('READY existing_reviewer_nonadmin_authority\n');
    return;
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: identity.email,
  });
  stage = 'magic_link';
  if (error || !data?.properties?.hashed_token || data.user?.id !== identity.id)
    throw new Error('existing_reviewer_magic_link_generation_failed');
  const link = new URL('/auth/confirm', WEB_ORIGIN);
  link.searchParams.set('token_hash', data.properties.hashed_token);
  link.searchParams.set('type', 'magiclink');
  link.searchParams.set('redirectTo', '/dashboard');
  await writeFile(
    LINK_FILE,
    `${JSON.stringify({ email: identity.email, action_link: link.href, organization_id: organizationId })}\n`,
    {
      mode: 0o600,
      flag: 'wx',
    },
  );
  process.stdout.write('READY reviewer_magic_link_private_file\n');
}

try {
  await main();
} catch {
  process.stderr.write(`UNVERIFIED reviewer_magic_link_preparation stage=${stage}\n`);
  process.exitCode = 1;
}
