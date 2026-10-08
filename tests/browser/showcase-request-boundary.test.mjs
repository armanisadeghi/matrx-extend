import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeD47Failure } from './showcase-d47-driver-evidence.mjs';
import { runShowcaseOrganizationCheckpoint } from './showcase-organization-checkpoint.mjs';
import {
  ORGANIZATION_ID,
  organizationProbePanel,
  probeAuth,
} from './showcase-organization-probe.mjs';

const secret = 'private-boundary-value';

// SUT owns registration, native click ordering, evidence capture and cleanup. Only CDP fails.
async function probe(failure) {
  const base = organizationProbePanel('ladder');
  const report = {};
  const events = [];
  let kind;
  let now = Date.now();
  const originalClock = Date.now;
  const panel = {
    on(event, listener) {
      events.push(`register:${event}`);
      if (failure === event) throw new Error(secret);
      const off = base.on(event, (payload) => {
        if (failure === 'unfinished' && event === 'Network.loadingFinished') return;
        if (failure === 'absent') return;
        listener(payload);
      });
      return () => {
        off();
        events.push(`remove:${event}`);
        if (failure === 'cleanup') throw new Error(secret);
      };
    },
    async send(method, parameters) {
      if (method === 'Runtime.evaluate') {
        const expression = parameters.expression;
        if (expression.includes('crypto.subtle.digest') && failure === 'bearer')
          throw new Error(secret);
        kind = /const kind = "([^"]+)"/.exec(expression)?.[1] ?? kind;
        if (failure === kind) throw new Error(secret);
        if (failure === 'ambiguous_tools' && kind === 'title')
          return { result: { value: { count: 2 } } };
        if (kind === 'tool-row' && ['missing_records', 'ambiguous_records'].includes(failure)) {
          const count = failure === 'missing_records' ? 0 : 2;
          return { result: { value: { count, matchedCount: count, toolsPanelActive: true } } };
        }
      }
      if (method === 'Network.enable' && failure === 'enable') throw new Error(secret);
      const result = await base.send(method, parameters);
      if (
        method === 'Input.dispatchMouseEvent' &&
        parameters.type === 'mouseReleased' &&
        kind === 'tool-row' &&
        ['absent', 'unfinished'].includes(failure)
      ) {
        // Only the request wait clock advances: pointer readiness remains real.
        Date.now = () => {
          now += 31_000;
          return now;
        };
      }
      return result;
    },
  };
  let error;
  try {
    await runShowcaseOrganizationCheckpoint({
      panel,
      auth: probeAuth,
      resourceAction: (action) => {
        if (report.organization_diagnostic.substage === failure) throw new Error(secret);
        return action();
      },
      report,
      requiredOrganizationName: "Matrx's Org",
      requiredOrganizationId: ORGANIZATION_ID,
    });
  } catch (caught) {
    error = caught;
  } finally {
    Date.now = originalClock;
  }
  return { report, error, events };
}

for (const [failure, stage, code] of [
  ['bearer', 'organization_bearer_read', 'organization_bearer_read_failed'],
  [
    'Network.requestWillBeSent',
    'organization_observer_request',
    'organization_observer_request_failed',
  ],
  [
    'Network.responseReceived',
    'organization_observer_response',
    'organization_observer_response_failed',
  ],
  [
    'Network.loadingFinished',
    'organization_observer_finished',
    'organization_observer_finished_failed',
  ],
  ['Network.loadingFailed', 'organization_observer_failed', 'organization_observer_failed_failed'],
  ['enable', 'organization_observer_enable', 'organization_observer_enable_failed'],
  ['organization_tools_gate', 'organization_tools_gate', 'organization_tools_gate_failed'],
  ['title', 'organization_tools_click', 'pointer_initial_evaluation_failed'],
  ['ambiguous_tools', 'organization_tools_click', 'pointer_target_not_unique'],
  ['organization_records_gate', 'organization_records_gate', 'organization_records_gate_failed'],
  ['tool-row', 'organization_records_click', 'pointer_initial_evaluation_failed'],
  ['missing_records', 'organization_records_click', 'pointer_target_not_unique'],
  ['ambiguous_records', 'organization_records_click', 'pointer_target_not_unique'],
  ['absent', 'organization_request_wait', 'showcase_product_organization_request_not_observed'],
  ['unfinished', 'organization_request_wait', 'showcase_product_organization_request_not_observed'],
  ['cleanup', 'organization_observer_cleanup', 'organization_observer_cleanup_failed'],
]) {
  test(`real checkpoint retains safe ${stage} failure and releases registered listeners`, async () => {
    const { report, error, events } = await probe(failure);
    assert.ok(error, 'a failed boundary must not pass acceptance');
    const diagnostic = report.organization_diagnostic;
    assert.equal(diagnostic.substage, stage);
    assert.equal(diagnostic.failure_code, code);
    assert.notEqual(sanitizeD47Failure(error, 'organization').message_code, 'unclassified_error');
    const receipt = JSON.stringify({
      ...report,
      failure: sanitizeD47Failure(error, 'organization'),
    });
    assert.equal(receipt.includes(secret), false);
    assert.equal(receipt.includes(ORGANIZATION_ID), false);
    assert.equal(receipt.includes('opaque-test-token'), false);
    const registered = events.filter((event) => event.startsWith('register:')).length;
    const removed = events.filter((event) => event.startsWith('remove:')).length;
    assert.equal(removed, registered - (failure.startsWith('Network.') ? 1 : 0));
    if (failure === 'unfinished') {
      assert.equal(diagnostic.observations.product_request_observed, true);
      assert.equal(diagnostic.observations.product_response_observed, true);
      assert.equal(diagnostic.observations.product_header_matches, true);
      assert.equal(diagnostic.observations.product_principal_matches, true);
      assert.equal(diagnostic.observations.product_response_finished, false);
      assert.equal(diagnostic.observations.product_response_success, false);
    }
    if (failure === 'absent') {
      assert.equal(diagnostic.observations.product_request_observed, false);
      assert.equal(diagnostic.observations.product_response_observed, false);
    }
    if (failure === 'missing_records' || failure === 'ambiguous_records') {
      const count = failure === 'missing_records' ? 0 : 2;
      assert.equal(diagnostic.observations.records_target_match_count, count);
      assert.equal(diagnostic.observations.records_target_visible_count, count);
      assert.equal(diagnostic.observations.tools_panel_active, true);
      assert.equal(diagnostic.observations.product_request_observed, false);
    }
  });
}

test('successful real checkpoint remains accepted without device-choice injection', async () => {
  const { report, error } = await probe(null);
  assert.equal(error, undefined);
  assert.equal(report.organization_diagnostic.substage, 'organization_identity_compare');
  assert.equal(report.organization_diagnostic.observations.storage_has_uuid, false);
  assert.equal(report.organization_diagnostic.observations.product_response_success, true);
});
