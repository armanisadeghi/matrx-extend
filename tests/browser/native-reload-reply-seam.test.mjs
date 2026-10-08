import assert from 'node:assert/strict';
import test from 'node:test';
import { reloadCase } from './native-reload-fixture.mjs';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';

test('replacement target and context remain accepted across callback outcomes', async () => {
  for (const [openReply, category] of [
    [{ ok: true, result: { opened: false, reason: 'private URL token' } }, 'open_refused'],
    [{ ok: false, error: 'private URL token' }, 'rpc_refused'],
    [null, 'reply_not_observed'],
    ['malformed', 'malformed_reply'],
  ]) {
    const result = await reloadCase({
      initiallyEnabled: true,
      openReply,
      expectedCategory: category,
    });
    assert.equal(result.panel_replaced, true);
    assert.equal(result.context_boundary.exact_expected_appeared, true);
    const captured = captureLifecycleEvidence(result.retirement_evidence);
    assert.equal(captured.open_panel_request.category, category);
    assert.doesNotMatch(JSON.stringify(captured), /private|token/);
  }
});

test('late callback cannot hold replacement target acceptance', async () => {
  const result = await reloadCase({
    initiallyEnabled: true,
    openReply: { ok: true, result: { opened: false } },
    replyDelayTargetReads: 3,
    expectedCategory: 'reply_not_observed',
  });
  assert.equal(result.panel_replaced, true);
});

test('failed target discovery keeps the observed callback class in the safe receipt', async () => {
  await assert.rejects(
    reloadCase({
      initiallyEnabled: true,
      openReply: { ok: true, result: { opened: false, reason: 'private URL token' } },
      panelAppears: false,
      expectFailure: true,
    }),
    (error) => {
      assert.equal(error.message, 'native_extension_replacement_panel_unverified');
      const captured = captureLifecycleEvidence(error.lifecycleEvidence);
      assert.equal(captured.open_panel_request.category, 'open_refused');
      assert.equal(captured.open_panel_request.opened, false);
      assert.doesNotMatch(JSON.stringify(captured), /private|token/);
      return true;
    },
  );
});

test('Open panel click failure preserves the original error and safe receipt', async () => {
  await assert.rejects(
    reloadCase({
      initiallyEnabled: true,
      openPanelClickFailure: true,
      expectFailure: true,
    }),
    (error) => {
      assert.equal(error.message, 'private URL token: panel click interrupted');
      const captured = captureLifecycleEvidence(error.lifecycleEvidence);
      assert.equal(captured.open_panel_request.category, 'click_failed');
      assert.equal(captured.open_panel_request.received, false);
      assert.equal(captured.timeline.final_predicate, true);
      assert.doesNotMatch(JSON.stringify(captured), /private|token|interrupted/);
      return true;
    },
  );
});
