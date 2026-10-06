import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Hosted runners skip the checkout install. Read the exact browser-driver
// dependency from the checked-in lock instead of maintaining a second version.
export async function lockedHostedTypeScript(repo) {
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const lock = await readFile(join(repo, 'pnpm-lock.yaml'), 'utf8');
  const match =
    /^ {6}typescript:\n {8}specifier: (npm:@typescript\/typescript6@[^\n]+)\n {8}version: '(@typescript\/typescript6@[0-9]+\.[0-9]+\.[0-9]+)'$/m.exec(
      lock,
    );
  assert.ok(match, 'hosted_typescript_lock_missing');
  assert.equal(match[1], manifest.devDependencies.typescript, 'hosted_typescript_lock_drift');
  return `typescript@npm:${match[2]}`;
}
