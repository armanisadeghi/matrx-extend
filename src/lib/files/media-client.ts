import { getBackendUrl } from '@/config/backend';
import { buildHeaders } from '@/lib/api/client';
import { holdForActiveOrganizationId } from '@/lib/org/active-org';
import { applyOrganizationContextHeader } from '@ai-matrx/agents/matrx';
import { createMatrxFilesClient } from '@ai-matrx/data/files';
import type { DurableSrc, MediaClient } from '@ai-matrx/media';

let current: { baseUrl: string; client: MediaClient } | undefined;

/** The extension's media transport stays on its selected general backend. */
export async function getScreenshotMediaClient(): Promise<MediaClient> {
  const baseUrl = await getBackendUrl();
  if (current?.baseUrl === baseUrl) return current.client;

  const client = createMatrxFilesClient<DurableSrc>({
    filesBaseUrl: baseUrl,
    credentials: {
      async get() {
        // Preserve the extension's signed-in readiness and guest identity policy.
        const headers = await buildHeaders();
        const bearer = headers.Authorization?.replace(/^Bearer /, '');
        if (bearer) return { kind: 'user', accessToken: bearer };
        const fingerprintId = headers['X-Fingerprint-ID'];
        return fingerprintId ? { kind: 'guest', fingerprintId } : null;
      },
    },
    async fetchImpl(input, init) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
      if (headers.has('Authorization')) {
        const organizationId = await holdForActiveOrganizationId();
        const bound = applyOrganizationContextHeader(Object.fromEntries(headers), organizationId);
        return fetch(input, { ...init, headers: bound });
      }
      return fetch(input, init);
    },
  });

  current = { baseUrl, client };
  return client;
}
