import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runAfterEffectiveHostDenial,
  waitForRecoveryOutcome,
} from './scrape-recovery-failure-diagnostic.mjs';

test('T14 wait failure records only bounded pane, capture, and host categories', async () => {
  let snapshot;
  const state = {
    ready: true,
    scrapeTabActive: true,
    scrapePaneActive: true,
    error: false,
    permissionMessage: false,
    tryAgain: 0,
    reloadPage: 0,
    deepTitles: ['private-page-title'],
    deepCaptureInProgress: true,
    deepScrollProgressPresent: true,
    resultPresent: false,
    resultText: 'private-page-text',
    fixtureTitle: 'private-page-title',
    rawError: 'private-error',
  };
  await assert.rejects(
    waitForRecoveryOutcome({
      readState: async () => state,
      readObservedHostAccess: async () => 'ON_CLICK',
      now: () => 500,
      onFailure: (value) => {
        snapshot = value;
      },
      wait: async (_label, read, accept) => {
        assert.equal(accept(await read()), false);
        throw new Error('scrape_recovery_capture_outcome_not_observed');
      },
    }),
    /scrape_recovery_capture_outcome_not_observed/,
  );
  assert.equal(snapshot.phase, 'capture_outcome_wait');
  assert.equal(snapshot.stage, 'deep_scroll_in_progress');
  assert.equal(Number.isInteger(snapshot.elapsed_ms), true);
  assert.deepEqual(
    { ...snapshot, elapsed_ms: undefined },
    {
      phase: 'capture_outcome_wait',
      stage: 'deep_scroll_in_progress',
      elapsed_ms: undefined,
      deep_mode_seen: true,
      deep_scroll_progress_seen: true,
      deep_scroll_progress_finished: false,
      deep_scroll_first_progress_ms: 0,
      deep_scroll_finished_ms: null,
      capture_wait_ms: null,
      scrape_tab_active: true,
      scrape_pane_active: true,
      error_present: false,
      permission_message_present: false,
      try_again_present: false,
      reload_page_present: false,
      deep_control_present: true,
      deep_capture_in_progress: true,
      result_present: false,
      expected_host_access: 'ON_ALL_SITES',
      observed_host_access: 'ON_CLICK',
    },
  );
  assert.equal(JSON.stringify(snapshot).includes('private-'), false);
});

test('T14 proceeds only after the effective injection probe observes denial', () => {
  let clicked = false;
  return runAfterEffectiveHostDenial(
    async () => 'denied',
    async () => {
      clicked = true;
    },
  )
    .then((result) => {
      assert.deepEqual(result, { access: 'denied', value: undefined });
      assert.equal(clicked, true);
    })
    .then(async () => {
      clicked = false;
      await assert.rejects(
        runAfterEffectiveHostDenial(
          async () => 'available',
          async () => {
            clicked = true;
          },
        ),
        /effective_access_available/,
      );
      await assert.rejects(
        runAfterEffectiveHostDenial(
          async () => 'unknown',
          async () => {
            clicked = true;
          },
        ),
        /effective_access_unknown/,
      );
      await assert.rejects(
        runAfterEffectiveHostDenial(
          async () => 'private-error-text',
          async () => {
            clicked = true;
          },
        ),
        /effective_access_unknown/,
      );
      assert.equal(clicked, false);
    });
});

test('T14 timeout records scroll completion before capture without retaining page text', async () => {
  let snapshot;
  const states = [
    {
      ready: true,
      error: false,
      resultPresent: false,
      deepCaptureInProgress: true,
      deepScrollProgressPresent: true,
    },
    {
      ready: true,
      error: false,
      resultPresent: false,
      deepCaptureInProgress: true,
      deepScrollProgressPresent: false,
    },
  ];
  const clock = [100, 102, 110];
  await assert.rejects(
    waitForRecoveryOutcome({
      readState: async () => states.shift(),
      readObservedHostAccess: async () => 'ON_CLICK',
      now: () => clock.shift(),
      onFailure: (value) => {
        snapshot = value;
      },
      wait: async (_label, read, accept, _timeout, diagnostic) => {
        await read();
        const last = await read();
        assert.equal(accept(last), false);
        assert.deepEqual(diagnostic(last), { phase: 'capture_after_deep_scroll' });
        throw new Error('scrape_recovery_capture_outcome_not_observed');
      },
    }),
    /scrape_recovery_capture_outcome_not_observed/,
  );
  assert.equal(snapshot.deep_scroll_progress_seen, true);
  assert.equal(snapshot.deep_scroll_progress_finished, true);
  assert.equal(snapshot.stage, 'capture_after_deep_scroll');
  assert.equal(snapshot.elapsed_ms, 10);
  assert.equal(snapshot.deep_scroll_first_progress_ms, 2);
  assert.equal(snapshot.deep_scroll_finished_ms, 10);
  assert.equal(snapshot.capture_wait_ms, 0);
});

test('T14 wait accepts either error or result and emits no failure diagnostic', async () => {
  for (const terminal of [
    { ready: true, error: true, resultPresent: false },
    { ready: true, error: false, resultPresent: true },
  ]) {
    let snapshot = null;
    const states = [{ ready: true, error: false, resultPresent: false }, terminal];
    const result = await waitForRecoveryOutcome({
      readState: async () => states.shift(),
      readObservedHostAccess: async () => {
        throw new Error('must not read host after success');
      },
      onFailure: (value) => {
        snapshot = value;
      },
      wait: async (_label, read, accept) => {
        const first = await read();
        assert.equal(accept(first), false);
        const second = await read();
        assert.equal(accept(second), true);
        return second;
      },
    });
    assert.equal(result.error, terminal.error);
    assert.equal(result.resultPresent, terminal.resultPresent);
    assert.equal(snapshot, null);
  }
});

test('T14 failure snapshot rejects unbounded field types and host values', async () => {
  let snapshot;
  await assert.rejects(
    waitForRecoveryOutcome({
      readState: async () => ({
        ready: false,
        scrapeTabActive: 'private-tab',
        scrapePaneActive: { secret: 'private-pane' },
        error: 'private-error',
        tryAgain: { secret: 'private-control' },
        deepTitles: 'private-titles',
        deepCaptureInProgress: 'private-progress',
        resultPresent: { secret: 'private-result' },
      }),
      readObservedHostAccess: async () => 'private-host',
      onFailure: (value) => {
        snapshot = value;
      },
      wait: async (_label, read) => {
        await read();
        throw new Error('wait-ended');
      },
    }),
    /wait-ended/,
  );
  assert.equal(snapshot.observed_host_access, 'unknown');
  assert.equal(snapshot.scrape_tab_active, null);
  assert.equal(snapshot.scrape_pane_active, null);
  assert.equal(snapshot.error_present, null);
  assert.equal(snapshot.try_again_present, null);
  assert.equal(snapshot.deep_control_present, null);
  assert.equal(snapshot.deep_capture_in_progress, null);
  assert.equal(snapshot.result_present, null);
  assert.equal(JSON.stringify(snapshot).includes('private-'), false);
});
