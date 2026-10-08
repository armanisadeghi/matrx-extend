import assert from 'node:assert/strict';
import test from 'node:test';
import { reloadCase } from './native-reload-fixture.mjs';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';

test('failed full reload records independent replacement activation without bypassing the current acceptance predicate', async () => {
  await assert.rejects(
    reloadCase({
      initiallyEnabled: true,
      executionEvidence: 'replacementStarting',
      freshSnapshot: { runningStatus: 'running', status: 'activated' },
      expectFailure: true,
    }),
    (error) => {
      assert.equal(error.message, 'native_extension_worker_retirement_unverified');
      const evidence = captureLifecycleEvidence(error.lifecycleEvidence);
      assert.equal(evidence.old_worker_execution_retired, false);
      assert.equal(evidence.reload_lifetime.fresh_replacement.outcome, 'activated');
      assert.equal(evidence.reload_lifetime.fresh_replacement.version_id, 'version-new');
      assert.equal(evidence.reload_lifetime.fresh_replacement.target_id, 'new-worker');
      assert.equal(evidence.timeline.final_predicate, false);
      return true;
    },
  );
});
