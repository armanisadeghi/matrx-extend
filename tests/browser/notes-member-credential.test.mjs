import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readMemberCredential } from './notes-member-credential.mjs';

const email = 'notes-reviewer@test.test';
const password = 'synthetic-private-input-only';
const fingerprint = createHash('sha256').update(email).digest('hex').slice(0, 16);

async function withFixture(contents, mode, run) {
  const root = await mkdtemp(join(tmpdir(), 'notes-member-credential-'));
  const path = join(root, 'credential.json');
  try {
    await writeFile(path, contents, { mode });
    await run(path, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('accepts only an owned 0600 regular credential with the expected reviewer identity', async () => {
  await withFixture(JSON.stringify({ email, password }), 0o600, async (path) => {
    assert.deepEqual(await readMemberCredential(path, fingerprint), {
      email,
      password,
      fingerprint,
    });
    await assert.rejects(readMemberCredential(path, '0000000000000000'), {
      code: 'member_credential_identity_mismatch',
    });
  });
});

test('refuses broad permissions and symlinks before reading credential bytes', async () => {
  await withFixture(JSON.stringify({ email, password }), 0o644, async (path, root) => {
    await assert.rejects(readMemberCredential(path, fingerprint), {
      code: 'member_credential_not_private',
    });
    const link = join(root, 'credential-link.json');
    await symlink(path, link);
    await assert.rejects(readMemberCredential(link, fingerprint), {
      code: 'member_credential_unavailable',
    });
  });
});

test('rejects malformed or expanded credentials without revealing the input', async () => {
  for (const contents of [
    '{',
    JSON.stringify({ email, password: '' }),
    JSON.stringify({ email, password, access_token: 'synthetic-only' }),
    JSON.stringify({ email: 'not-an-email', password }),
  ]) {
    await withFixture(contents, 0o600, async (path) => {
      await assert.rejects(readMemberCredential(path, fingerprint), (error) => {
        assert.equal(error.code, 'member_credential_invalid');
        assert.equal(error.message, 'member_credential_invalid');
        assert.equal(error.stack.includes(password), false);
        return true;
      });
    });
  }
});

test('refuses missing path and fingerprint with fixed diagnostics', async () => {
  await assert.rejects(readMemberCredential(undefined, fingerprint), {
    code: 'member_credential_path_required',
  });
  await assert.rejects(readMemberCredential('/path/never-read', 'bad'), {
    code: 'member_identity_fingerprint_missing',
  });
});
