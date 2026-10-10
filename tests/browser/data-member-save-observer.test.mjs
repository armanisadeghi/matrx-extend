import assert from 'node:assert/strict';
import test from 'node:test';
import { observePatternWrites } from './data-member-save-observer.mjs';

const origin = 'https://db.matrxserver.com';
const selectedOrganizationId = '123e4567-e89b-42d3-a456-426614174001';
const otherOrganizationId = '123e4567-e89b-42d3-a456-426614174002';
const patternId = '123e4567-e89b-42d3-a456-426614174000';
const name = 'Northline Furnishings catalog member 38009889306-1';

function panelFixture(requestBody) {
  const listeners = new Map();
  const panel = {
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    async send(method) {
      if (method === 'Network.getRequestPostData') return { postData: requestBody };
      if (method === 'Network.getResponseBody') return { body: JSON.stringify({ id: patternId }) };
      throw new Error('unexpected_cdp_method');
    },
  };
  return {
    panel,
    listeners,
    async write({ inlineBody = false, organizationId = selectedOrganizationId } = {}) {
      const body = JSON.stringify({ organization_id: organizationId, name });
      listeners.get('Network.requestWillBeSent')({
        requestId: 'owned-write',
        request: {
          url: `${origin}/rest/v1/wbx_pattern`,
          method: 'POST',
          headers: {},
          ...(inlineBody ? { postData: body } : {}),
        },
      });
      listeners.get('Network.responseReceived')({
        requestId: 'owned-write',
        response: { status: 201 },
      });
      listeners.get('Network.loadingFinished')({ requestId: 'owned-write' });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('member save observer verifies request body org and returned row without requiring a header', async () => {
  const fixture = panelFixture(JSON.stringify({ organization_id: selectedOrganizationId, name }));
  const observer = observePatternWrites(fixture.panel, origin, selectedOrganizationId, name);
  await fixture.write();
  assert.deepEqual(observer.snapshot(), [
    {
      status: 201,
      failed: false,
      patternIdPresent: true,
      bodyCapture: 'body_id_valid',
      requestBodyCapture: 'request_body_valid',
      requestOrganizationPresent: true,
      requestNameMatches: true,
      requestOrganizationMatchesSelected: true,
      headerOrganizationPresent: false,
    },
  ]);
  assert.deepEqual(observer.writeTarget(), {
    patternId,
    organizationId: selectedOrganizationId,
  });
  observer.stop();
  assert.equal(fixture.listeners.size, 0);
});

test('member save observer exposes a wrong posted org even when the insert returns 201', async () => {
  const fixture = panelFixture(JSON.stringify({ organization_id: otherOrganizationId, name }));
  const observer = observePatternWrites(fixture.panel, origin, selectedOrganizationId, name);
  await fixture.write({ inlineBody: true, organizationId: otherOrganizationId });
  assert.equal(observer.snapshot()[0].requestOrganizationMatchesSelected, false);
  assert.deepEqual(observer.writeTarget(), { patternId, organizationId: otherOrganizationId });
  observer.stop();
});
