import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';

const source = await readFile(
  new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = source.indexOf('        const candidate = await waitFor(');
const end = source.indexOf('        const projectName =', start);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const observeCandidate = new AsyncFunction(
  'waitFor',
  'evaluate',
  'panel',
  'report',
  'projectFixture',
  `${source.slice(start, end)} return candidate;`,
);

async function observe(contents) {
  const window = new Window();
  window.document.body.innerHTML = `<div data-testid="save-source-form"><section aria-label="Place results">
    <input aria-label="Search Projects" placeholder="Search Projects">${contents}</section></div>`;
  const report = { observations: {} };
  try {
    const candidate = await observeCandidate(
      async (_label, read, accept) => {
        const state = await read();
        assert.equal(accept(state), true, 'project picker not ready');
        return state;
      },
      async (_panel, expression) => window.eval(expression),
      {},
      report,
      { name: 'Northline intake project' },
    );
    return { candidate, report };
  } finally {
    window.happyDOM.abort();
  }
}

test('Source project candidate resolves the rendered accessible search control and unselected row', async () => {
  const { candidate, report } = await observe(`<ul>
    <li><button aria-pressed="true"><span class="flex-1">Northline selected project</span></button></li>
    <li><button aria-pressed="false"><span class="flex-1">Northline intake project</span></button></li></ul>`);
  assert.deepEqual(Array.from(candidate.labels), ['Northline intake project']);
  assert.equal(report.observations.project_picker.search_input_count, 1);
  assert.equal(report.observations.project_picker.unselected_candidate_count, 1);
  assert.equal(JSON.stringify(report).includes('Northline'), false);
});

test('Source project picker refuses an empty candidate list instead of inventing a destination', async () => {
  await assert.rejects(observe('<div>No places found.</div>'), /project picker not ready/);
});

test('Source project picker refuses an unrelated existing project', async () => {
  await assert.rejects(
    observe(
      '<ul><li><button aria-pressed="false"><span class="flex-1">Someone else project</span></button></li></ul>',
    ),
    /project picker not ready/,
  );
});

test('Source project picker refuses duplicated owned candidate labels', async () => {
  const row =
    '<li><button aria-pressed="false"><span class="flex-1">Northline intake project</span></button></li>';
  await assert.rejects(observe(`<ul>${row}${row}</ul>`), /project picker not ready/);
});
