import assert from 'node:assert/strict';
import { accountIdentity, signInSettings } from './settings-native-auth-driver.mjs';
import { click, evaluate, openSection, waitFor } from './settings-panel-driver.mjs';

/** Remove credentials only in the disposable profile, retaining the profile fetched by real sign-in.
 * Reload uses the production restore path; UI and HTTP are never stubbed. */
export async function prepareStaleProfileGuest(native, identity, evidence) {
  await native
    .resourceAction(() =>
      evaluate(
        native.panel,
        `(async () => {
    const before = await chrome.storage.local.get(null);
    if (before['matrx.user.profile']?.id !== ${JSON.stringify(identity.profileId)}) throw new Error('d217_real_profile_missing');
    const keys = Object.keys(before).filter((key) => key === 'matrx.oauth.session' ||
      key.startsWith('matrx.auth.') || /^sb-.*-auth-token$/.test(key));
    await chrome.storage.local.remove(keys);
    await chrome.storage.session.clear();
    return { credentials_removed: keys.includes('matrx.oauth.session') };
  })()`,
      ),
    )
    .then((value) => {
      evidence.fixture = value;
    });
  assert.equal(evidence.fixture.credentials_removed, true, 'd217_no_real_session_to_remove');
  const replacement = await native.resourceAction(() => native.reloadExtension());
  evidence.fixture.restore_via_full_extension_reload =
    replacement.management_reload_clicked &&
    replacement.worker_replaced &&
    replacement.old_targets_retired;
  const panel = replacement.panel;
  await assertStaleGuest(panel, identity.profileId);
  evidence.fixture.guest_restore_observed = true;
  return panel;
}

