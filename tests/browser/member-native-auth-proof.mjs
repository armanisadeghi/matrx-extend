import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from './settings-panel-driver.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fingerprint(value) {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 16);
}

export async function firstPartyWebIdentity(page) {
  const identity = await page.evaluate(async () => {
    const response = await fetch('/api/whoami', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return null;
    const result = await response.json();
    return result?.signed_in === true ? { email: result.email, userId: result.user_id } : null;
  });
  return identity;
}

export async function authenticatedWebIdentity(page, expectedFingerprint) {
  const identity = await firstPartyWebIdentity(page);
  if (
    typeof identity?.email !== 'string' ||
    !UUID.test(identity.userId ?? '') ||
    fingerprint(identity.email) !== expectedFingerprint
  )
    throw new Error('reviewer_web_identity_unverified');
  return identity;
}

export async function supabaseOrigin(repo) {
  const source = await readFile(join(repo, '.env.production'), 'utf8');
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith('WXT_SUPABASE_URL='));
  if (!line) throw new Error('supabase_origin_unavailable');
  const url = new URL(line.slice('WXT_SUPABASE_URL='.length).replace(/^['"]|['"]$/g, ''));
  if (url.protocol !== 'https:' || url.pathname !== '/') throw new Error('supabase_origin_invalid');
  return url.origin;
}

export function observeCanonicalAdminCheck(panel, origin, timeoutMs = 60_000) {
  const requests = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', (event) => {
    try {
      const url = new URL(event.request.url);
      const profile = Object.entries(event.request.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'accept-profile',
      )?.[1];
      const userId = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('user_id') ?? '')?.[1];
      if (
        url.origin === origin &&
        url.pathname === '/rest/v1/admins' &&
        event.request.method === 'GET' &&
        String(profile).toLowerCase() === 'admin' &&
        url.searchParams.get('select') === 'user_id' &&
        UUID.test(userId ?? '')
      )
        requests.set(event.requestId, { userId, status: null, rowCount: null, outcome: 'pending' });
    } catch {
      /* Ignore unrelated requests. */
    }
  });
  const offResponse = panel.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  const offFinished = panel.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    void panel
      .send('Network.getResponseBody', { requestId: event.requestId })
      .then((body) => {
        try {
          const rows = JSON.parse(
            body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body,
          );
          request.rowCount = Array.isArray(rows) ? rows.length : null;
          request.outcome = Array.isArray(rows) ? 'complete' : 'invalid_body_shape';
        } catch {
          request.outcome = 'invalid_body';
        }
      })
      .catch(() => {
        request.outcome = 'body_unavailable';
      });
  });
  const offFailed = panel.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId);
    if (request) request.outcome = 'request_failed';
  });
  return {
    async start() {
      await panel.send('Network.enable');
      await panel.send('Network.setCacheDisabled', { cacheDisabled: true });
    },
    async verify(expectedUserId) {
      const result = await waitFor(
        'reviewer_canonical_admin_assignment_read',
        () =>
          [...requests.values()].find(
            (request) =>
              request.userId === expectedUserId &&
              request.status === 200 &&
              request.outcome === 'complete' &&
              request.rowCount === 0,
          ) ?? null,
        Boolean,
        timeoutMs,
      );
      if (result.status !== 200 || result.outcome !== 'complete' || result.rowCount !== 0)
        throw new Error('reviewer_canonical_nonadmin_role_unverified');
      return { matched_current_extension_user: true, http_status: 200, returned_rows: 0 };
    },
    async stop() {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
      await panel.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
      await panel.send('Network.disable').catch(() => {});
    },
  };
}
