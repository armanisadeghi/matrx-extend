import assert from 'node:assert/strict';
import { closeSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openResourceJournal } from './stabilization-resource-journal.mjs';

const workflow = readFileSync(
  process.env.HOSTED_JOURNAL_WORKFLOW_FILE ??
    new URL('../.github/workflows/hosted-guest-acceptance.yml', import.meta.url),
  'utf8',
);
const upload = workflow.slice(workflow.indexOf('- name: Upload browser result'));
const paths =
  upload.match(/ {12}docs\/stabilization\/resource-journals\/[^\n]+/g)?.map((p) => p.trim()) ?? [];
const wrappers = [
  ...workflow.matchAll(
    /--run-id "(hosted-[a-z]+)-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}"/g,
  ),
].map((m) => m[1]);
const run = '38098345217';
const directory = 'docs/stabilization/resource-journals';

// Break guarded: a historic or prior-attempt journal enters the hosted artifact,
// or a failure/pending journal from any supported wrapper is silently omitted.
for (const scenario of ['completed', 'crashed', 'missing']) {
  test(`hosted upload selects only current-attempt journals when ${scenario}`, () => {
    assert.match(upload, /if: always\(\)/);
    assert.match(upload, /if-no-files-found: ignore/);
    assert.deepEqual(wrappers.sort(), [
      'hosted-browser',
      'hosted-guest',
      'hosted-package',
      'hosted-startup',
    ]);
    const repo = mkdtempSync(join(tmpdir(), 'hosted-journal-upload-'));
    try {
      mkdirSync(join(repo, 'docs/stabilization'), { recursive: true });
      const write = (id, complete) => {
        const journal = openResourceJournal(repo, id, {
          closeFd(fd) {
            closeSync(fd);
            if (!complete) throw new Error('simulated crash before publication');
          },
        });
        journal.write({
          code: 'RESOURCE_FINAL_DECISION',
          runId: id,
          decision: 'child_failed',
          exitCode: 1,
        });
        // A crash retains the pending file; close it without publishing for this fixture.
        if (complete) journal.close();
        else assert.throws(() => journal.close(), /simulated crash/);
      };
      for (const prefix of wrappers) {
        write(`${prefix}-${run}-1`, true);
        write(`${prefix}-38098345218-2`, true);
        if (scenario !== 'missing') write(`${prefix}-${run}-2`, scenario === 'completed');
      }
      write('hosted-guest-historic-review', true);
      const selected = paths
        .flatMap((path) =>
          globSync(
            path
              .replaceAll('${{ github.run_id }}', run)
              .replaceAll('${{ github.run_attempt }}', '2'),
            { cwd: repo },
          ),
        )
        .sort();
      const expected =
        scenario === 'missing'
          ? []
          : wrappers
              .map(
                (prefix) =>
                  `${directory}/${prefix}-${run}-2${scenario === 'crashed' ? '.pending' : ''}.jsonl`,
              )
              .sort();
      assert.deepEqual(
        selected,
        expected,
        'artifact journal ownership or crash diagnostics differ',
      );
      for (const path of selected) {
        assert.equal(JSON.parse(readFileSync(join(repo, path), 'utf8')).decision, 'child_failed');
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}
