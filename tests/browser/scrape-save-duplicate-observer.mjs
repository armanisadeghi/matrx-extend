import assert from 'node:assert/strict';

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
          finished: false,
          body: null,
        });
    } catch {
      // Unrelated network traffic cannot satisfy the Source response proof.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) request.status = response?.status ?? null;
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
    if (request) request.finished = true;
  });
  const entries = () => [...requests.values()];
  return {
    start: () => panel.send('Network.enable'),
    snapshot: () => ({
      ready:
        entries().filter((entry) => entry.kind === 'land').length === 1 &&
        entries().filter((entry) => entry.kind === 'land')[0].finished &&
        (entries().filter((entry) => entry.kind === 'land')[0].body?.reused === false ||
          (entries().filter((entry) => entry.kind === 'rename').length === 1 &&
            entries().every((entry) => entry.finished))),
      landCount: entries().filter((entry) => entry.kind === 'land').length,
      renameCount: entries().filter((entry) => entry.kind === 'rename').length,
    }),
    verify(firstSourceId) {
      const land = entries().filter((entry) => entry.kind === 'land');
      const rename = entries().filter((entry) => entry.kind === 'rename');
      assert.equal(land.length, 1, 'scrape_save_duplicate_land_count');
      assert.equal(land[0].finished, true, 'scrape_save_duplicate_land_unfinished');
      assert.equal(land[0].status, 200, 'scrape_save_duplicate_land_response_failed');
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
    stop() {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}
