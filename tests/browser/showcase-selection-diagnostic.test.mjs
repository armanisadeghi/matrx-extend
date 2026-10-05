import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createShowcaseSelectionDiagnostic,
  observeShowcaseSelection,
  safeShowcaseSelectionFailure,
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
  });
  assert.equal(
    safeShowcaseSelectionFailure(diagnostic, new Error('private@example.invalid')),
    'selection_scope_choice_failed',
  );
});

test('native receipt distinguishes card click from scope choice failure', () => {
  const directory = mkdtempSync(
    join(process.env.MATRX_TEST_EXTERNAL_TMPDIR ?? tmpdir(), 'showcase-selection-'),
  );
  try {
    for (const substage of ['card_click', 'scope_choice']) {
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
      });
      assert.equal(raw.includes('private@example.invalid'), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
