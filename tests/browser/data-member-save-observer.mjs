/** CDP observer for the exact member Data write; reports only bounded facts. */
import {
  matchesSelectedMemberOrganization,
  parseDataPatternWriteBody,
  parseDataPatternWriteRequestBody,
} from './data-member-pattern-cleanup.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function observePatternWrites(panel, origin, expectedOrganizationId, ownedName) {
  const writes = new Map();
  const offRequest = panel.on('Network.requestWillBeSent', ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      if (
        url.origin === origin &&
        url.pathname === '/rest/v1/wbx_pattern' &&
        request.method === 'POST'
      ) {
        const headerOrganizationId = Object.entries(request.headers ?? {}).find(
          ([name]) => name.toLowerCase() === 'x-organization-id',
        )?.[1];
        const write = {
          status: null,
          failed: false,
          patternId: null,
          bodyCapture: 'pending',
          requestBodyCapture: 'pending',
          requestOrganizationId: null,
          requestName: null,
          headerOrganizationId,
        };
        writes.set(requestId, write);
        const captureRequestBody = (body) => {
          const parsed = parseDataPatternWriteRequestBody(body);
          write.requestOrganizationId = parsed.organizationId;
          write.requestName = parsed.name;
          write.requestBodyCapture = parsed.capture;
        };
        if (typeof request.postData === 'string') captureRequestBody(request.postData);
        else
          void panel
            .send('Network.getRequestPostData', { requestId })
            .then(({ postData }) => captureRequestBody(postData))
            .catch(() => {
              write.requestBodyCapture = 'request_body_unavailable';
            });
      }
    } catch {
      // Unrelated requests are ignored; raw URLs never leave this listener.
    }
  });
  const offResponse = panel.on('Network.responseReceived', ({ requestId, response }) => {
    const write = writes.get(requestId);
    if (write) write.status = response.status;
  });
  const offFailed = panel.on('Network.loadingFailed', ({ requestId }) => {
    const write = writes.get(requestId);
    if (write) write.failed = true;
  });
  const offFinished = panel.on('Network.loadingFinished', ({ requestId }) => {
    const write = writes.get(requestId);
    if (!write) return;
    void panel
      .send('Network.getResponseBody', { requestId })
      .then((body) => {
        const text = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8')
          : body.body;
        const parsed = parseDataPatternWriteBody(text);
        write.patternId = parsed.patternId;
        write.bodyCapture = parsed.capture;
      })
      .catch(() => {
        write.bodyCapture = 'body_unavailable';
      });
  });
  return {
    snapshot: () =>
      [...writes.values()].map((write) => ({
        status: write.status,
        failed: write.failed,
        patternIdPresent: UUID.test(write.patternId ?? ''),
        bodyCapture: write.bodyCapture,
        requestBodyCapture: write.requestBodyCapture,
        requestOrganizationPresent: UUID.test(write.requestOrganizationId ?? ''),
        requestNameMatches: write.requestName === ownedName,
        requestOrganizationMatchesSelected: matchesSelectedMemberOrganization(
          write.requestOrganizationId,
          expectedOrganizationId,
        ),
        headerOrganizationPresent: UUID.test(write.headerOrganizationId ?? ''),
      })),
    writeTarget: () => {
      const target = [...writes.values()].find(
        (write) => write.status === 201 && UUID.test(write.requestOrganizationId ?? ''),
      );
      return target
        ? { patternId: target.patternId, organizationId: target.requestOrganizationId }
        : null;
    },
    stop: () => {
      offRequest();
      offResponse();
      offFailed();
      offFinished();
    },
  };
}
