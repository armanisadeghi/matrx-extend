import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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

test('moving operational JSON into reports requires fresh CI before later metadata reuse', () =>
  fixture((root, artifact) => {
    const oldLedger = commit(root, 'docs/stabilization/repository-ledger.json', '{}');
    mkdirSync(join(root, 'docs/stabilization/reports'), { recursive: true });
    git(
      root,
      'mv',
      'docs/stabilization/repository-ledger.json',
      'docs/stabilization/reports/repository-ledger.json',
    );
    git(root, 'commit', '-qm', 'Place operational ledger in reports');
    const moved = git(root, 'rev-parse', 'HEAD');
    assert.equal(classifyProvenChange(root, oldLedger, moved, artifact), 'full');
    const updated = commit(
      root,
      'docs/stabilization/reports/repository-ledger.json',
      '{"updated":true}',
    );
    assert.equal(classifyProvenChange(root, moved, updated, artifact), 'full');
    assert.equal(classifyProvenChange(root, moved, updated, moved), 'docs');
  }));

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
                name: `CI release source ${sha} (by extend-stabilization)`,
                path: '.github/workflows/ci.yml',
                event: 'workflow_dispatch',
                head_branch: 'main',
                status: 'completed',
                head_sha: sha,
                run_attempt: 1,
              },
        );
      assert.equal(
        await latestSuccessfulDevelopmentArtifactSource(),
        conclusion === 'success' ? sha : null,
      );
    }
    const eligibleRun = {
      conclusion: 'success',
      name: `CI release source ${sha} (by extend-stabilization)`,
      path: '.github/workflows/ci.yml',
      event: 'workflow_dispatch',
      head_branch: 'main',
      status: 'completed',
      head_sha: sha,
      run_attempt: 1,
    };
    for (const changed of [
      { path: '.github/workflows/release.yml' },
      { event: 'pull_request' },
      { head_sha: 'b'.repeat(40) },
    ]) {
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
            : { ...eligibleRun, ...changed },
        );
      assert.equal(await latestSuccessfulDevelopmentArtifactSource(), null);
    }
    globalThis.fetch = async () => new Response('', { status: 403 });
    assert.equal(await latestSuccessfulDevelopmentArtifactSource(), null);
    globalThis.fetch = async () =>
      new Response('{invalid JSON', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    assert.equal(await latestSuccessfulDevelopmentArtifactSource(), null);
    globalThis.fetch = async (url) =>
      String(url).includes('/actions/artifacts?')
        ? Response.json({
            artifacts: [
              {
                name: `matrx-extend-development-test-${sha}-123-1`,
                expired: false,
                size_in_bytes: 42,
                workflow_run: { id: 123, head_sha: sha },
              },
            ],
          })
        : new Response('{invalid JSON', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    assert.equal(await latestSuccessfulDevelopmentArtifactSource(), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = originalRepository;
  }
});

