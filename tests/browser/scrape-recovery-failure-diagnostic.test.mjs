import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForRecoveryOutcome } from './scrape-recovery-failure-diagnostic.mjs';

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
    resultPresent: false,
    resultText: 'private-page-text',
    fixtureTitle: 'private-page-title',
    rawError: 'private-error',
  };
  await assert.rejects(
    waitForRecoveryOutcome({
      readState: async () => state,
      readObservedHostAccess: async () => 'ON_CLICK',
      onFailure: (value) => {
        snapshot = value;
      },
      wait: async (_label, read, accept) => {
        assert.equal(accept(await read()), false);
        throw new Error('scrape_recovery_permission_denial_or_capture_not_observed');
      },
    }),
    /scrape_recovery_permission_denial_or_capture_not_observed/,
  );
  assert.deepEqual(snapshot, {
    phase: 'permission_denial_or_capture_wait',
    scrape_tab_active: true,
    scrape_pane_active: true,
    error_present: false,
    permission_message_present: false,
    try_again_present: false,
    reload_page_present: false,
    deep_control_present: true,
    deep_capture_in_progress: true,
    result_present: false,
    expected_host_access: 'ON_CLICK',
    observed_host_access: 'ON_CLICK',
  });
  assert.equal(JSON.stringify(snapshot).includes('private-'), false);
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
    assert.deepEqual(result, terminal);
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
