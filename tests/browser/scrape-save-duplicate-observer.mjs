import assert from 'node:assert/strict';

function safeHttpStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

/** Observe only the two bounded Source responses; never retain response text. */
export function observeDuplicateSourceSave(panel, serverOrigin) {
  const requests = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      if (url.origin !== serverOrigin || request?.method !== 'POST') return;
      const kind =
        url.pathname === '/sources/land'
          ? 'land'
          : /^\/sources\/[0-9a-f-]{36}\/edit$/i.test(url.pathname)
            ? 'rename'
            : null;
      if (kind)
        requests.set(requestId, {
          kind,
          path: url.pathname,
          status: null,
          responseReceived: false,
          finished: false,
          failed: false,
          body: null,
        });
    } catch {
      // Unrelated network traffic cannot satisfy the Source response proof.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) {
      request.responseReceived = true;
      request.status = safeHttpStatus(response?.status);
    }
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const request = requests.get(requestId);
    if (!request) return;
    if (request.kind === 'rename') {
      request.finished = true;
      return;
    }
    void panel
      .send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        try {
          const parsed = JSON.parse(
            base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
          );
          request.body = {
            id:
              typeof parsed?.processed_document_id === 'string'
                ? parsed.processed_document_id
                : null,
            reused: parsed?.reused_existing === true,
          };
        } catch {
          request.body = { id: null, reused: false };
        }
      })
      .catch(() => {
        request.body = { id: null, reused: false };
      })
      .finally(() => {
        request.finished = true;
      });
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) {
      request.finished = true;
      request.failed = true;
    }
  });
  const entries = () => [...requests.values()];
  return {
    start: () => panel.send('Network.enable'),
    snapshot(firstSourceId) {
      const land = entries().filter((entry) => entry.kind === 'land');
      const rename = entries().filter((entry) => entry.kind === 'rename');
      const landing = land.length === 1 ? land[0] : null;
      const renaming = rename.length === 1 ? rename[0] : null;
      return {
        ready:
          land.length === 1 &&
          landing.finished &&
          (landing.body?.reused === false ||
            (rename.length === 1 && entries().every((entry) => entry.finished))),
        landCount: land.length,
        renameCount: rename.length,
        land_response_received: landing?.responseReceived === true,
        land_http_status: landing?.status ?? null,
        land_status_class: landing?.status ? Math.floor(landing.status / 100) : null,
        land_finished: landing?.finished === true,
        land_transport_failed: landing?.failed === true,
        land_body_observed: landing?.body !== null && landing?.body !== undefined,
        land_reused_existing: landing?.body?.reused === true,
        land_same_source_id:
          typeof firstSourceId === 'string' && landing?.body?.id === firstSourceId,
        rename_response_received: renaming?.responseReceived === true,
        rename_http_status: renaming?.status ?? null,
        rename_status_class: renaming?.status ? Math.floor(renaming.status / 100) : null,
        rename_finished: renaming?.finished === true,
        rename_transport_failed: renaming?.failed === true,
        rename_target_matches_source:
          typeof firstSourceId === 'string' && renaming?.path === `/sources/${firstSourceId}/edit`,
      };
    },
    verify(firstSourceId) {
      const land = entries().filter((entry) => entry.kind === 'land');
      const rename = entries().filter((entry) => entry.kind === 'rename');
      assert.equal(land.length, 1, 'scrape_save_duplicate_land_count');
      assert.equal(land[0].finished, true, 'scrape_save_duplicate_land_unfinished');
      assert.equal(land[0].status, 201, 'scrape_save_duplicate_land_response_failed');
      assert.equal(land[0].body?.reused, true, 'scrape_save_duplicate_reuse_not_observed');
      assert.equal(land[0].body?.id, firstSourceId, 'scrape_save_duplicate_landed_new_source');
      assert.equal(rename.length, 1, 'scrape_save_duplicate_rename_count');
      assert.equal(rename[0].finished, true, 'scrape_save_duplicate_rename_unfinished');
      assert.equal(
        rename[0].path,
        `/sources/${firstSourceId}/edit`,
        'scrape_save_duplicate_rename_target_changed',
      );
      assert.equal(rename[0].status, 200, 'scrape_save_duplicate_rename_response_failed');
      return { reused_existing: true, same_source_id: true, rename_succeeded: true };
    },
    async run(firstSourceId, observations, action) {
      try {
        await this.start();
        return await action();
      } finally {
        observations.duplicate_transport = this.snapshot(firstSourceId);
        this.stop();
      }
    },
    stop() {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}
