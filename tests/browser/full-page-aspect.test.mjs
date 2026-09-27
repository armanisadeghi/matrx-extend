import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFullPageAspect } from './full-page-aspect.mjs';

// Harbor Dental's three-screen appointment guide is captured at different display scales.
test('accepts a persisted tall image only when its aspect matches the in-page viewport', () => {
  assert.equal(
    matchesFullPageAspect({ width: 1280, height: 2160 }, { innerWidth: 1280, scrollHeight: 2160 }),
    true,
  );
  assert.equal(
    matchesFullPageAspect({ width: 2880, height: 7200 }, { innerWidth: 1440, scrollHeight: 3600 }),
    true,
  );
  assert.equal(
    matchesFullPageAspect({ width: 1280, height: 1800 }, { innerWidth: 1280, scrollHeight: 2160 }),
    false,
  );
  assert.equal(
    matchesFullPageAspect({ width: 1280, height: 2160 }, { innerWidth: 0, scrollHeight: 2160 }),
    false,
  );
});