async function withCliFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'ci-scope-cli-'));
  let responseMode = 'valid';
  let artifactSource;
  const server = createServer((request, response) => {
    if (responseMode === 'unavailable') {
      response.writeHead(503).end('unavailable');
      return;
    }
    if (
      (responseMode === 'malformed-listing' && request.url?.includes('/actions/artifacts?')) ||
      (responseMode === 'malformed-run' && request.url?.includes('/actions/runs/'))
    ) {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{invalid JSON');
      return;
    }
    const body = request.url?.includes('/actions/artifacts?')
      ? responseMode === 'empty-listing'
        ? { artifacts: [] }
        : {
            artifacts: [
              {
                name: `matrx-extend-development-test-${artifactSource}-123-1`,
                expired: false,
                size_in_bytes: 42,
                workflow_run: { id: 123, head_sha: artifactSource },
              },
            ],
          }
      : {
          conclusion: 'success',
          name: `CI release source ${artifactSource} (by extend-stabilization)`,
          path: '.github/workflows/ci.yml',
          event: 'workflow_dispatch',
          head_branch: 'main',
          status: 'completed',
          head_sha: artifactSource,
          run_attempt: 1,
        };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'ci@example.invalid');
    git(root, 'config', 'user.name', 'CI fixture');
    artifactSource = commit(root, 'docs/stabilization/README.md', 'base');
    const docsHead = commit(root, 'docs/stabilization/reports/route.json', '{}');
    const unverifiedRuntime = commit(root, 'src/panel.ts', 'runtime change');
    const runtimeDocsHead = commit(root, 'docs/stabilization/reports/next.json', '{}');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await run({
      root,
      artifactSource,
      docsHead,
      unverifiedRuntime,
      runtimeDocsHead,
      setResponseMode: (mode) => {
        responseMode = mode;
      },
      apiUrl: `http://127.0.0.1:${server.address().port}`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

async function cliScope({ root, base, head, apiUrl }) {
  const outputFile = join(root, 'github-output');
  writeFileSync(outputFile, '');
  const child = spawn(
    process.execPath,
    [new URL('./ci-change-scope.mjs', import.meta.url).pathname],
    {
      cwd: root,
      env: {
        ...process.env,
        CI_BASE_SHA: base,
        CI_HEAD_SHA: head,
        CI_EVENT_NAME: 'push',
        CI_EVENT_REF: 'refs/heads/main',
        GITHUB_TOKEN: 'local-fixture-token',
        GITHUB_REPOSITORY: 'matrx/extend',
        GITHUB_API_URL: apiUrl,
        GITHUB_OUTPUT: outputFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(status, 0, stderr);
    assert.equal(stderr, '');
    return { result: JSON.parse(stdout), output: readFileSync(outputFile, 'utf8') };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}

for (const mode of ['malformed-listing', 'malformed-run', 'unavailable', 'empty-listing']) {
  test(`CLI routes documentation change to full when artifact proof is ${mode}`, async () =>
    withCliFixture(async (fixture) => {
      fixture.setResponseMode(mode);
      const { result, output } = await cliScope({
        ...fixture,
        base: fixture.artifactSource,
        head: fixture.docsHead,
      });
      assert.equal(result.scope, 'full');
      assert.deepEqual(result.paths, ['docs/stabilization/reports/route.json']);
      assert.equal(result.baseAvailable, true);
      assert.equal(result.provenArtifactSource, null);
      assert.equal(output, 'scope=full\n');
    }));
}

test('CLI routes documentation change to docs when a successful artifact proves its ancestor', async () =>
  withCliFixture(async (fixture) => {
    const { result, output } = await cliScope({
      ...fixture,
      base: fixture.artifactSource,
      head: fixture.docsHead,
    });
    assert.equal(result.scope, 'docs');
    assert.deepEqual(result.paths, ['docs/stabilization/reports/route.json']);
    assert.equal(result.baseAvailable, true);
    assert.equal(result.provenArtifactSource, fixture.artifactSource);
    assert.equal(output, 'scope=docs\n');
  }));

test('CLI routes docs after unverified runtime ancestor to full despite docs-only event diff', async () =>
  withCliFixture(async (fixture) => {
    const { result, output } = await cliScope({
      ...fixture,
      base: fixture.unverifiedRuntime,
      head: fixture.runtimeDocsHead,
    });
    assert.equal(result.scope, 'full');
    assert.deepEqual(result.paths, ['docs/stabilization/reports/next.json']);
    assert.equal(result.baseAvailable, true);
    assert.equal(result.provenArtifactSource, fixture.artifactSource);
    assert.equal(output, 'scope=full\n');
  }));

test('workflow gates full jobs and development artifact behind the scope decision', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const scope = workflow.split('  scope:\n')[1]?.split('  docs:\n')[0];
  const docs = workflow.split('  docs:\n')[1]?.split('  resource-guard-integration:\n')[0];
  const mac = workflow.split('  resource-guard-integration:\n')[1]?.split('  checks:\n')[0];
  const checks = workflow.split('  checks:\n')[1];
  assert.match(
    scope,
    /Scope classifier regression[\s\S]*run: node --test scripts\/ci-change-scope\.test\.mjs[\s\S]*name: Classify exact changed paths/,
  );
  assert.match(workflow, /CI_EVENT_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(docs, /if: needs\.scope\.outputs\.kind == 'docs'/);
  assert.match(docs, /pnpm lint --diagnostic-level=error/);
  assert.match(docs, /ci-docs-validation\.mjs/);
  assert.match(docs, /test_stabilization_release_truth\.py/);
  assert.doesNotMatch(docs, /upload-artifact|wxt build|current-test-artifact\.mjs produce/);
  assert.match(
    mac,
    /if: needs\.scope\.result == 'success' && needs\.scope\.outputs\.kind != 'docs'/,
  );
  assert.match(
    checks,
    /if: needs\.scope\.result == 'success' && needs\.scope\.outputs\.kind != 'docs'/,
  );
  assert.match(checks, /pnpm compile/);
  assert.match(checks, /pnpm test/);
  assert.match(checks, /pnpm wxt build/);
  assert.match(checks, /current-test-artifact\.mjs produce/);
  assert.match(checks, /upload-artifact@v4/);
});

// This census catches a portable test corpus imported into both runner lanes,
// including indirect suite imports; only actual-host artifact provenance belongs in both.
function assertHostedLaneOwnership(workflow, focusedCommand) {
  const mac = workflow.split('  resource-guard-integration:\n')[1]?.split('  checks:\n')[0];
  const linux = workflow.split('  checks:\n')[1];
  assert.match(mac, /timeout-minutes: 5\n/);
  assert.match(linux, /run: pnpm test:focused-acceptance\n/);
  const macRoots = [...mac.matchAll(/run: node --test ([^\n]+)/g)].flatMap((m) => m[1].split(' '));
  const hostTests = [
    'scripts/test-stabilization-resource-safety-integration.mjs',
    'scripts/test-stabilization-resource-disk-integration.mjs',
    'scripts/test-stabilization-resource-journal.mjs',
    'scripts/test-stabilization-resource-cpu-integration.mjs',
  ];
  for (const path of hostTests)
    assert.ok(macRoots.includes(path), `missing host boundary: ${path}`);
  const graph = (roots) => {
    const seen = new Set();
    const tests = new Set();
    const visit = (url) => {
      if (seen.has(url.href)) return;
      seen.add(url.href);
      const source = readFileSync(url, 'utf8');
      if (/from ['"]node:test['"]/.test(source)) tests.add(url.href);
      for (const match of source.matchAll(/^import\s+['"](\.[^'"]+\.mjs)['"];?$/gm))
        visit(new URL(match[1], url));
    };
    for (const path of roots) visit(new URL(`../${path}`, import.meta.url));
    return tests;
  };
  const macTests = graph(macRoots);
  const linuxTests = graph(focusedCommand.split(' ').filter((path) => path.endsWith('.mjs')));
  const provenance = new URL('./hosted-artifact-provenance.test.mjs', import.meta.url).href;
  assert.ok(
    linuxTests.has(new URL('./test-hosted-acceptance-lanes.mjs', import.meta.url).href),
    'portable acceptance corpus absent from Linux',
  );
  assert.ok(
    macTests.has(provenance) && linuxTests.has(provenance),
    'actual-host provenance coverage absent',
  );
  const duplicatePortable = [...macTests].filter(
    (path) => linuxTests.has(path) && path !== provenance,
  );
  assert.deepEqual(
    duplicatePortable,
    [],
    'portable acceptance repeated inside bounded Mac resource job',
  );
}

test('CI runner census keeps portable acceptance on Linux and host boundaries on macOS', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const focused = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    .scripts['test:focused-acceptance'];
  assertHostedLaneOwnership(workflow, focused);
  assert.throws(
    () =>
      assertHostedLaneOwnership(
        workflow.replace(
          'run: node --test scripts/hosted-artifact-provenance.test.mjs',
          'run: node --test scripts/hosted-artifact-provenance.test.mjs scripts/test-hosted-acceptance-lanes.mjs',
        ),
        focused,
      ),
    /portable acceptance repeated/,
  );
  assert.throws(
    () =>
      assertHostedLaneOwnership(
        workflow.replace('run: pnpm test:focused-acceptance', 'run: true'),
        focused,
      ),
    /pnpm test:focused-acceptance/,
  );
  for (const path of [
    'scripts/test-stabilization-resource-safety-integration.mjs',
    'scripts/test-stabilization-resource-disk-integration.mjs',
    'scripts/test-stabilization-resource-journal.mjs',
    'scripts/test-stabilization-resource-cpu-integration.mjs',
    'scripts/hosted-artifact-provenance.test.mjs',
  ])
    assert.throws(
      () =>
        assertHostedLaneOwnership(
          workflow.replace(`run: node --test ${path}`, 'run: true'),
          focused,
        ),
      /missing host boundary|actual-host provenance coverage absent/,
    );
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
