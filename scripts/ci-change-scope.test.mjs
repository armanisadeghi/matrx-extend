import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  changedPaths,
  classifyChangedPaths,
  classifyProvenChange,
  latestSuccessfulDevelopmentArtifactSource,
} from './ci-change-scope.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function commit(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  git(root, 'add', path);
  git(root, 'commit', '-qm', path);
  return git(root, 'rev-parse', 'HEAD');
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'ci@example.invalid');
    git(root, 'config', 'user.name', 'CI fixture');
    const base = commit(root, 'docs/stabilization/README.md', 'base');
    fn(root, base);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('stabilization report only takes docs validation', () =>
  fixture((root, base) => {
    const head = commit(root, 'docs/stabilization/reports/run.json', '{}');
    assert.equal(classifyChangedPaths(changedPaths(root, base, head)), 'docs');
  }));

for (const path of [
  'src/panel.ts',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'package.json',
  'docs/stabilization/resource-policy.json',
  'docs/stabilization/evidence/driver.mjs',
  'unknown.txt',
]) {
  test(`changed ${path} requires full verification`, () =>
    fixture((root, base) => {
      commit(root, 'docs/stabilization/reports/run.json', '{}');
      const head = commit(root, path, 'changed');
      assert.equal(classifyChangedPaths(changedPaths(root, base, head)), 'full');
    }));
}

test('missing, unrelated, or zero base requires full verification', () =>
  fixture((root, base) => {
    const head = commit(root, 'docs/stabilization/reports/run.json', '{}');
    assert.equal(classifyChangedPaths(changedPaths(root, '0'.repeat(40), head)), 'full');
    assert.equal(classifyChangedPaths(changedPaths(root, 'a'.repeat(40), head)), 'full');
    assert.equal(classifyChangedPaths(changedPaths(root, head, base)), 'full');
  }));

test('runtime changed and reverted within comparison history still requires full verification', () =>
  fixture((root, base) => {
    commit(root, 'src/panel.ts', 'changed');
    commit(root, 'src/panel.ts', 'original');
    const head = commit(root, 'docs/stabilization/reports/run.json', '{}');
    assert.equal(classifyChangedPaths(changedPaths(root, base, head)), 'full');
  }));

test('cancelled runtime CI followed by docs-only tip still requires full verification', () =>
  fixture((root, artifactSource) => {
    const unverifiedRuntime = commit(root, 'src/panel.ts', 'runtime');
    const docsTip = commit(root, 'docs/stabilization/reports/run.json', '{}');
    assert.equal(classifyChangedPaths(changedPaths(root, unverifiedRuntime, docsTip)), 'docs');
    assert.equal(classifyProvenChange(root, unverifiedRuntime, docsTip, artifactSource), 'full');
    assert.equal(classifyProvenChange(root, unverifiedRuntime, docsTip, null), 'full');
  }));

test('successfully built ancestor covers a chain of documentation commits', () =>
  fixture((root, artifactSource) => {
    const firstDocs = commit(root, 'docs/stabilization/reports/first.json', '{}');
    const docsTip = commit(root, 'docs/stabilization/reports/second.json', '{}');
    assert.equal(classifyProvenChange(root, firstDocs, docsTip, artifactSource), 'docs');
  }));

test('cancelled or unavailable CI artifact proof fails closed', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  const originalRepository = process.env.GITHUB_REPOSITORY;
  const sha = 'a'.repeat(40);
  process.env.GITHUB_TOKEN = 'fixture';
  process.env.GITHUB_REPOSITORY = 'example/extension';
  try {
    for (const conclusion of ['cancelled', 'success']) {
      globalThis.fetch = async (url) =>
        Response.json(
          String(url).includes('/actions/artifacts?')
            ? {
                artifacts: [
                  {
                    name: `matrx-extend-development-test-${sha}-123-1`,
                    expired: false,
                    size_in_bytes: 42,
                    workflow_run: { id: 123, head_sha: sha },
                  },
                ],
              }
            : {
                conclusion,
                name: 'CI',
                event: 'push',
                head_branch: 'main',
                head_sha: sha,
                run_attempt: 1,
              },
        );
      assert.equal(
        await latestSuccessfulDevelopmentArtifactSource(),
        conclusion === 'success' ? sha : null,
      );
    }
    globalThis.fetch = async () => new Response('', { status: 403 });
    assert.equal(await latestSuccessfulDevelopmentArtifactSource(), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = originalRepository;
  }
});

test('workflow gates full jobs and development artifact behind the scope decision', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const docs = workflow.split('  docs:\n')[1]?.split('  resource-guard-integration:\n')[0];
  const mac = workflow.split('  resource-guard-integration:\n')[1]?.split('  checks:\n')[0];
  const checks = workflow.split('  checks:\n')[1];
  assert.match(workflow, /CI_EVENT_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(docs, /if: needs\.scope\.outputs\.kind == 'docs'/);
  assert.match(docs, /pnpm lint --diagnostic-level=error/);
  assert.match(docs, /ci-docs-validation\.mjs/);
  assert.match(docs, /test_stabilization_release_truth\.py/);
  assert.doesNotMatch(docs, /upload-artifact|wxt build|current-test-artifact\.mjs produce/);
  assert.match(mac, /if: always\(\) && needs\.scope\.outputs\.kind != 'docs'/);
  assert.match(checks, /if: always\(\) && needs\.scope\.outputs\.kind != 'docs'/);
  assert.match(checks, /pnpm compile/);
  assert.match(checks, /pnpm test/);
  assert.match(checks, /pnpm wxt build/);
  assert.match(checks, /current-test-artifact\.mjs produce/);
  assert.match(checks, /upload-artifact@v4/);
});

test('documentation validator rejects malformed changed JSON', () =>
  fixture((root, base) => {
    const head = commit(root, 'docs/stabilization/reports/run.json', '{invalid');
    const result = spawnSync(
      'node',
      [new URL('./ci-docs-validation.mjs', import.meta.url).pathname],
      {
        cwd: root,
        env: { ...process.env, CI_BASE_SHA: base, CI_HEAD_SHA: head },
        encoding: 'utf8',
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SyntaxError/);
  }));

test('documentation validator rejects malformed JSONL records', () =>
  fixture((root, base) => {
    const head = commit(root, 'docs/stabilization/resource-journals/run.jsonl', '{}\n{invalid\n');
    const result = spawnSync(
      'node',
      [new URL('./ci-docs-validation.mjs', import.meta.url).pathname],
      {
        cwd: root,
        env: { ...process.env, CI_BASE_SHA: base, CI_HEAD_SHA: head },
        encoding: 'utf8',
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SyntaxError/);
  }));
