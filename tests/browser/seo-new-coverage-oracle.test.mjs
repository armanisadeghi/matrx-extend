import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedMissingSocialTags,
  observeSocialCopyOutcome,
  pollSocialFeedback,
  requireSeoDoorSourceRestoration,
  runCopyCheckThenRecapture,
  runSeoCaseSequence,
  seoCaseSelection,
  socialCopyButtonObservation,
  verifyManualRecapture,
  verifySocialClipboard,
  verifySocialCopyOutcome,
} from './seo-new-coverage-oracle.mjs';

test('controlled SEO scope reaches T14 and T02 while excluding volatile detail; full still fails it', async () => {
  const observed = [];
  const controlled = async () => observed.push('T14 before', 'T02 changed metadata', 'T14 after');
  const volatile = async () => {
    observed.push('T09 volatile detail');
    throw new Error('unstable_source');
  };
  await runSeoCaseSequence(controlled, volatile, 'controlled');
  assert.deepEqual(observed, ['T14 before', 'T02 changed metadata', 'T14 after']);
  assert.deepEqual(seoCaseSelection('controlled').excluded_cases, [
    'T09 volatile public detail',
    'T09 optional metadata fixture',
  ]);
  observed.length = 0;
  await assert.rejects(() => runSeoCaseSequence(controlled, volatile), /unstable_source/);
  assert.deepEqual(observed, [
    'T14 before',
    'T02 changed metadata',
    'T14 after',
    'T09 volatile detail',
  ]);
  observed.length = 0;
  await assert.rejects(
    () => runSeoCaseSequence(controlled, volatile, 'invalid'),
    /unknown_seo_case_scope/,
  );
  assert.deepEqual(observed, []);
});

test('readability scope runs only its owned fixture lifecycle and records a partial selection', async () => {
  const observed = [];
  const unrelated = async () => observed.push('controlled SEO actions');
  const volatile = async () => observed.push('volatile public details');
  const readability = async () =>
    observed.push('two known texts', 'original page restored and re-audited');

  await runSeoCaseSequence(unrelated, volatile, 'readability', readability);

  assert.deepEqual(observed, ['two known texts', 'original page restored and re-audited']);
  assert.deepEqual(seoCaseSelection('readability'), {
    scope: 'readability',
    selected_cases: ['T09'],
    selected_subtargets: ['guest_manual_readability_matches_two_known_texts'],
    excluded_cases: ['T01-T08', 'T10-T14', 'all other T09 checks'],
  });
  await assert.rejects(
    () => runSeoCaseSequence(unrelated, volatile, 'readability'),
    /known_readability_case_required/,
  );
  await assert.rejects(
    () => runSeoCaseSequence(unrelated, volatile, 'unknown'),
    /unknown_seo_case_scope/,
  );
  await assert.rejects(
    () => runSeoCaseSequence(unrelated, volatile, null),
    /unknown_seo_case_scope/,
  );
});

test('metadata scope selects only the owned hreflang and Article door target', () => {
  assert.deepEqual(seoCaseSelection('metadata'), {
    scope: 'metadata',
    selected_cases: ['T09'],
    selected_subtargets: ['guest_owned_hreflang_article_doors_match_fixture_dom'],
    excluded_cases: ['all SEO targets other than the owned T09 metadata door target'],
  });
});

test('metadata door restoration fails when the source tab closes or changes URL', () => {
  assert.deepEqual(
    requireSeoDoorSourceRestoration({ sourcePageStillOpen: true, sourceUrlUnchanged: true }),
    { sourcePageStillOpen: true, sourceUrlUnchanged: true },
  );
  for (const observation of [
    { sourcePageStillOpen: false, sourceUrlUnchanged: true },
    { sourcePageStillOpen: true, sourceUrlUnchanged: false },
    null,
  ])
    assert.throws(() => requireSeoDoorSourceRestoration(observation));
});

test('volatile detail assertion runs after controlled T14 and T02 observations and still fails', async () => {
  const observed = [];
  const unstableSource = new Error('manual_source_stability');
  const controlledCases = async () => {
    observed.push('T14 clipboard readback');
    observed.push('T02 changed metadata recapture');
  };
  const dynamicDetailCases = async () => {
    observed.push('T09 public DOM comparison');
    throw unstableSource;
  };
  await assert.rejects(
    async () => {
      await dynamicDetailCases();
      await controlledCases();
    },
    (error) => error === unstableSource,
  );
  assert.deepEqual(observed, ['T09 public DOM comparison']);
  observed.length = 0;
  await assert.rejects(
    () => runSeoCaseSequence(controlledCases, dynamicDetailCases),
    (error) => error === unstableSource,
  );
  assert.deepEqual(observed, [
    'T14 clipboard readback',
    'T02 changed metadata recapture',
    'T09 public DOM comparison',
  ]);
});

