import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createShowcaseSelectionDiagnostic,
  observeShowcaseSelection,
  recordShowcasePointerSample,
  safeShowcaseSelectionFailure,
  sampleShowcaseFieldSelection,
  sampleShowcaseSelection,
  stageShowcaseSelection,
} from './showcase-selection-diagnostic.mjs';

test('selection diagnostics retain only bounded operation and DOM facts', () => {
  const diagnostic = createShowcaseSelectionDiagnostic();
  stageShowcaseSelection(diagnostic, 'scope_choice');
  stageShowcaseSelection(diagnostic, 'private@example.invalid');
  observeShowcaseSelection(diagnostic, {
    card_count: 3,
    overlay_count: 1,
    three_card_choice_count: 1,
    card_center_hit: false,
    page_text: 'private@example.invalid',
    scope_choice_count: -1,
  });
  assert.deepEqual(diagnostic, {
    substage: 'scope_choice',
    observations: {
      card_count: 3,
      overlay_count: 1,
      three_card_choice_count: 1,
      card_center_hit: false,
    },
    pointer_samples: {},
  });
  assert.equal(
    safeShowcaseSelectionFailure(diagnostic, new Error('private@example.invalid')),
    'selection_scope_choice_failed',
  );
});

test('failed card click preserves distinct bounded before and after pointer facts', async () => {
  const diagnostic = createShowcaseSelectionDiagnostic();
  const previous = {
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const rect = { x: 8, y: 20, left: 8, top: 20, right: 412, bottom: 92, width: 404, height: 72 };
  const panel = {
    getBoundingClientRect: () => ({ x: 84, y: 16, width: 320, height: 120 }),
    contains: (node) => node === panel,
  };
  const shadow = {
    querySelector: (selector) => (selector === '.panel' ? panel : null),
    querySelectorAll: () => [],
    elementFromPoint: () => panel,
  };
  const host = { shadowRoot: shadow, contains: () => false };
  const card = { getBoundingClientRect: () => rect, contains: () => false };
  let hit = host;
  globalThis.innerWidth = 420;
  globalThis.innerHeight = 600;
  globalThis.document = {
    querySelectorAll: (selector) =>
      selector === '#events article.event-card'
        ? [card, card, card]
        : selector === '#matrx-list-picker-host'
          ? [host]
          : [],
    querySelector: (selector) => (selector === '#matrx-list-picker-host' ? host : null),
    elementFromPoint: () => hit,
  };
  try {
    const page = { evaluate: async (callback) => callback() };
    await sampleShowcaseSelection(page, diagnostic, 'before_click');
    hit = card;
    await sampleShowcaseSelection(page, diagnostic, 'after_failure');
  } finally {
    globalThis.document = previous.document;
    globalThis.innerWidth = previous.innerWidth;
    globalThis.innerHeight = previous.innerHeight;
  }
  assert.equal(diagnostic.observations.card_center_hit, true);
  assert.equal(diagnostic.pointer_samples.before_click.center_hit_kind, 'picker_panel');
  assert.equal(diagnostic.pointer_samples.after_failure.center_hit_kind, 'card');
  assert.equal(diagnostic.pointer_samples.before_click.interior_hit_kinds.length, 9);
  assert.deepEqual(
    new Set(diagnostic.pointer_samples.before_click.interior_hit_kinds),
    new Set(['picker_panel']),
  );
});

test('pointer receipt rejects raw page text and unknown hit categories', () => {
  const diagnostic = createShowcaseSelectionDiagnostic();
  recordShowcasePointerSample(diagnostic, 'before_click', {
    viewport: { width: 420, height: 600 },
    card_rect: { x: 8, y: 20, width: 404, height: 72 },
    center_hit_kind: 'private@example.invalid',
    interior_hit_kinds: ['other_element', 'private@example.invalid'],
  });
  assert.equal(diagnostic.pointer_samples.before_click.center_hit_kind, 'none');
  assert.deepEqual(diagnostic.pointer_samples.before_click.interior_hit_kinds, [
    'other_element',
    'none',
  ]);
  assert.equal(JSON.stringify(diagnostic).includes('private@example.invalid'), false);
});

test('native receipt distinguishes card, scope, field click, and field wait failures', () => {
  const directory = mkdtempSync(
    join(process.env.MATRX_TEST_EXTERNAL_TMPDIR ?? tmpdir(), 'showcase-selection-'),
  );
  try {
    for (const substage of ['card_click', 'scope_choice', 'field_click', 'field_wait']) {
      const output = join(directory, `${substage}.json`);
      const run = spawnSync(
        process.execPath,
        [new URL('./showcase-picker-native-acceptance.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            MATRX_SHOWCASE_DIAGNOSTIC_PROBE: substage,
            MATRX_SHOWCASE_OUTPUT: output,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(run.status, 1);
      const raw = readFileSync(output, 'utf8');
      const receipt = JSON.parse(raw);
      assert.equal(receipt.failure_code, `selection_${substage}_failed`);
      assert.deepEqual(receipt.selection_diagnostic, {
        substage,
        observations: { card_count: 3, overlay_count: 1 },
        pointer_samples: {},
      });
      assert.equal(raw.includes('private@example.invalid'), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('field geometry and picked count are bounded and distinguish click from selection wait', async () => {
  const diagnostic = createShowcaseSelectionDiagnostic();
  const previous = {
    document: globalThis.document,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  const rect = { x: 8, y: 20, left: 8, top: 20, right: 412, bottom: 92, width: 404, height: 72 };
  const panel = {
    getBoundingClientRect: () => ({ x: 84, y: 16, width: 320, height: 120 }),
    contains: (node) => node === panel,
  };
  let picked = 0;
  let hit = null;
  const shadow = {
    querySelector: (selector) => (selector === '.panel' ? panel : null),
    querySelectorAll: (selector) => (selector === '.picked-item' ? Array(picked).fill({}) : []),
    elementFromPoint: () => panel,
  };
  const host = { shadowRoot: shadow, contains: () => false };
  const field = { getBoundingClientRect: () => rect, contains: () => false };
  hit = host;
  globalThis.innerWidth = 420;
  globalThis.innerHeight = 600;
  globalThis.document = {
    querySelector: (selector) =>
      selector === '#events article.event-card h2'
        ? field
        : selector === '#matrx-list-picker-host'
          ? host
          : null,
    elementFromPoint: () => hit,
  };
  try {
    const page = { evaluate: async (callback) => callback() };
    stageShowcaseSelection(diagnostic, 'field_click');
    await sampleShowcaseFieldSelection(page, diagnostic, 'field_before_click');
    assert.equal(diagnostic.pointer_samples.field_before_click.center_hit_kind, 'picker_panel');
    assert.equal(diagnostic.observations.picked_item_count, 0);
    hit = field;
    picked = 1;
    stageShowcaseSelection(diagnostic, 'field_wait');
    await sampleShowcaseFieldSelection(page, diagnostic, 'field_after_click');
    assert.equal(diagnostic.pointer_samples.field_after_click.center_hit_kind, 'field');
    assert.deepEqual(diagnostic.pointer_samples.field_after_click.field_rect, {
      x: 8,
      y: 20,
      width: 404,
      height: 72,
    });
    assert.equal(diagnostic.observations.picked_item_count, 1);
    picked = 0;
    await sampleShowcaseFieldSelection(page, diagnostic, 'field_after_failure');
    const serialized = JSON.parse(JSON.stringify(diagnostic));
    assert.deepEqual(
      [
        serialized.pointer_samples.field_before_click.picked_item_count,
        serialized.pointer_samples.field_after_click.picked_item_count,
        serialized.pointer_samples.field_after_failure.picked_item_count,
      ],
      [0, 1, 0],
    );
    assert.equal(serialized.observations.picked_item_count, 0);
    assert.equal(
      safeShowcaseSelectionFailure(diagnostic, Error('private@example.invalid')),
      'selection_field_wait_failed',
    );
    assert.equal(JSON.stringify(diagnostic).includes('private@example.invalid'), false);
  } finally {
    Object.assign(globalThis, previous);
  }
});
