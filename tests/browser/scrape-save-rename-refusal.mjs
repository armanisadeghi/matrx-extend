import assert from 'node:assert/strict';

/** Refuse exactly the first POST to this run-owned Source; all later requests are real. */
export function refuseFirstSourceRename(panel, serverOrigin, sourceId) {
  const endpoint = new URL(`/sources/${sourceId}/edit`, serverOrigin).href;
  let refused = 0;
  let continued = 0;
  let failures = 0;
  const pending = new Set();
  let unsubscribe;
  const snapshot = () => ({ refused, continued, failures, pending: pending.size });
  return {
    snapshot,
    async start() {
      unsubscribe = panel.on('Fetch.requestPaused', (event) => {
        const task = (async () => {
          if (event.request?.method === 'POST' && event.request.url === endpoint && refused === 0) {
            refused++;
            await panel.send('Fetch.fulfillRequest', {
              requestId: event.requestId,
              responseCode: 503,
              responseHeaders: [
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Access-Control-Allow-Origin', value: '*' },
              ],
              body: Buffer.from(
                JSON.stringify({ detail: 'Controlled Source rename refusal.' }),
              ).toString('base64'),
            });
          } else {
            continued++;
            await panel.send('Fetch.continueRequest', { requestId: event.requestId });
          }
        })()
          .catch(() => {
            failures++;
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      });
      try {
        await panel.send('Fetch.enable', {
          patterns: [{ urlPattern: endpoint, requestStage: 'Request' }],
        });
      } catch (error) {
        unsubscribe();
        throw error;
      }
    },
    verify() {
      assert.equal(refused, 1, 'scrape_save_rename_refusal_not_injected_once');
      assert.equal(failures, 0, 'scrape_save_rename_refusal_controller_failed');
      assert.equal(pending.size, 0, 'scrape_save_rename_refusal_controller_pending');
      return snapshot();
    },
    async stop() {
      try {
        await panel.send('Fetch.disable');
        await Promise.allSettled([...pending]);
      } finally {
        unsubscribe?.();
      }
      assert.equal(failures, 0, 'scrape_save_rename_refusal_controller_failed');
    },
  };
}
