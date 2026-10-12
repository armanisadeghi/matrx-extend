import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostedScrapeSaveScope } from '../../scripts/hosted-scrape-route.mjs';

test('D217 stale profile scope routes only member Save with no destination', () => {
  assert.equal(
    hostedScrapeSaveScope('scrape-save-member', 'stale-profile-retry', 'none'),
    'stale-profile-retry',
  );
  assert.throws(() =>
    hostedScrapeSaveScope('guest-scrape-development', 'stale-profile-retry', 'none'),
  );
  assert.throws(() =>
    hostedScrapeSaveScope('scrape-save-member', 'stale-profile-retry', 'project'),
  );
});

import { runInNewContext } from 'node:vm';
import { nativeOAuthBearerExpression } from './native-oauth-session.mjs';
import {
  observeStaleProfileRequests,
  requireGuestSaveEvidence,
} from './scrape-save-stale-profile.mjs';

const guest = {
  sign_in_required: true,
  no_organization_error: false,
  queued: true,
  edited_text_retained: true,
};
test('D217 oracle rejects each original symptom, data loss, and authenticated work while guest', () => {
  assert.equal(requireGuestSaveEvidence(guest, { memberships: 0, landings: 0 }).queued, true);
  for (const field of ['sign_in_required', 'queued', 'edited_text_retained'])
    assert.throws(() =>
      requireGuestSaveEvidence({ ...guest, [field]: false }, { memberships: 0, landings: 0 }),
    );
  assert.throws(() =>
    requireGuestSaveEvidence(
      { ...guest, no_organization_error: true },
      { memberships: 0, landings: 0 },
    ),
  );
  assert.throws(() => requireGuestSaveEvidence(guest, { memberships: 1, landings: 0 }));
  assert.throws(() => requireGuestSaveEvidence(guest, { memberships: 0, landings: 1 }));
});

test('canonical OAuth reader uses JSON session and refuses retired/invalid credentials', async () => {
  const read = (stored) =>
    runInNewContext(`(async () => ${nativeOAuthBearerExpression})()`, {
      chrome: { storage: { local: { get: async () => stored } } },
    });
  assert.equal(
    await read({
      'matrx.oauth.session': JSON.stringify({ v: 1, accessToken: 'opaque-current-bearer' }),
    }),
    'opaque-current-bearer',
  );
  assert.equal(await read({ 'matrx.auth.accessToken': 'opaque-retired-bearer' }), null);
  assert.equal(await read({ 'matrx.oauth.session': '{malformed' }), null);
  assert.equal(
    await read({
      'matrx.oauth.session': JSON.stringify({ v: 2, accessToken: 'opaque-future-bearer' }),
    }),
    null,
  );
});

test('passive D217 observer counts real HTTP boundary and validates member payload/header/edit', async () => {
  const events = new Map();
  const panel = {
    on: (name, listener) => {
      events.set(name, listener);
      return () => events.delete(name);
    },
    send: async () => {},
  };
  const observer = observeStaleProfileRequests(panel, 'organization-handle', 'revised checklist');
  await observer.start();
  const emit = (requestId, request) =>
    events.get('Network.requestWillBeSent')({ requestId, request });
  emit('membership', {
    url: 'https://db.matrxserver.com/rest/v1/rpc/mbr_for_user',
    method: 'POST',
  });
  assert.equal(observer.snapshot().memberships, 1);
  emit('unrelated', { url: 'https://www.aimatrx.com/sources/land', method: 'POST' });
  assert.equal(observer.snapshot().landings, 0);
  const request = {
    url: 'https://server.app.matrxserver.com/sources/land',
    method: 'POST',
    headers: { 'X-Organization-Id': 'organization-handle' },
    postData: JSON.stringify({
      organization_id: 'organization-handle',
      portions: [{ text: 'revised checklist' }],
    }),
  };
  emit('landing', request);
  events.get('Network.responseReceived')({ requestId: 'landing', response: { status: 200 } });
  assert.deepEqual(observer.snapshot(), {
    memberships: 1,
    landings: 1,
    organization_matches: true,
    edited_portions_sent: true,
    landing_status: 200,
  });
  emit('wrong-org', {
    ...request,
    headers: { 'X-Organization-Id': 'different-organization' },
    postData: JSON.stringify({
      organization_id: 'organization-handle',
      portions: [{ text: 'original checklist' }],
    }),
  });
  assert.equal(observer.snapshot().organization_matches, false);
  assert.equal(observer.snapshot().edited_portions_sent, false);
  observer.stop();
  assert.equal(events.size, 0);
});

import { D217_EDIT_MARKER, requirePersistedD217Edit } from './scrape-save-stale-profile.mjs';

test('D217 persisted Source proof rejects metadata-only and original-only reads after successful landing', () => {
  // A successful request is insufficient if storage dropped the appointment coordinator's edit.
  const metadata = { id: 'source-handle', organization_id: 'organization-handle' };
  assert.throws(
    () => requirePersistedD217Edit(metadata, 'source-handle', 'organization-handle'),
    /d217_edited_content_not_persisted/,
  );
  assert.throws(
    () =>
      requirePersistedD217Edit(
        { ...metadata, content: 'Review the appointment details before arriving.' },
        'source-handle',
        'organization-handle',
      ),
    /d217_edited_content_not_persisted/,
  );
  const proof = requirePersistedD217Edit(
    { ...metadata, content: `Review the appointment details.\n\n${D217_EDIT_MARKER}` },
    'source-handle',
    'organization-handle',
  );
  assert.deepEqual(proof, {
    source_matches: true,
    organization_matches: true,
    edited_marker_persisted: true,
  });
  assert.throws(
    () =>
      requirePersistedD217Edit(
        { ...metadata, content: D217_EDIT_MARKER },
        'different-source',
        'organization-handle',
      ),
    /d217_persisted_source_identity_mismatch/,
  );
  assert.throws(
    () =>
      requirePersistedD217Edit(
        { ...metadata, content: D217_EDIT_MARKER },
        'source-handle',
        'different-organization',
      ),
    /d217_persisted_source_org_mismatch/,
  );
  assert.equal(JSON.stringify(proof).includes(D217_EDIT_MARKER), false);
});
