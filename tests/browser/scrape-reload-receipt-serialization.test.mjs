import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureLifecycleEvidence } from './profile-reload-capture.mjs';

test('persisted Scrape success and failure receipts retain safe Open panel milestones', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scrape-reload-receipt-'));
  try {
    for (const [path, field, settlement] of [
      ['success', 'reload_lifecycle', 'resolved'],
      ['failure', 'reload_lifecycle_failure', 'rejected'],
    ]) {
      const produced = {
        replacement_panel_created_event: path === 'success',
        open_panel_request: {
          category: path === 'success' ? 'opened' : 'open_refused',
          fixture: {
            availability: 'ready',
            click_received: true,
            send_invoked: true,
            send_returned: true,
            callback_entered: true,
            callback_has_reply: path === 'success',
            callback_last_error: path === 'failure',
            send_threw: false,
            page_content: 'PRIVATE_PAGE_BODY',
          },
        },
        open_panel_diagnostic: {
          availability: 'ready',
          perturbation: 'cdp_worker_attach_and_synchronous_open_wrapper',
          ingress: true,
          open_invoked: true,
          open_settlement: settlement,
          send_response: 'unobservable_without_instrumented_build',
          token: 'PRIVATE_TOKEN',
        },
      };
      const receipt =
        path === 'success'
          ? { reload_lifecycle: { retirement_evidence: captureLifecycleEvidence(produced) } }
          : { reload_lifecycle_failure: captureLifecycleEvidence(produced) };
      const output = join(directory, `${path}.json`);
      await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
      const persisted = JSON.parse(await readFile(output, 'utf8'));
      const evidence =
        field === 'reload_lifecycle'
          ? persisted.reload_lifecycle.retirement_evidence
          : persisted.reload_lifecycle_failure;
      assert.equal(evidence.replacement_panel_created_event, path === 'success');
      assert.equal(evidence.open_panel_request.fixture.callback_has_reply, path === 'success');
      assert.equal(evidence.open_panel_request.fixture.callback_last_error, path === 'failure');
      assert.equal(evidence.open_panel_diagnostic.ingress, true);
      assert.equal(evidence.open_panel_diagnostic.open_settlement, settlement);
      assert.equal(
        evidence.open_panel_diagnostic.send_response,
        'unobservable_without_instrumented_build',
      );
      assert.doesNotMatch(JSON.stringify(persisted), /PRIVATE_|page_content|token/);
    }
    const ordinary = captureLifecycleEvidence({ open_panel_request: { category: 'opened' } });
    assert.equal(Object.hasOwn(ordinary, 'open_panel_diagnostic'), false);
    assert.equal(Object.hasOwn(ordinary.open_panel_request, 'fixture'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
