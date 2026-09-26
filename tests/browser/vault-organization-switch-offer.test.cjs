'use strict';

const assert = require('node:assert/strict');
const { runOrganizationSwitchOfferProbe } = require('./vault-organization-switch-offer.cjs');

const harnessAssert = (condition, code) => {
  if (!condition) throw new Error(code);
};

function harness({
  cleanupFailure = false,
  malformedHandshake = false,
  competingFocus = false,
} = {}) {
  const calls = [];
  let pageClosed = false;
  let switched = 0;
  const page = {
    goto: async () => {},
    bringToFront: async () => {},
    evaluate: async () => true,
    isClosed: () => pageClosed,
    close: async () => {
      pageClosed = true;
    },
  };
  const panel = {
    evaluate: async (expression) => {
      if (expression.includes('chrome.runtime.connect'))
        return malformedHandshake ? 'malformed-id' : 'a'.repeat(36);
      if (expression.includes('"operation":"discover"'))
        return {
          status: 'ready',
          offers: [{ id: switched ? 'fresh-offer' : 'raw-offer', expiresAt: Date.now() + 15_000 }],
        };
      if (expression.includes('"operation":"use"')) return { status: 'stale' };
      if (expression.includes('__vaultOrganizationSwitchOfferPort')) {
        if (cleanupFailure) throw new Error('forced_port_close_failure');
        calls.push('port_closed');
        return true;
      }
      throw new Error(`unexpected panel expression: ${expression}`);
    },
  };
  return {
    calls,
    run: () =>
      runOrganizationSwitchOfferProbe({
        context: { newPage: async () => page },
        worker: {
          evaluate: async (fn) => {
            const source = String(fn);
            if (source.includes('chrome.tabs.query')) return 7;
            if (source.includes('__vaultOrganizationSwitchFocusWitness?.counts'))
              return {
                windowFocus: competingFocus ? 1 : 0,
                windowRemoved: 0,
                tabActivated: 0,
                tabChanged: 0,
                navigation: 0,
                tabRemoved: 0,
                orgChange: 1,
                authChange: 0,
                profileChange: 0,
              };
            return true;
          },
        },
        panel,
        wait: async () => {},
        assert: harnessAssert,
        focusOwnedBrowser: async (tabId) => calls.push(`focused:${tabId}`),
        switchOrganization: async ({ tabId, offerExpiresAt }) => {
          assert.equal(tabId, 7);
          assert.ok(offerExpiresAt >= Date.now() + 9_000);
          switched += 1;
        },
      }),
    switched: () => switched,
  };
}

(async () => {
  const successful = harness();
  const evidence = await successful.run();
  assert.equal(successful.switched(), 1);
  assert.deepEqual(
    {
      offerDiscoveredWithGenerousTtl: evidence.offerDiscoveredWithGenerousTtl,
      organizationSwitchInvoked: evidence.organizationSwitchInvoked,
      newActorOfferReady: evidence.newActorOfferReady,
      noCompetingBrowserInvalidation: evidence.noCompetingBrowserInvalidation,
      staleResponse: evidence.staleResponse,
      fieldsUnchanged: evidence.fieldsUnchanged,
      noWebsiteSubmission: evidence.noWebsiteSubmission,
      portClosed: evidence.portClosed,
      ownedFixturePageClosed: evidence.ownedFixturePageClosed,
      ownedFixtureServerClosed: evidence.ownedFixtureServerClosed,
      focusWitnessDisposed: evidence.focusWitnessDisposed,
    },
    {
      offerDiscoveredWithGenerousTtl: true,
      organizationSwitchInvoked: true,
      newActorOfferReady: true,
      noCompetingBrowserInvalidation: true,
      staleResponse: true,
      fieldsUnchanged: true,
      noWebsiteSubmission: true,
      portClosed: true,
      ownedFixturePageClosed: true,
      ownedFixtureServerClosed: true,
      focusWitnessDisposed: true,
    },
  );
  assert.ok(successful.calls.includes('port_closed'));

  const failingCleanup = harness({ cleanupFailure: true });
  await assert.rejects(failingCleanup.run(), /organization_switch_offer_probe_cleanup_failed/);
  assert.equal(failingCleanup.switched(), 1);
  const malformed = harness({ malformedHandshake: true });
  await assert.rejects(malformed.run(), /organization_switch_port_handshake_missing/);
  assert.ok(malformed.calls.includes('port_closed'));
  const lostFocus = harness({ competingFocus: true });
  await assert.rejects(lostFocus.run(), /organization_switch_competing_invalidation_observed/);
  process.stdout.write(
    'PASS: organization switch probe requires stale raw offer use and closes custody\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
