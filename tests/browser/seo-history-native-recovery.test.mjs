import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifySeoHistoryRequest,
  requireSeoHistoryRecovery,
} from './seo-history-native-recovery.mjs';

const pageUrl = 'http://127.0.0.1:42123/seo-metadata-article';
const request = (url = pageUrl) => ({
  method: 'GET',
  url: `https://db.invalid/rest/v1/wbx_seo_audit?select=id%2Curl&url=eq.${encodeURIComponent(url)}`,
  headers: { 'Accept-Profile': 'extend' },
});

test('only the owned URL history read can receive the controlled refusal', () => {
  assert.equal(classifySeoHistoryRequest(request(), pageUrl), true);
  assert.equal(classifySeoHistoryRequest(request('http://127.0.0.1:42123/other'), pageUrl), false);
  assert.equal(classifySeoHistoryRequest({ ...request(), method: 'POST' }, pageUrl), false);
  assert.equal(classifySeoHistoryRequest({ ...request(), headers: {} }, pageUrl), false);
});

test('native T06 verdict requires error UI then a second read and empty UI', () => {
  const failure = {
    linked: true,
    toggleCount: 1,
    expanded: true,
    alert: true,
    retryCount: 1,
    empty: false,
    loading: false,
  };
  const recovered = {
    linked: true,
    toggleCount: 1,
    expanded: true,
    alert: false,
    retryCount: 0,
    empty: true,
    loading: false,
  };
  const loading = { ...failure, alert: false, retryCount: 0, loading: true };
  assert.deepEqual(
    requireSeoHistoryRecovery(failure, loading, recovered, { failed: 1, succeeded: 1 }),
    {
      errorRendered: true,
      retryFreshRead: true,
      emptyRendered: true,
    },
  );
  assert.throws(() =>
    requireSeoHistoryRecovery(failure, loading, recovered, { failed: 1, succeeded: 0 }),
  );
  assert.throws(() =>
    requireSeoHistoryRecovery({ ...failure, alert: false }, loading, recovered, {
      failed: 1,
      succeeded: 1,
    }),
  );
  assert.throws(() =>
    requireSeoHistoryRecovery(
      failure,
      loading,
      { ...recovered, alert: true },
      { failed: 1, succeeded: 1 },
    ),
  );
  assert.throws(() =>
    requireSeoHistoryRecovery(failure, { ...loading, loading: false }, recovered, {
      failed: 1,
      succeeded: 1,
    }),
  );
});