test('lost controlled target halts before a dynamic fixture can obscure it', async () => {
  const observed = [];
  const lostTarget = new Error('controlled_target_lost');
  await assert.rejects(
    () =>
      runSeoCaseSequence(
        async () => {
          observed.push('controlled preflight');
          throw lostTarget;
        },
        async () => {
          observed.push('T09 public DOM comparison');
        },
      ),
    (error) => error === lostTarget,
  );
  assert.deepEqual(observed, ['controlled preflight']);
});

const sparse = {
  url: 'https://example.org/',
  title: 'Example Domain',
  description: null,
  canonical: null,
  social: { title: false, description: false, url: false, type: false, card: false, image: false },
};
const validPane = { scopeValid: true, buttonCount: 1, visible: true };
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
      return { status: 'fail', reason_code: 'SOCIAL_CLIPBOARD_MISMATCH' };
    },
    async () => {
      calls.push('recapture');
      return { status: 'pass' };
    },
  );
  assert.deepEqual(calls, ['copy-failed', 'recapture']);
  assert.deepEqual(result, {
    copyResult: { status: 'fail', reason_code: 'SOCIAL_CLIPBOARD_MISMATCH' },
    recaptureResult: { status: 'pass' },
  });
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

test('actual feedback poll distinguishes a missed icon from a fatal native read', async () => {
  let tick = 0;
  const missed = await pollSocialFeedback(
    async () => ({ ...validPane, check: false, failed: false }),
    {
      timeoutMs: 200,
      intervalMs: 100,
      now: () => tick,
      sleep: async (ms) => {
        tick += ms;
      },
    },
  );
  assert.deepEqual(missed, {
    state: { ...validPane, check: false, failed: false },
    iconObserved: false,
  });

  tick = 0;
  let reads = 0;
  const observed = await pollSocialFeedback(
    async () => {
      reads += 1;
      return { ...validPane, check: reads === 2, failed: false };
    },
    {
      timeoutMs: 200,
      intervalMs: 100,
      now: () => tick,
      sleep: async (ms) => {
        tick += ms;
      },
    },
  );
  assert.deepEqual(observed, {
    state: { ...validPane, check: true, failed: false },
    iconObserved: true,
  });

  tick = 0;
  let clipboardRead = false;
  let recaptureStarted = false;
  await assert.rejects(
    () =>
      runCopyCheckThenRecapture(
        async () => {
          let samples = 0;
          await pollSocialFeedback(
            async () => {
              samples += 1;
              if (samples === 2) throw new Error('lost_target');
              return { ...validPane, check: false, failed: false };
            },
            {
              timeoutMs: 200,
              intervalMs: 100,
              now: () => tick,
              sleep: async (ms) => {
                tick += ms;
              },
            },
          );
          clipboardRead = true;
        },
        async () => {
          recaptureStarted = true;
        },
      ),
    /lost_target/,
  );
  assert.equal(clipboardRead, false);
  assert.equal(recaptureStarted, false);
});

// These are successful native evaluations whose pane/button is unusable, not thrown reads.
for (const invalid of [
  null,
  {},
  { scopeValid: false },
  { buttonCount: 0 },
  { buttonCount: 2 },
  { visible: false },
]) {
  test(`invalid feedback sample aborts before clipboard or T02: ${JSON.stringify(invalid)}`, async () => {
    const sample =
      invalid === null ? null : { ...validPane, ...invalid, check: false, failed: false };
    // Empty/malformed native return must not acquire valid defaults.
    const observation = invalid && Object.keys(invalid).length === 0 ? {} : sample;
    const calls = [];
    await assert.rejects(
      () =>
        runCopyCheckThenRecapture(
          async () => {
            await pollSocialFeedback(async () => observation, { timeoutMs: 0 });
            calls.push('clipboard');
            return { status: 'pass' };
          },
          async () => calls.push('T02'),
        ),
      { code: 'SOCIAL_COPY_TARGET_INVALID' },
    );
    assert.deepEqual(calls, []);
  });
}

test('unclassified returned copy failure cannot authorize T02', async () => {
  let recaptured = false;
  await assert.rejects(
    () =>
      runCopyCheckThenRecapture(
        async () => ({ status: 'fail', reason_code: 'resource_stop' }),
        async () => {
          recaptured = true;
        },
      ),
    /social_copy_result_unclassified/,
  );
  assert.equal(recaptured, false);
});

// Independent expected clipboard for the real example.org public-page use case.
const copiedTags = [
  '<meta property="og:title" content="Example Domain" />',
  '<meta property="og:url" content="https://example.org/" />',
  '<meta property="og:type" content="website" />',
  '<meta name="twitter:card" content="summary_large_image" />',
  '<meta property="og:image" content="https://example.com/your-share-image.png" />',
].join('\n');
const idleFeedback = { ...validPane, check: false, failed: false, idle: true };

