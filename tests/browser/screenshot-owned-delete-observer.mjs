import { waitFor } from './settings-panel-driver.mjs';

// Keep request IDs and row IDs in memory. The snapshot is the only durable
// shape: counts and HTTP outcomes, with no request URL or response body.
export function watchOwnedScreenshotDelete(panel, ownedId) {
  const requests = new Map();
  let sequence = 0;
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request?.url);
      if (request?.method !== 'DELETE' || !url.pathname.endsWith('/wbx_screenshot')) return;
      const exact = url.searchParams.get('id') === `eq.${ownedId}`;
      requests.set(requestId, { sequence: ++sequence, exact, status: null, finished: false });
    } catch {
      // Other traffic cannot prove deletion of this run's row.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const request = requests.get(requestId);
    if (request) request.status = response?.status ?? null;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) request.finished = true;
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const request = requests.get(requestId);
    if (request) request.failed = true;
  });
  const marker = () => sequence;
  const snapshotAfter = (before) => {
    const observed = [...requests.values()].filter((request) => request.sequence > before);
    const exact = observed.filter((request) => request.exact);
    return {
      deleteCount: observed.length,
      exactCount: exact.length,
      otherCount: observed.length - exact.length,
      completedExactCount: exact.filter(
        (request) =>
          request.finished &&
          !request.failed &&
          Number.isInteger(request.status) &&
          request.status >= 200 &&
          request.status < 300,
      ).length,
      outcomes: observed.map((request) => ({
        exact: request.exact,
        status: request.status,
        finished: request.finished,
        failed: request.failed === true,
      })),
    };
  };
  return {
    marker,
    snapshotAfter,
    async clickAndWait(clickDelete, observe, timeoutMs = 30_000) {
      const before = marker();
      await clickDelete();
      return waitFor(
        'exact_owned_delete_mutation',
        async () => {
          const state = snapshotAfter(before);
          observe(state);
          return state;
        },
        (state) =>
          state.deleteCount === 1 && state.exactCount === 1 && state.completedExactCount === 1,
        timeoutMs,
      );
    },
    stop() {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
    },
  };
}

// This is the acceptance runner's complete cleanup boundary. The fresh read
// cannot begin until the exact owned mutation has finished successfully.
export async function deleteOwnedScreenshotAndVerify({
  panel,
  ownedId,
  clickDelete,
  readRows,
  observeMutation,
  timeoutMs = 30_000,
}) {
  const deletion = watchOwnedScreenshotDelete(panel, ownedId);
  try {
    await deletion.clickAndWait(clickDelete, observeMutation, timeoutMs);
    const read = await readRows();
    if (!Array.isArray(read?.rows) || read.rows.length !== 0)
      throw new Error('owned_row_still_present');
    return read;
  } finally {
    deletion.stop();
  }
}
