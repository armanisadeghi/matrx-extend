'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const DEFAULT_LOCK = '/Users/armanisadeghi/code/common-docs/.matrx/locks/admin-vault-acceptance';

// One admin inventory is shared across browsers and repositories. Never steal
// an existing lease, including a stale one: recovery must verify its processes
// and disposable resources before explicitly retiring it.
exports.acquireVaultAcceptanceLease = async ({ runId, kind, lockPath = DEFAULT_LOCK }) => {
  if (typeof runId !== 'string' || typeof kind !== 'string')
    throw new Error('vault_lease_identity_missing');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await fs.mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('admin_vault_acceptance_lease_busy');
    throw error;
  }
  const nonce = randomUUID();
  const ownerPath = path.join(lockPath, 'owner.json');
  try {
    await fs.writeFile(
      ownerPath,
      JSON.stringify({
        schema: 1,
        pid: process.pid,
        runId,
        kind,
        nonce,
        acquiredAt: new Date().toISOString(),
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  } catch (error) {
    // An incomplete lease stays fail-closed for explicit recovery.
    throw new Error('admin_vault_acceptance_lease_owner_write_failed', { cause: error });
  }
  let released = false;
  return {
    path: lockPath,
    async release() {
      if (released) return;
      const stat = await fs.lstat(lockPath);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('vault_lease_directory_changed');
      const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
      if (owner.nonce !== nonce || owner.pid !== process.pid || owner.runId !== runId)
        throw new Error('vault_lease_owner_changed');
      await fs.unlink(ownerPath);
      await fs.rmdir(lockPath);
      released = true;
    },
  };
};
