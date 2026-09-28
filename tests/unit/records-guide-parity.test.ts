/**
 * Census guard: the browser's guide artifact must remain a byte-for-byte
 * projection of aidream's `guide_for` for every supported records action.
 * Removing an action, worked example, caution, or argument description makes
 * the generator's --check mode fail.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '..', '..');

it('keeps every records guide topic identical to aidream guide_for', () => {
  const output = execFileSync('pnpm', ['catalog:records-guide', '--check'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  expect(output).toContain('records guide matches aidream guide_for for every action');
});

it('fails when a worked example is removed from the browser artifact', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'records-guide-parity-'));
  const artifact = join(temporaryDirectory, 'records-guide.json');

  try {
    const source = readFileSync(
      resolve(REPO, 'src/lib/tools/generated/records-guide.json'),
      'utf8',
    );
    writeFileSync(artifact, source.replace('A PUBLIC FORM, whole, in ONE call.', ''));

    const result = spawnSync('pnpm', ['catalog:records-guide', '--check', '--output', artifact], {
      cwd: REPO,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('records guide artifact differs from aidream guide_for');
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});
