import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('hosted Spotlight guard checks relevant volumes despite unrelated Preboot transition', async () => {
  const workflow = await readFile(
    process.env.HOSTED_INDEXING_WORKFLOW_FILE ??
      new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
    'utf8',
  );
  const block = workflow.match(
    /- name: Disable indexing on the disposable hosted VM\n {8}shell: bash\n {8}run: \|\n((?: {10}.*\n)+)/,
  )?.[1];
  assert.ok(block, 'hosted_indexing_step_missing');
  const directory = await mkdtemp(join(tmpdir(), 'hosted-indexing-'));
  try {
    const mdutil = join(directory, 'mdutil');
    const sudo = join(directory, 'sudo');
    await writeFile(
      mdutil,
      `#!/bin/bash
if [[ "$1 $2 $3" == '-a -i off' ]]; then
  printf '/: Indexing disabled.\n/System/Volumes/Data: Indexing disabled.\n/System/Volumes/Preboot: Error: unexpected indexing state.\n'
  exit 1
fi
if [[ "$1 $2 $3" == '-i off /' ]]; then
  [[ "$MOCK_ROOT_DISABLE_ERROR" == 1 ]] && exit 1
  touch "$MOCK_INDEXING_DIR/root-disabled"
  exit 0
fi
if [[ "$1 $2 $3" == '-i off /System/Volumes/Data' ]]; then
  [[ "$MOCK_DATA_DISABLE_ERROR" == 1 ]] && exit 1
  touch "$MOCK_INDEXING_DIR/data-disabled"
  exit 0
fi
if [[ "$1 $2" == '-a -s' ]]; then
  printf '/:\\n\\tIndexing disabled.\\n/System/Volumes/Data:\\n\\tIndexing disabled.\\n/System/Volumes/Preboot:\\n\\tError: unexpected indexing state. kMDConfigSearchLevelTransitioning\\n'
  exit 1
fi
if [[ "$1 $2" == '-s /' ]]; then
  [[ "$MOCK_ROOT_ERROR" == 1 ]] && exit 1
  [[ -f "$MOCK_INDEXING_DIR/root-disabled" ]] || exit 3
  printf '/:\\n\\tIndexing %s.\\n' "$MOCK_ROOT_STATUS"
  exit 0
fi
if [[ "$1 $2" == '-s /System/Volumes/Data' ]]; then
  [[ "$MOCK_DATA_ERROR" == 1 ]] && exit 1
  [[ -f "$MOCK_INDEXING_DIR/data-disabled" ]] || exit 3
  printf '/System/Volumes/Data:\\n\\tIndexing %s.\\n' "$MOCK_DATA_STATUS"
  exit 0
fi
exit 2
`,
      { mode: 0o700 },
    );
    await writeFile(sudo, '#!/bin/bash\n"$@"\n', { mode: 0o700 });
    const script = block.replaceAll(/^ {10}/gm, '').replaceAll('/usr/bin/mdutil', mdutil);
    const run = async (overrides = {}) => {
      await rm(join(directory, 'root-disabled'), { force: true });
      await rm(join(directory, 'data-disabled'), { force: true });
      return spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RUNNER_ENVIRONMENT: 'github-hosted',
          RUNNER_OS: 'macOS',
          MOCK_ROOT_STATUS: 'disabled',
          MOCK_DATA_STATUS: 'disabled',
          MOCK_ROOT_ERROR: '0',
          MOCK_DATA_ERROR: '0',
          MOCK_ROOT_DISABLE_ERROR: '0',
          MOCK_DATA_DISABLE_ERROR: '0',
          MOCK_INDEXING_DIR: directory,
          ...overrides,
        },
      });
    };
    assert.equal(
      (await run()).status,
      0,
      'irrelevant Preboot transition must not block disabled work volumes',
    );
    assert.notEqual((await run({ MOCK_ROOT_STATUS: 'enabled' })).status, 0);
    assert.notEqual((await run({ MOCK_DATA_STATUS: 'enabled' })).status, 0);
    assert.notEqual((await run({ MOCK_ROOT_ERROR: '1' })).status, 0);
    assert.notEqual((await run({ MOCK_DATA_ERROR: '1' })).status, 0);
    assert.notEqual((await run({ MOCK_ROOT_DISABLE_ERROR: '1' })).status, 0);
    assert.notEqual((await run({ MOCK_DATA_DISABLE_ERROR: '1' })).status, 0);
    assert.notEqual((await run({ RUNNER_ENVIRONMENT: 'self-hosted' })).status, 0);
    assert.notEqual((await run({ RUNNER_OS: 'Linux' })).status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
