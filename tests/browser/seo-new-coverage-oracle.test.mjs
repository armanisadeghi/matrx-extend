import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedMissingSocialTags,
  runCopyCheckThenRecapture,
  socialCopyButtonObservation,
  verifyManualRecapture,
  verifySocialClipboard,
  verifySocialCopyOutcome,
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

test('social feedback finds a button whose title moved to data-matrx-title', () => {
  const label = 'Copy the meta tags this page is missing';
  const button = {
    getAttribute: (key) => (key === 'data-matrx-title' ? label : null),
    getBoundingClientRect: () => ({ width: 20 }),
    querySelector: (selector) => (selector === 'svg.lucide-check' ? {} : null),
  };
  const pane = {
    querySelectorAll: (selector) => (selector.includes('button[data-matrx-title]') ? [button] : []),
  };
  assert.deepEqual(socialCopyButtonObservation(pane, label), {
    buttonCount: 1,
    visible: true,
    hasTitleAttr: false,
    hasDataTitleAttr: true,
    check: true,
    failed: false,
    idle: false,
  });
});

test('copy outcome refuses failed feedback, wrong clipboard, and unchanged clipboard', () => {
  const copied = expectedMissingSocialTags(sparse);
  assert.deepEqual(
    verifySocialCopyOutcome(copied, sparse, { feedbackFailed: false, previousClipboard: '' }),
    { copiedTags: 5, exactClipboardMatch: true },
  );
  assert.throws(
    () =>
      verifySocialCopyOutcome('wrong', sparse, { feedbackFailed: false, previousClipboard: '' }),
    { code: 'SOCIAL_CLIPBOARD_MISMATCH' },
  );
  assert.throws(
    () => verifySocialCopyOutcome(copied, sparse, { feedbackFailed: true, previousClipboard: '' }),
    { code: 'SOCIAL_COPY_FAILURE_FEEDBACK' },
  );
  assert.throws(
    () =>
      verifySocialCopyOutcome(copied, sparse, { feedbackFailed: false, previousClipboard: copied }),
    { code: 'SOCIAL_CLIPBOARD_UNCHANGED' },
  );
});

test('copy case failure continues independent recapture; guard stop does not', async () => {
  const calls = [];
  const result = await runCopyCheckThenRecapture(
    async () => {
      calls.push('copy-failed');
      return { status: 'fail' };
    },
    async () => {
      calls.push('recapture');
      return { status: 'pass' };
    },
  );
  assert.deepEqual(calls, ['copy-failed', 'recapture']);
  assert.deepEqual(result, { copyResult: { status: 'fail' }, recaptureResult: { status: 'pass' } });
  calls.length = 0;
  await assert.rejects(
    () =>
      runCopyCheckThenRecapture(
        async () => {
          calls.push('guard-stop');
          throw new Error('resource_stop');
        },
        async () => {
          calls.push('recapture');
        },
      ),
    /resource_stop/,
  );
  assert.deepEqual(calls, ['guard-stop']);
});