export async function assertStaleGuest(panel, profileId) {
  await click(panel, 'title', 'Settings');
  await openSection(panel, 'Account');
  await waitFor(
    'd217_rendered_guest_required',
    () => accountIdentity(panel, ''),
    (state) => state?.signInEnabled && !state.signOutVisible,
  );
  const stored = await evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get(null);
    return { profile_matches: stored['matrx.user.profile']?.id === ${JSON.stringify(profileId)},
      oauth_absent: !stored['matrx.oauth.session'],
      legacy_bearer_absent: !stored['matrx.auth.accessToken'],
      supabase_sessions_absent: !Object.keys(stored).some((key) => /^sb-.*-auth-token$/.test(key)) };
  })()`,
  );
  assert.equal(
    Object.values(stored).every(Boolean),
    true,
    'd217_guest_has_credentials_or_profile_lost',
  );
  await click(panel, 'title', 'Scrape');
  return stored;
}

/** Passive observation: requests continue unchanged. Only counts and matching booleans leave memory. */
export function observeStaleProfileRequests(panel, organizationId, marker) {
  const state = {
    memberships: 0,
    landings: 0,
    organization_matches: false,
    edited_portions_sent: false,
    landing_status: null,
  };
  let landingId;
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return;
    }
    if (url.origin === 'https://db.matrxserver.com' && /\/rpc\/mbr_for_user$/.test(url.pathname))
      state.memberships++;
    if (
      url.origin !== 'https://server.app.matrxserver.com' ||
      url.pathname !== '/sources/land' ||
      request.method !== 'POST'
    )
      return;
    state.landings++;
    landingId = requestId;
    try {
      const body = JSON.parse(request.postData);
      const orgHeader = Object.entries(request.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'x-organization-id',
      )?.[1];
      state.organization_matches =
        body.organization_id === organizationId && orgHeader === organizationId;
      state.edited_portions_sent = JSON.stringify(body.portions).includes(marker);
    } catch {
      /* Malformed payload cannot satisfy the proof. */
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    if (requestId === landingId) state.landing_status = response.status;
  });
  return {
    start: () => panel.send('Network.enable'),
    snapshot: () => ({ ...state }),
    stop: () => {
      offRequest();
      offResponse();
    },
  };
}

export function requireGuestSaveEvidence(state, network) {
  assert.equal(state?.sign_in_required, true, 'd217_sign_in_remedy_missing');
  assert.equal(state?.no_organization_error, false, 'd217_wrong_organization_error');
  assert.equal(state?.queued, true, 'd217_draft_lost');
  assert.equal(state?.edited_text_retained, true, 'd217_edited_text_lost');
  assert.equal(network.memberships, 0, 'd217_guest_membership_called');
  assert.equal(network.landings, 0, 'd217_guest_source_write_called');
  return { ...state, ...network };
}

async function queuedState(panel, url, marker) {
  return evaluate(
    panel,
    `(async () => {
    const stored = await chrome.storage.local.get('matrx.sources.unsaved');
    const rows = stored['matrx.sources.unsaved'];
    const row = Array.isArray(rows) ? rows.find((item) => item.url === ${JSON.stringify(url)}) : null;
    const alert = document.querySelector('[aria-label="Captures not yet saved as Sources"]');
    return { queued: !!row, revision: row?.revision ?? 0,
      sign_in_required: row?.lastRefusal?.code === 'sign_in_required' && row?.lastRefusal?.remedy === 'sign_in' && alert?.textContent.includes('sign in and retry') === true,
      no_organization_error: /no.organization|mbr_for_user|permission denied/i.test(alert?.textContent ?? ''),
      edited_text_retained: JSON.stringify(row?.prepared?.portions ?? []).includes(${JSON.stringify(marker)}) };
  })()`,
  );
}

export const D217_EDIT_MARKER =
  'The intake coordinator confirmed the revised appointment checklist.';

export async function editD217Article(panel) {
  await click(panel, 'title', 'Edit article markdown');
  const text = await evaluate(panel, `document.querySelector('textarea')?.value`);
  assert.ok(typeof text === 'string' && text.length > 0, 'd217_article_editor_missing');
  await evaluate(
    panel,
    `(() => { const node = document.querySelector('textarea'); node.focus(); node.select(); })()`,
  );
  await panel.send('Input.insertText', { text: `${text}\n\n${D217_EDIT_MARKER}` });
  await click(panel, 'button-text', 'Apply');
}

export async function exerciseStaleProfileRetry({
  native,
  panel,
  identity,
  repo,
  sourceUrl,
  evidence,
  readSources,
  onPanel,
}) {
  let observer = observeStaleProfileRequests(panel, identity.organizationId, D217_EDIT_MARKER);
  try {
    await observer.start();
    await native.resourceAction(() => click(panel, 'button-text', 'Save Source'));
    const saved = await waitFor(
      'd217_guest_save_refusal',
      () => queuedState(panel, sourceUrl, D217_EDIT_MARKER),
      (state) => state?.queued,
    );
    evidence.warm_save = requireGuestSaveEvidence(saved, observer.snapshot());
    await native.resourceAction(() => click(panel, 'button-text', 'Retry save'));
    const warm = await waitFor(
      'd217_guest_warm_retry',
      () => queuedState(panel, sourceUrl, D217_EDIT_MARKER),
      (state) => state?.revision > saved.revision,
    );
    evidence.warm_retry = requireGuestSaveEvidence(warm, observer.snapshot());
    observer.stop();
    const replacement = await native.resourceAction(() => native.reloadExtension());
    panel = replacement.panel;
    onPanel(panel);
    evidence.reload = {
      management_reload_clicked: replacement.management_reload_clicked,
      old_targets_retired: replacement.old_targets_retired,
      worker_replaced: replacement.worker_replaced,
      panel_replaced: replacement.panel_replaced,
    };
    await assertStaleGuest(panel, identity.profileId);
    observer = observeStaleProfileRequests(panel, identity.organizationId, D217_EDIT_MARKER);
    await observer.start();
    const before = await queuedState(panel, sourceUrl, D217_EDIT_MARKER);
    await native.resourceAction(() => click(panel, 'button-text', 'Retry save'));
    const after = await waitFor(
      'd217_guest_postreload_retry',
      () => queuedState(panel, sourceUrl, D217_EDIT_MARKER),
      (state) => state?.revision > before.revision,
    );
    evidence.postreload_retry = requireGuestSaveEvidence(after, observer.snapshot());
    observer.stop();
    const recovered = await native.resourceAction(() =>
      signInSettings({
        mode: 'member',
        page: native.page,
        panel,
        repo,
        memberLinkFile: process.env.MATRX_REVIEWER_MAGIC_LINK_FILE,
        allowLadderOrganization: true,
      }),
    );
    assert.equal(recovered.profileId, identity.profileId, 'd217_recovered_person_changed');
    assert.equal(
      recovered.organizationId,
      identity.organizationId,
      'd217_recovered_organization_changed',
    );
    assert.equal(recovered.admin_role, false, 'd217_recovery_admin_forbidden');
    const empty = await readSources(panel);
    assert.equal(empty.status, 200, 'd217_guest_zero_write_read_failed');
    assert.deepEqual(empty.rows, [], 'd217_guest_source_row_exists');
    evidence.guest_zero_source_rows_verified_after_real_signin = true;
    await click(panel, 'title', 'Scrape');
    observer = observeStaleProfileRequests(panel, identity.organizationId, D217_EDIT_MARKER);
    await observer.start();
    await native.resourceAction(() => click(panel, 'button-text', 'Retry save'));
    await waitFor(
      'd217_member_retry_http',
      () => observer.snapshot(),
      (state) => state.landing_status !== null,
      30000,
    );
    const landed = observer.snapshot();
    assert.equal(landed.landings, 1, 'd217_retry_landing_count_wrong');
    assert.equal(landed.landing_status, 200, 'd217_member_retry_http_failed');
    assert.equal(landed.organization_matches, true, 'd217_member_retry_organization_wrong');
    assert.equal(landed.edited_portions_sent, true, 'd217_member_retry_edit_missing');
    evidence.member_retry = landed;
    return panel;
  } finally {
    observer.stop();
  }
}
