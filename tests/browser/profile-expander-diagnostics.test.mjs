import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { captureProfileExecutionFailure } from './profile-native-failure.mjs';

const source = await readFile(
  new URL('./profile-identity-employment-cases.mjs', import.meta.url),
  'utf8',
);
const body = source
  .slice(source.indexOf('export async function runProfileExpandersCase('))
  .replace(/^export /, '');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const run = new AsyncFunction(
  'assert',
  'randomUUID',
  'SECTIONS',
  'ensureOpen',
  'sample',
  'fill',
  'sectionState',
  'toggle',
  'clickHeader',
  'waitFor',
  `${body}\nreturn runProfileExpandersCase({ panel: {}, mode: 'member', dimension: 'warm' });`,
);

for (const failingStep of ['collapse', 'draft_assert']) {
  test(`expander ${failingStep} retains safe phase and section after discard`, async () => {
    const privateText = 'private-profile-value@invalid.test';
    const primary = new Error(privateText);
    let value = 'Original';
    let expanded = 'true';
    let toggles = 0;
    const dependencies = [
      assert,
      () => '12345678',
      ['Identity', 'Employment'],
      async () => {},
      async () => ({
        values: {
          Preferred: failingStep === 'draft_assert' && value !== 'Original' ? 'lost' : value,
        },
        dirty: value !== 'Original',
        save_enabled: value !== 'Original',
      }),
      async (_panel, _section, _field, next) => {
        value = next;
      },
      async () => ({ section_count: 1, expanded }),
      async (_panel, _name, open) => {
        if (failingStep === 'collapse' && ++toggles === 1) throw primary;
        expanded = String(open);
      },
      async () => {
        value = 'Original';
      },
      async (_label, read, predicate) => {
        const state = await read();
        assert.ok(predicate(state));
        return state;
      },
    ];
    const caught = await run(...dependencies).catch((error) => error);
    if (failingStep === 'collapse') assert.equal(caught, primary);
    const report = { stage: 'profile' };
    await captureProfileExecutionFailure(report, caught, {
      operation: 'EXT-F-1004-T21:warm:run',
      readUiState: async () => null,
    });
    assert.deepEqual(report.execution_failure.expander, {
      phase: failingStep === 'collapse' ? 'collapse' : 'draft_assert',
      section: failingStep === 'collapse' ? 'Identity' : null,
    });
    assert.ok(!JSON.stringify(report).includes(privateText));
  });
}

test('expander reports the failing later section rather than the first section', async () => {
  let value = 'Original';
  const failure = new Error('private-section@invalid.test');
  const caught = await run(
    assert,
    () => '12345678',
    ['Identity', 'Employment'],
    async () => {},
    async () => ({ values: { Preferred: value }, save_enabled: value !== 'Original' }),
    async (_panel, _section, _label, next) => {
      value = next;
    },
    async () => ({ section_count: 1, expanded: 'true' }),
    async (_panel, section, open) => {
      if (section === 'Employment' && !open) throw failure;
    },
    async () => {
      value = 'Original';
    },
    async (_label, read, predicate) => {
      const state = await read();
      assert.ok(predicate(state));
      return state;
    },
  ).catch((error) => error);
  assert.equal(caught, failure);
  const report = { stage: 'profile' };
  await captureProfileExecutionFailure(report, caught, {
    operation: 'EXT-F-1004-T21:warm:run',
    readUiState: async () => null,
  });
  assert.deepEqual(report.execution_failure.expander, { phase: 'collapse', section: 'Employment' });
  assert.ok(!JSON.stringify(report).includes('@invalid.test'));
});

test('expander preserves primary and records discard restoration failure separately', async () => {
  const primary = new Error('private-primary@invalid.test');
  const restoration = new Error('private-restoration@invalid.test');
  const caught = await run(
    assert,
    () => '12345678',
    ['Identity'],
    async () => {},
    async () => ({ values: { Preferred: 'Original' } }),
    async () => {},
    async () => ({ section_count: 1, expanded: 'true' }),
    async () => {
      throw primary;
    },
    async () => {
      throw restoration;
    },
    async () => {},
  ).catch((error) => error);
  assert.equal(caught, primary);
  assert.equal(caught.profileRestorationError, restoration);
  const report = { stage: 'profile' };
  await captureProfileExecutionFailure(report, caught, {
    operation: 'EXT-F-1004-T21:warm:run',
    readUiState: async () => null,
  });
  assert.deepEqual(report.execution_failure.restoration, {
    code: 'profile_case_restoration_failed',
    stage: 'discard_local_draft',
  });
  assert.deepEqual(report.execution_failure.expander, { phase: 'collapse', section: 'Identity' });
  assert.ok(!JSON.stringify(report).includes('@invalid.test'));
});
