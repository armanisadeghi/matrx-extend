import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_BACKEND_ORIGIN,
  observeMemberLogicalOrganizationGet,
  refreshMemberLogicalOrganizationGet,
} from './member-logical-org-proof.mjs';
import { ORGANIZATION_ID, organizationProbePanel } from './showcase-organization-probe.mjs';

// SUT owns real trusted click ordering, arming, header/principal joining and response completion.
// Only CDP/remote HTTP are controlled; a missing Records click cannot manufacture the receipt.
for (const [scenario, failure] of [
  ['ladder', null],
  ['wrong_header', /organization_mismatch/],
  ['missing_header', /organization_mismatch/],
  ['wrong_bearer', /organization_unauthenticated/],
  ['failed_response', /organization_get_failed/],
]) {
  test(`member proof through current Records door: ${scenario}`, async () => {
    const base = organizationProbePanel(scenario);
    const panel = {
      ...base,
      send: (method, params) =>
        method === 'Runtime.evaluate' &&
        params.expression.includes('const kind = "chat-compute-trigger"')
          ? Promise.resolve({
              result: { value: { count: 0, matchedCount: 0, visibleMatchCount: 0 } },
            })
          : base.send(method, params),
    };
    const proof = observeMemberLogicalOrganizationGet(
      panel,
      ORGANIZATION_ID,
      PRODUCTION_BACKEND_ORIGIN,
    );
    try {
      await proof.start();
      await refreshMemberLogicalOrganizationGet(panel, proof);
      if (failure) await assert.rejects(() => proof.verify(20), failure);
      else
        assert.deepEqual(await proof.verify(20), {
          request_observed: true,
          authenticated: true,
          organization_matches_expected: true,
          http_status: 200,
        });
    } finally {
      proof.stop();
    }
  });
}

for (const target of ['title', 'tool-row']) {
  test(`member Records proof retains safe target/counts for ${target} refusal`, async () => {
    const diagnostics = [];
    let armed = false;
    await assert.rejects(() =>
      refreshMemberLogicalOrganizationGet(
        organizationProbePanel('ladder'),
        {
          arm() {
            armed = true;
          },
        },
        async (_panel, kind) => {
          if (kind !== target) return;
          const error = new Error('private-credential-do-not-record');
          error.driverFailure = {
            code: 'pointer_target_not_unique',
            matchedTargetCount: 0,
            visibleMatchCount: 0,
            raw: 'private-credential-do-not-record',
          };
          throw error;
        },
        (value) => diagnostics.push(value),
      ),
    );
    assert.equal(armed, target === 'tool-row');
    assert.deepEqual(diagnostics.at(-1), {
      phase: 'logical_organization_request',
      target: target === 'title' ? 'organization_tools_click' : 'organization_records_click',
      matched_target_count: 0,
      visible_target_count: 0,
    });
    assert.equal(JSON.stringify(diagnostics).includes('private-credential'), false);
  });
}
