'use strict';

const MAX_SETUP_ATTEMPTS = 3;
const SETUP_RETRY_DELAY_MS = 1000;

async function hasCanonicalRetryableResponse(response) {
  if (response.status !== 503) return false;
  try {
    const payload = await response.json();
    return payload?.error?.code === 'idempotency_retryable';
  } catch {
    return false;
  }
}

async function createFixtureSetupWithRetry({
  url,
  headers,
  body,
  fetchImpl,
  journalRequest,
  recordRetry,
  wait,
}) {
  const requestHeaders = Object.freeze({ ...headers });
  const request = Object.freeze({ method: 'POST', headers: requestHeaders, body });
  let retryCount = 0;
  for (let attempt = 1; attempt <= MAX_SETUP_ATTEMPTS; attempt += 1) {
    journalRequest({ url, method: request.method, headers: request.headers });
    const response = await fetchImpl(url, request);
    if (!(await hasCanonicalRetryableResponse(response)) || attempt === MAX_SETUP_ATTEMPTS) {
      return { response, setupRetry: { status: retryCount ? 503 : null, count: retryCount } };
    }
    retryCount += 1;
    recordRetry?.({ status: response.status, count: retryCount });
    await wait(SETUP_RETRY_DELAY_MS);
  }
  throw new Error('fixture_setup_retry_loop_unreachable');
}

module.exports = { createFixtureSetupWithRetry };
