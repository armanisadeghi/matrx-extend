'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { acquireVaultAcceptanceLease } = require('./vault-acceptance-lease.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-lease-test-'));
  const lockPath = path.join(root, 'lease');
  try {
    const first = await acquireVaultAcceptanceLease({ runId: 'first', kind: 'chrome', lockPath });
    await assert.rejects(acquireVaultAcceptanceLease({ runId: 'second', kind: 'firefox', lockPath }), /admin_vault_acceptance_lease_busy/);
    const ownerPath = path.join(lockPath, 'owner.json');
    const saved = await fs.readFile(ownerPath, 'utf8');
    await fs.writeFile(ownerPath, JSON.stringify({ ...JSON.parse(saved), nonce: 'another-owner' }));
    await assert.rejects(first.release(), /vault_lease_owner_changed/);
    assert.equal((await fs.stat(lockPath)).isDirectory(), true);
    await fs.writeFile(ownerPath, saved);
    await first.release();
    const second = await acquireVaultAcceptanceLease({ runId: 'second', kind: 'firefox', lockPath });
    await second.release();
    await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
    console.log('PASS: cross-browser exclusion, owner-bound release, and subsequent admission');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
