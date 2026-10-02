import { log } from '@/lib/debug/log';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ token: 'first-token', refresh: vi.fn(async () => true) }));
vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://files.test' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => auth.token,
  refreshAccessToken: auth.refresh,
}));
vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId: async () => '00000000-0000-4000-8000-000000000002',
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { downloadFileBytes, uploadFile } from './files';

describe('files through the shared request sender', () => {
  beforeEach(() => {
    auth.token = 'first-token';
    auth.refresh.mockReset().mockImplementation(async () => {
      auth.token = 'refreshed-token';
      return true;
    });
    vi.unstubAllGlobals();
    vi.mocked(log.error).mockClear();
  });

  it.each([403, 502])(
    'keeps an echoed secret out of upload HTTP %i diagnostics',
    async (status) => {
      const marker = 'synthetic-secret-that-must-not-leak';
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(`Rejected value: ${marker}`, { status })),
      );

      const error = await uploadFile(new Blob(['intake']), 'intake.txt').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain(marker);
      expect((error as Error).message).toMatch(status === 403 ? /sign in again/i : /try again/i);
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain(marker);
    },
  );

  it('retries a multipart upload after 401 with the same body and pinned organization', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return calls.length === 1
          ? new Response('expired', { status: 401 })
          : Response.json({
              file_id: 'file-verified',
              file_path: 'system-files/matrx-extend/browser-agent/uploads/intake.txt',
              version_number: 1,
              size_bytes: 6,
              checksum: null,
              url: null,
              is_new: true,
              cdn_url: null,
            });
      }),
    );

    const result = await uploadFile(new Blob(['intake']), 'intake.txt');

    expect(result.file_id).toBe('file-verified');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://files.test/files/upload');
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    expect(calls[1]?.init.body).toBe(calls[0]?.init.body);
    expect((calls[0]?.init.headers as Record<string, string>)['X-Organization-Id']).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
    expect((calls[1]?.init.headers as Record<string, string>)['X-Organization-Id']).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
    expect((calls[1]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer refreshed-token',
    );
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('preserves caller cancellation when downloading bytes', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response('unexpected');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadFileBytes('file-verified', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 502])(
    'keeps an echoed secret out of download HTTP %i diagnostics',
    async (status) => {
      const marker = 'synthetic-secret-that-must-not-leak';
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(`Rejected value: ${marker}`, { status })),
      );

      const error = await downloadFileBytes('file-verified').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain(marker);
      expect((error as Error).message).toMatch(status === 403 ? /sign in again/i : /try again/i);
    },
  );

  it('returns downloaded bytes and the response filename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('verified bytes', {
            headers: {
              'content-disposition': 'attachment; filename="verified.txt"',
              'content-type': 'text/plain',
            },
          }),
      ),
    );

    const result = await downloadFileBytes('file-verified');

    expect(await result.blob.text()).toBe('verified bytes');
    expect(result.filename).toBe('verified.txt');
    expect(result.mimeType).toBe('text/plain');
  });
});
