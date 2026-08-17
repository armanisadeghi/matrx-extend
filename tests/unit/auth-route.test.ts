import { apiGet } from '@/lib/api/client';
import { resolveConversationOrganizationId } from '@/lib/api/routes/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiGet: vi.fn() };
});

const apiGetMock = vi.mocked(apiGet);

describe('resolveConversationOrganizationId', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it('returns the server-resolved organization for a guest or bearer identity', async () => {
    apiGetMock.mockResolvedValue({
      ok: true,
      data: { organization_id: '22222222-2222-4222-8222-222222222222' },
    });

    await expect(resolveConversationOrganizationId()).resolves.toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(apiGetMock).toHaveBeenCalledWith('/auth/whoami');
  });

  it('refuses to guess when the server returns no organization', async () => {
    apiGetMock.mockResolvedValue({ ok: true, data: { organization_id: null } });

    await expect(resolveConversationOrganizationId()).rejects.toThrow(
      'the server returned no organization',
    );
  });
});
