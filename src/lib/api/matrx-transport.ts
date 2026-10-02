/**
 * THE extension's `MatrxTransport` — the port every `@ai-matrx/agents/matrx`
 * call rides. Reaches the aidream base URL through the ONE header path
 * (`buildHeaders`), so it carries the same bearer, guest fingerprint and
 * `X-Organization-Id` as every other backend call. A signed-in session with
 * no readable bearer THROWS (`SessionNotReadyError`) rather than sending as a
 * guest.
 */

import { buildHeaders, getApiBaseUrl } from '@/lib/api/client';
import { type MatrxTransport, sendMatrxRequest } from '@ai-matrx/agents/matrx';

export const matrxTransport: MatrxTransport = {
  async fetch(path, init) {
    const baseUrl = await getApiBaseUrl();
    const headers = await buildHeaders(init.headers);
    return sendMatrxRequest(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined && { body: init.body }),
      ...(init.signal !== undefined && { signal: init.signal }),
    });
  },
};
