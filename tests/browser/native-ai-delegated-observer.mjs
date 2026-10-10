/** Observe one fresh authenticated canonical ai result POST; never export request bodies. */
export function observeNativeAiDelegatedResult(worker, serverOrigin) {
  if (!/^https:\/\/[^/]+$/.test(serverOrigin ?? ''))
    throw new Error('native_ai_backend_origin_unverified');
  const requests = new Map();
  let armed = false;
  let expectedCallId = null;
  const offRequest = worker.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      if (!armed || request.method !== 'POST') return;
      const url = new URL(request.url);
      if (url.origin !== serverOrigin || url.search !== '') return;
      if (!/\/ai\/conversations\/[0-9a-f-]{36}\/tool_results$/.test(url.pathname)) return;
      const authorization = Object.entries(request.headers ?? {}).find(
        ([name]) => name.toLowerCase() === 'authorization',
      )?.[1];
      requests.set(requestId, {
        status: null,
        body: request.postData ?? null,
        authenticated: /^Bearer \S+$/.test(authorization ?? ''),
        finished: false,
        failed: false,
      });
    } catch {
      /* Unrelated traffic is not evidence. */
    }
  });
  const offResponse = worker.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = requests.get(requestId);
    if (entry) entry.status = response.status;
  });
  const offFinished = worker.on('Network.loadingFinished', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (entry) entry.finished = true;
  });
  const offFailed = worker.on('Network.loadingFailed', ({ requestId }) => {
    const entry = requests.get(requestId);
    if (entry) entry.failed = true;
  });
  return {
    expectCallId(callId) {
      if (typeof callId !== 'string' || !callId) throw new Error('native_ai_expected_call_missing');
      expectedCallId = callId;
    },
    arm() {
      armed = true;
    },
    async read() {
      let latest = null;
      for (const [requestId, entry] of requests) {
        if (!entry.body) {
          try {
            entry.body = (await worker.send('Network.getRequestPostData', { requestId })).postData;
          } catch {
            continue;
          }
        }
        let body;
        try {
          body = JSON.parse(entry.body);
        } catch {
          continue;
        }
        const matching = (body.results ?? []).filter(
          (result) =>
            expectedCallId &&
            result.call_id === expectedCallId &&
            (result.tool_name === 'ai' || result.tool_name === 'ai_summarize'),
        );
        if (matching.length !== 1) continue;
        const observation = {
          posted: entry.status === 200 && entry.authenticated && entry.finished && !entry.failed,
          canonical_ai_tool: matching[0].tool_name === 'ai',
          output_ok: matching[0].output?.ok === true,
          output_unavailable:
            matching[0].output?.ok === false && matching[0].output?.availability === 'unavailable',
          http_status: Number.isInteger(entry.status) ? entry.status : null,
          authenticated: entry.authenticated,
          finished: entry.finished,
        };
        if (observation.posted) return observation;
        latest = observation;
      }
      return (
        latest ?? {
          posted: false,
          canonical_ai_tool: false,
          output_ok: false,
          output_unavailable: false,
          http_status: null,
          authenticated: false,
          finished: false,
        }
      );
    },
    stop() {
      offRequest();
      offResponse();
      offFinished();
      offFailed();
      requests.clear();
    },
  };
}
