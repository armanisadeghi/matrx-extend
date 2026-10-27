import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('Records diagnostic failure cannot replace the primary click exception', async () => {
  for (const thrown of [
    Object.freeze(
      Object.defineProperty(new Error('pointer primary'), 'driverFailure', {
        get() {
          throw new Error('private getter');
        },
      }),
    ),
    'pointer primary',
  ]) {
    let clickEvents = 0;
    await assert.rejects(
      () =>
        refreshMemberLogicalOrganizationGet(
          {},
          { arm() {} },
          async () => {
            throw thrown;
          },
          (value) => {
            if (value.target === 'organization_tools_click' && ++clickEvents === 2)
              throw new Error('diagnostic callback');
          },
        ),
      (caught) => caught === thrown,
    );
    assert.equal(clickEvents, 2);
  }
});

test('Records failure callback rejection cannot escape the primary click exception', () => {
  const moduleUrl = new URL('./member-logical-org-proof.mjs', import.meta.url).href;
  const script = `
    const { refreshMemberLogicalOrganizationGet } = await import(${JSON.stringify(moduleUrl)});
    let visits = 0;
    const primary = new Error('pointer primary');
    try {
      await refreshMemberLogicalOrganizationGet({}, { arm() {} }, async () => { throw primary; },
        value => { if (value.target === 'organization_tools_click' && ++visits === 2) return Promise.reject(new Error('callback rejected')); });
      process.exit(3);
    } catch (error) { if (error !== primary) process.exit(4); }
    await new Promise(resolve => setImmediate(resolve));
  `;
  const result = spawnSync(
    process.execPath,
    ['--unhandled-rejections=strict', '--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('Records stage reporting failures cannot prevent the primary click', () => {
  const moduleUrl = new URL('./member-logical-org-proof.mjs', import.meta.url).href;
  for (const mode of ['throw', 'reject']) {
    const script = `
      const { refreshMemberLogicalOrganizationGet } = await import(${JSON.stringify(moduleUrl)});
      const primary = new Error('pointer primary');
      let clicks = 0;
      try {
        await refreshMemberLogicalOrganizationGet({}, { arm() {} }, async () => { clicks++; throw primary; },
          () => { if (${JSON.stringify(mode)} === 'throw') throw new Error('callback'); return Promise.reject(new Error('callback')); });
        process.exit(3);
      } catch (error) { if (error !== primary || clicks !== 1) process.exit(4); }
      await new Promise(resolve => setImmediate(resolve));
    `;
    const result = spawnSync(
      process.execPath,
      ['--unhandled-rejections=strict', '--input-type=module', '-e', script],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
  }
});