for (const scenario of [
  { name: 'valid idle button can pass from actual changed clipboard', status: 'pass' },
  {
    name: 'Check cannot rescue wrong clipboard',
    check: true,
    actual: 'wrong',
    status: 'fail',
    reason: 'SOCIAL_CLIPBOARD_MISMATCH',
  },
  {
    name: 'X cannot pass even with exact changed clipboard',
    failed: true,
    status: 'fail',
    reason: 'SOCIAL_COPY_FAILURE_FEEDBACK',
  },
  {
    name: 'unchanged exact clipboard earns no pass',
    previousClipboard: copiedTags,
    status: 'unverified',
    reason: 'SOCIAL_CLIPBOARD_UNCHANGED',
  },
]) {
  test(`native copy end boundary: ${scenario.name}`, async () => {
    const calls = [];
    const result = await runCopyCheckThenRecapture(
      () =>
        observeSocialCopyOutcome({
          readFeedback: async () => {
            calls.push('feedback');
            return {
              ...idleFeedback,
              check: scenario.check ?? false,
              failed: scenario.failed ?? false,
            };
          },
          readClipboard: async () => {
            calls.push('clipboard');
            return scenario.actual ?? copiedTags;
          },
          source: sparse,
          previousClipboard: scenario.previousClipboard ?? '',
          pollOptions: { timeoutMs: 0 },
        }),
      async () => {
        calls.push('T02');
        return 'recaptured';
      },
    );
    assert.equal(result.copyResult.status, scenario.status);
    assert.equal(result.copyResult.reason_code, scenario.reason);
    assert.equal(result.recaptureResult, 'recaptured');
    assert.deepEqual(calls, ['feedback', 'clipboard', 'feedback', 'T02']);
    if (scenario.status === 'pass')
      assert.deepEqual(result.copyResult.verified, { copiedTags: 5, exactClipboardMatch: true });
    else assert.equal(result.copyResult.verified, undefined);
  });
}

for (const scenario of [
  {
    name: 'invalid pane despite Check',
    first: { ...idleFeedback, scopeValid: false, check: true },
    code: 'SOCIAL_COPY_TARGET_INVALID',
  },
  {
    name: 'missing button despite exact clipboard',
    first: { ...idleFeedback, buttonCount: 0 },
    code: 'SOCIAL_COPY_TARGET_INVALID',
  },
  { name: 'lost target read', error: 'lost_target' },
  { name: 'resource stop read', error: 'resource_stop' },
  { name: 'unexpected read error', error: 'unexpected_native_error' },
  {
    name: 'lost pane during clipboard observation',
    final: { ...idleFeedback, scopeValid: false },
    code: 'SOCIAL_COPY_TARGET_INVALID',
  },
  { name: 'clipboard read lost target', clipboardError: 'lost_target' },
  { name: 'clipboard permission restoration failure', clipboardError: 'permission_restore_failed' },
]) {
  test(`native copy end boundary aborts: ${scenario.name}`, async () => {
    const calls = [];
    let reads = 0;
    await assert.rejects(
      () =>
        runCopyCheckThenRecapture(
          () =>
            observeSocialCopyOutcome({
              readFeedback: async () => {
                calls.push('feedback');
                reads++;
                if (scenario.error) throw new Error(scenario.error);
                return reads === 1
                  ? (scenario.first ?? idleFeedback)
                  : (scenario.final ?? idleFeedback);
              },
              readClipboard: async () => {
                calls.push('clipboard');
                if (scenario.clipboardError) throw new Error(scenario.clipboardError);
                return copiedTags;
              },
              source: sparse,
              previousClipboard: '',
              pollOptions: { timeoutMs: 0 },
            }),
          async () => calls.push('T02'),
        ),
      scenario.code
        ? { code: scenario.code }
        : { message: scenario.error ?? scenario.clipboardError },
    );
    assert.equal(calls.includes('T02'), false);
    assert.deepEqual(
      calls,
      scenario.final
        ? ['feedback', 'clipboard', 'feedback']
        : scenario.clipboardError
          ? ['feedback', 'clipboard']
          : ['feedback'],
    );
  });
}

test('unexpected source failure is not isolated as a clipboard mismatch', async () => {
  let recaptured = false;
  await assert.rejects(
    () =>
      runCopyCheckThenRecapture(
        () =>
          observeSocialCopyOutcome({
            readFeedback: async () => idleFeedback,
            readClipboard: async () => copiedTags,
            source: { ...sparse, title: null },
            previousClipboard: '',
            pollOptions: { timeoutMs: 0 },
          }),
        async () => {
          recaptured = true;
        },
      ),
    /source must expose a missing social title/,
  );
  assert.equal(recaptured, false);
});
