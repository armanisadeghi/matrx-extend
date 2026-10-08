import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedMissingSocialTags,
  verifyManualRecapture,
  verifySocialClipboard,
} from './seo-new-coverage-oracle.mjs';

const sparse = {
  url: 'https://example.org/',
  title: 'Example Domain',
  description: null,
  canonical: null,
  social: { title: false, description: false, url: false, type: false, card: false, image: false },
};
const changed = {
  ...sparse,
  title: 'Example Domain — updated',
  description: 'Updated public page description',
};

test('social clipboard oracle requires each distinct page state and rejects stale output', () => {
  const first = expectedMissingSocialTags(sparse);
  const second = expectedMissingSocialTags(changed);
  assert.notEqual(first, second);
  assert.match(first, /og:title.*Example Domain/);
  assert.match(second, /og:description.*Updated public page description/);
  assert.deepEqual(verifySocialClipboard(first, sparse), {
    copiedTags: 5,
    exactClipboardMatch: true,
  });
  assert.deepEqual(verifySocialClipboard(second, changed), {
    copiedTags: 6,
    exactClipboardMatch: true,
  });
  assert.throws(() => verifySocialClipboard(first, changed), /copied social tags match/);
  assert.throws(
    () => verifySocialClipboard(second.replace('twitter:card', 'og:card'), changed),
    /copied social tags match/,
  );
});

test('manual recapture oracle rejects a stale native audit after a changed public page', () => {
  const oldAudit = { title: sparse.title, reAudit: true, error: false };
  const newAudit = { title: changed.title, reAudit: true, error: false };
  assert.deepEqual(verifyManualRecapture(sparse, changed, oldAudit, newAudit), {
    publicTitleChanged: true,
    publicDescriptionChanged: true,
    oldAuditVisibleBeforeClick: true,
    nativeTitleMatchesChangedPublicDom: true,
  });
  assert.throws(
    () => verifyManualRecapture(sparse, changed, oldAudit, oldAudit),
    /native re-audit uses changed public title/,
  );
  assert.throws(
    () => verifyManualRecapture(sparse, changed, newAudit, newAudit),
    /old native audit remains before the trusted click/,
  );
});
