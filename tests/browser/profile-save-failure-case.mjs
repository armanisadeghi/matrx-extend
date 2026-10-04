import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { click, waitFor } from './settings-panel-driver.mjs';

async function summary(panel, state, expected) {
  const observed = await state(panel);
  return {
    preferredMatchesExpected: observed.preferred === expected,
    dirty: observed.dirty,
    saveEnabled: observed.saveEnabled,
    headerSaveDisabled: observed.headerSaveDisabled,
    errorPresent: Boolean(observed.error),
    errorRecoverable: /fail|network|fetch|connect|unavailable/i.test(observed.error ?? ''),
    loading: observed.loading,
  };
}

// Injected into the already authenticated, owned native Profile panel. The
// caller supplies its existing UI driver and owned-write journal; this case
// neither launches Chrome nor reads credentials or deletes profile rows.
export async function runProfileSaveFailureCase({
  panel,
  origin,
  email,
  original,
  journal,
  state,
  fillPreferred,
  clickProfileHeader,
  openProfile,
}) {
  assert.ok(journal?.save && journal?.reconcile, 'profile_owned_journal_required');
  assert.equal(new URL(origin).origin, origin, 'profile_fault_origin_invalid');
  const draft = `Profile save retry ${randomUUID()}`;
  const receipt = {
    id: 'EXT-F-1004-T26',
    mode: 'member',
    dimension: 'warm',
    branch: 'profile-write-failure-then-retry',
    status: 'unverified',
    observed: {},
  };
  let fault = null;
  let wroteDraft = false;
  let primaryError = null;
  try {
    assert.ok((await state(panel)).preferred === original, 'profile_initial_value_changed');
    await fillPreferred(panel, draft);
    fault = await armOneProfileUpsertFailure(panel, origin);
    await clickProfileHeader(panel, 'Save');
    await waitFor(
      'profile_write_fault_observed',
      () => fault.snapshot(),
      (s) => s.failed === 1 || Boolean(s.error),
      10000,
    );
    assert.equal(fault.snapshot().error, null, 'profile_fault_interception_failed');
    const failed = await waitFor(
      'profile_failed_save_editable',
      () => summary(panel, state, draft),
      (s) =>
        s.preferredMatchesExpected &&
        s.dirty &&
        s.saveEnabled &&
        s.headerSaveDisabled === false &&
        s.errorPresent &&
        !s.loading,
      30000,
    );
    assert.equal(failed.errorRecoverable, true, 'profile_error_not_actionable');
    receipt.observed = {
      intercepted_upserts: fault.snapshot().failed,
      failed_draft_retained: true,
      failed_save_stopped_busy: true,
      failed_save_error_visible: true,
      retry_enabled: true,
    };
    await fault.stop();
    fault = null;
    await journal.save(draft, async () => {
      await clickProfileHeader(panel, 'Save');
      await waitFor(
        'profile_retry_settled',
        () => summary(panel, state, draft),
        (s) => s.preferredMatchesExpected && !s.dirty && !s.errorPresent && !s.loading,
        30000,
      );
    });
    wroteDraft = true;
    await click(panel, 'title', 'Back');
    await openProfile(panel, email);
    await waitFor(
      'profile_retry_persisted_after_reopen',
      () => summary(panel, state, draft),
      (s) => s.preferredMatchesExpected && !s.dirty && !s.errorPresent,
      30000,
    );
    receipt.observed.retry_persisted_after_reopen = true;
  } catch (error) {
    primaryError = error;
  }
  let restorationError = null;
  try {
    if (fault) await fault.stop();
    // If a response disappeared after a real write, reconcile refuses to
    // guess ownership. The runner's outer cleanup retains the durable intent.
    const owned = await journal.reconcile();
    if (owned.owned.marker === draft) wroteDraft = true;
    if (wroteDraft) {
      const current = await state(panel);
      if (!current.back) await openProfile(panel, email);
      await fillPreferred(panel, original);
      await journal.save(original, async () => {
        await clickProfileHeader(panel, 'Save');
        await waitFor(
          'profile_original_restored',
          () => summary(panel, state, original),
          (s) => s.preferredMatchesExpected && !s.dirty && !s.errorPresent,
          30000,
        );
      });
      await click(panel, 'title', 'Back');
      await openProfile(panel, email);
      await waitFor(
        'profile_original_persisted_after_reopen',
        () => summary(panel, state, original),
        (s) => s.preferredMatchesExpected && !s.dirty && !s.errorPresent,
        30000,
      );
    } else {
      const current = await state(panel);
      if (current.back && current.preferred !== original) {
        await clickProfileHeader(panel, 'Discard');
        await waitFor(
          'profile_failed_draft_discarded',
          () => summary(panel, state, original),
          (s) => s.preferredMatchesExpected && !s.dirty,
          10000,
        );
      }
    }
    receipt.observed.original_restored = true;
  } catch (error) {
    restorationError = error;
    receipt.observed.original_restored = false;
  }
  if (restorationError) throw restorationError;
  if (primaryError) throw primaryError;
  assert.equal(receipt.observed.retry_persisted_after_reopen, true);
  assert.equal(receipt.observed.original_restored, true);
  receipt.status = 'passed';
  return receipt;
}

// Request-stage failure prevents the upsert from reaching Supabase. Exact
// origin, route and method keep owner-row reads and unrelated traffic live.
async function armOneProfileUpsertFailure(panel, origin) {
  let attempted = 0;
  let failed = 0;
  let error = null;
  const pending = new Set();
  const off = panel.on('Fetch.requestPaused', (event) => {
    let target = false;
    try {
      const url = new URL(event.request.url);
      target =
        url.origin === origin &&
        url.pathname === '/rest/v1/user_form_profile' &&
        event.request.method === 'POST';
    } catch {
      // A malformed intercepted URL must still be resumed by CDP.
    }
    if (target) attempted++;
    const command = target ? 'Fetch.failRequest' : 'Fetch.continueRequest';
    const operation = panel
      .send(
        command,
        command === 'Fetch.failRequest'
          ? { requestId: event.requestId, errorReason: 'Failed' }
          : { requestId: event.requestId },
      )
      .then(() => {
        if (target) {
          failed++;
          if (attempted !== 1) error = 'profile_fault_multiple_upserts';
        }
      })
      .catch(() => {
        error = 'profile_fault_cdp_command_failed';
      })
      .finally(() => pending.delete(operation));
    pending.add(operation);
  });
  try {
    await panel.send('Fetch.enable', {
      patterns: [{ urlPattern: `${origin}/rest/v1/user_form_profile*`, requestStage: 'Request' }],
    });
  } catch (error) {
    off();
    throw error;
  }
  let stopped = false;
  return {
    snapshot: () => ({ attempted, failed, error }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await Promise.allSettled([...pending]);
        await panel.send('Fetch.disable');
      } finally {
        off();
      }
      assert.equal(failed, 1, 'profile_fault_not_exercised_exactly_once');
      assert.equal(attempted, 1, 'profile_fault_multiple_upserts');
      assert.equal(error, null, 'profile_fault_interception_failed');
    },
  };
}
