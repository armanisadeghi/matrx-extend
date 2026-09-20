/* The helper must never open a browser page for a fixture that does not share
 * the parent login page's complete origin, including its ephemeral port. */
const assert = require('node:assert/strict');
const {
  fixtureUrlsForParent,
  renderSavedLoginFixtureHTML,
  runSavedLoginChecks,
} = require('./vault-saved-login-acceptance.cjs');

const parentLoginUrl = 'http://127.0.0.1:43127/login';
const urls = fixtureUrlsForParent(parentLoginUrl, 'http://127.0.0.1:43127');
assert.equal(new URL(urls.nested).origin, 'http://127.0.0.1:43127');
assert.equal(new URL(urls.external).origin, 'http://127.0.0.1:43127');
const secondPortUrls = fixtureUrlsForParent('http://127.0.0.1:43128/login', 'http://127.0.0.1:43128');
assert.equal(secondPortUrls.nested, 'http://127.0.0.1:43128/saved-login-nested');
assert.equal(secondPortUrls.external, 'http://127.0.0.1:43128/saved-login-external');
assert.match(renderSavedLoginFixtureHTML('nested'), /saved-login-form/);
assert.match(renderSavedLoginFixtureHTML('external'), /setAttribute\('form', form.id\)/);

(async () => {
  let pagesCreated = 0;
  await assert.rejects(() => runSavedLoginChecks({
    context: { newPage: async () => {
      pagesCreated += 1;
      throw new Error('mismatched_origin_created_page');
    } },
    worker: {}, realPanel: {}, targetName: 'Receipt-owned login', username: 'a@example.invalid', password: 'secret',
    parentLoginUrl,
    parentOrigin: 'http://127.0.0.1:43128',
    getSubmitCount: () => 1,
    assert: (condition, code) => { if (!condition) throw new Error(code); },
    wait: async () => {},
    verifyRealVaultPanel: async () => {},
  }), /saved_login_parent_origin_mismatch/);
  assert.equal(pagesCreated, 0, 'mismatched origin created a browser page');

  let closeAttempts = 0;
  let isClosedChecks = 0;
  const cleanupProof = {};
  await assert.rejects(() => runSavedLoginChecks({
    context: { newPage: async () => ({
      goto: async () => { throw new Error('primary_navigation_failure'); },
      isClosed: () => { isClosedChecks += 1; return false; },
      close: async () => { closeAttempts += 1; throw new Error('page_close_failure'); },
    }) },
    worker: {}, realPanel: {}, targetName: 'Receipt-owned login', username: 'a@example.invalid', password: 'secret',
    parentLoginUrl,
    parentOrigin: 'http://127.0.0.1:43127',
    getSubmitCount: () => 1,
    assert: (condition, code) => { if (!condition) throw new Error(code); },
    wait: async () => {},
    proof: cleanupProof,
    verifyRealVaultPanel: async () => {},
  }), /primary_navigation_failure/);
  assert.equal(closeAttempts, 1, 'owned page cleanup was not attempted');
  assert.equal(isClosedChecks, 2, 'owned page closure was not verified before and after cleanup');
  assert.equal(cleanupProof.savedLoginFill.pagesClosed, false, 'failed page cleanup was reported as closed');
  assert.equal(cleanupProof.savedLoginFill.pageCleanupFailure, true, 'failed page cleanup was not surfaced in evidence');
  process.stdout.write('PASS: saved-login fixture uses the parent exact origin and refuses mismatches before page creation\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
