import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@/lib/supabase/queries', () => ({ lookupCapturedByUrl: mocks.lookup }));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ url: 'https://docs.example.com/guide', title: 'Guide', id: 1 }),
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => undefined }));

import { usePageRecognition } from './use-page-recognition';

beforeEach(() => mocks.lookup.mockReset());

describe('usePageRecognition', () => {
  it('a failed lookup is "could not check", never "not saved"', async () => {
    mocks.lookup.mockResolvedValue({ status: 'unknown', reason: 'permission denied' });
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ checkFailed: true, capturedAt: null });
  });

  it('a page never saved is simply not saved', async () => {
    mocks.lookup.mockResolvedValue({ status: 'none' });
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ checkFailed: false, capturedAt: null });
  });

  it('a saved page is recognised', async () => {
    mocks.lookup.mockResolvedValue({
      status: 'found',
      page: { id: 'doc-1', url: 'u', captured_at: '2026-09-25T00:00:00Z', title: 'Guide' },
    });
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(result.current.capturedId).toBe('doc-1'));
    expect(result.current.checkFailed).toBe(false);
  });
});
