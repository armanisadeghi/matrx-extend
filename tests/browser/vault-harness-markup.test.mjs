/**
 * No vault harness may silently target panel markup that no longer exists.
 * The Vault tab is the shared @ai-matrx/vault workspace; these exact strings were the OLD
 * panel's and are gone from it. A harness that still drives one is listed in STALE below
 * with its replacement; adding a new such harness fails here, and so does fixing one without
 * removing it from the list (the list only shrinks). Live coverage: vault-package-panel-walk.mjs
 * (Fill, save-this-login, generator Fill page, create + cleanup).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const GONE = [
  'Save this login to your Vault?',
  'Search saved logins to update',
  'Reveal generated value',
  'Hide generated value',
  'Filled. Review the form, then sign in.',
  'Saved logins are unavailable right now.',
  'No saved login fills this page.',
  'Checking saved logins…',
  'Matrx did not answer. Try again.',
  "This browser page can't be filled.",
];

// harness -> what still covers (or must cover) its proof
const STALE = {
  'vault-capture-decisions-acceptance.cjs': 'save: walk; update/never/dismiss: unported',
  'vault-generator-acceptance.cjs': 'Fill page: walk; reveal/copy/clipboard custody: unported',
  'vault-password-change-acceptance.cjs': 'unported (password-change fill)',
  'vault-preferences-acceptance.cjs': 'unported (preferences/matching-off words)',
  'vault-realbrowser-acceptance.cjs':
    'orchestrator of the others; superseded by the walk for the three core proofs',
  'vault-saved-form-matrix.cjs': 'unported (form-shape fill matrix)',
  'vault-saved-login-acceptance.cjs': 'Fill: walk (vault-package-panel-walk.mjs)',
  'vault-setup-recovery-acceptance.cjs': 'turn-on-filling: walk; recovery cases unported',
};

const here = import.meta.dirname;
const files = readdirSync(here).filter(
  (f) => /^vault-.*\.(cjs|mjs)$/.test(f) && !/\.test\./.test(f),
);

test('stale vault harnesses are exactly the listed ones', () => {
  const found = files.filter((f) =>
    GONE.some((g) => readFileSync(join(here, f), 'utf8').includes(g)),
  );
  assert.deepEqual(found.sort(), Object.keys(STALE).sort());
});
