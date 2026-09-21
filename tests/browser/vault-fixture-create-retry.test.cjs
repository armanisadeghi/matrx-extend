'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createFixtureSetupWithRetry } = require('./vault-fixture-create-retry.cjs');

const API_BODY = JSON.stringify({
  principal: { type: 'user' },
  display_name: 'Harbor Dental new-patient appointment portal',
  definition_key: 'website_login',
});
const IDEMPOTENCY_KEY = '2b77d077-62b4-4ffb-aa32-75410e46c40f';

async function withFixtureServer(plannedResponses, run) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      key: request.headers['idempotency-key'],
      body,
    });
    const next = plannedResponses[requests.length - 1];
    assert.ok(next, 'server received an unplanned request');
    response.writeHead(next.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(next.body));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await run({
      url: `http://127.0.0.1:${server.address().port}/api/vault/items`,
      requests,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function requestFixture(url, journal) {
  const delays = [];
  const retryRecords = [];
  const result = await createFixtureSetupWithRetry({
    url,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': IDEMPOTENCY_KEY },
    body: API_BODY,
    fetchImpl: fetch,
    journalRequest: (entry) =>
      journal.push({ method: entry.method, url: entry.url, key: entry.headers['Idempotency-Key'] }),
    recordRetry: (retry) => retryRecords.push(retry),
    wait: async (milliseconds) => delays.push(milliseconds),
  });
  return { result, delays, retryRecords };
}

test('fixture setup retries only canonical transient 503 and journals each identical request', async () => {
  await withFixtureServer(
    [
      { status: 503, body: { error: { code: 'idempotency_retryable' } } },
      { status: 201, body: { id: 'owned-fixture' } },
    ],
    async ({ url, requests }) => {
      const journal = [];
      const { result, delays, retryRecords } = await requestFixture(url, journal);
      assert.equal(result.response.status, 201);
      assert.deepEqual(result.setupRetry, { status: 503, count: 1 });
      assert.deepEqual(delays, [1000]);
      assert.deepEqual(retryRecords, [{ status: 503, count: 1 }]);
      assert.deepEqual(requests, [
        { method: 'POST', url: '/api/vault/items', key: IDEMPOTENCY_KEY, body: API_BODY },
        { method: 'POST', url: '/api/vault/items', key: IDEMPOTENCY_KEY, body: API_BODY },
      ]);
      assert.deepEqual(journal, [
        { method: 'POST', url, key: IDEMPOTENCY_KEY },
        { method: 'POST', url, key: IDEMPOTENCY_KEY },
      ]);
    },
  );
});

test('fixture setup does not retry a 400 response', async () => {
  await withFixtureServer(
    [{ status: 400, body: { error: { code: 'invalid_fixture' } } }],
    async ({ url, requests }) => {
      const journal = [];
      const { result, delays, retryRecords } = await requestFixture(url, journal);
      assert.equal(result.response.status, 400);
      assert.deepEqual(result.setupRetry, { status: null, count: 0 });
      assert.deepEqual(delays, []);
      assert.deepEqual(retryRecords, []);
      assert.equal(requests.length, 1);
      assert.equal(journal.length, 1);
    },
  );
});

test('fixture setup does not retry a 503 with another error code', async () => {
  await withFixtureServer(
    [{ status: 503, body: { error: { code: 'server_busy' } } }],
    async ({ url, requests }) => {
      const journal = [];
      const { result, delays, retryRecords } = await requestFixture(url, journal);
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.setupRetry, { status: null, count: 0 });
      assert.deepEqual(delays, []);
      assert.deepEqual(retryRecords, []);
      assert.equal(requests.length, 1);
      assert.equal(journal.length, 1);
    },
  );
});

test('fixture setup does not retry an unknown transport result', async () => {
  const journal = [];
  const delays = [];
  await assert.rejects(
    () =>
      createFixtureSetupWithRetry({
        url: 'http://127.0.0.1:1/api/vault/items',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': IDEMPOTENCY_KEY },
        body: API_BODY,
        fetchImpl: async () => {
          throw new Error('fixture transport outcome unknown');
        },
        journalRequest: (entry) => journal.push(entry.method),
        wait: async (milliseconds) => delays.push(milliseconds),
      }),
    /fixture transport outcome unknown/,
  );
  assert.deepEqual(journal, ['POST']);
  assert.deepEqual(delays, []);
});

test('fixture setup fails after three canonical retryable responses', async () => {
  await withFixtureServer(
    [
      { status: 503, body: { error: { code: 'idempotency_retryable' } } },
      { status: 503, body: { error: { code: 'idempotency_retryable' } } },
      { status: 503, body: { error: { code: 'idempotency_retryable' } } },
    ],
    async ({ url, requests }) => {
      const journal = [];
      const { result, delays, retryRecords } = await requestFixture(url, journal);
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.setupRetry, { status: 503, count: 2 });
      assert.deepEqual(delays, [1000, 1000]);
      assert.deepEqual(retryRecords, [
        { status: 503, count: 1 },
        { status: 503, count: 2 },
      ]);
      assert.equal(requests.length, 3);
      assert.equal(journal.length, 3);
      assert.ok(
        requests.every((request) => request.key === IDEMPOTENCY_KEY && request.body === API_BODY),
      );
    },
  );
});
