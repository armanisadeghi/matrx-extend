import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  onOrganizationChange: null as ((organizationId: string | null) => void) | null,
  onPageAlreadyCaptured: null as
    | ((payload: { url: string; capturedAt: string; id: string }) => { ack: true })
    | null,
}));
vi.mock('@/lib/supabase/queries', () => ({ lookupCapturedByUrl: mocks.lookup }));
vi.mock('@/lib/org/active-org', () => ({
  onActiveOrganizationChange: (cb: (organizationId: string | null) => void) => {
    mocks.onOrganizationChange = cb;
    return () => {
      mocks.onOrganizationChange = null;
    };
  },
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ url: 'https://docs.example.com/guide', title: 'Guide', id: 1 }),
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (
    _channel: string,
    cb: (payload: { url: string; capturedAt: string; id: string }) => { ack: true },
  ) => {
    mocks.onPageAlreadyCaptured = cb;
    return () => {
      mocks.onPageAlreadyCaptured = null;
    };
  },
}));

import { usePageRecognition } from './use-page-recognition';

beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.onOrganizationChange = null;
  mocks.onPageAlreadyCaptured = null;
});

function deferredLookup() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('usePageRecognition', () => {
  it('a failed lookup is "could not check", never "not saved"', async () => {
    mocks.lookup.mockResolvedValue({ status: 'unknown', reason: 'permission denied' });
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      checkFailed: true,
      checkNeedsOrganization: false,
      capturedAt: null,
    });
  });

  it('a missing workspace identifies the selection remedy without inventing a saved state', async () => {
    mocks.lookup.mockResolvedValue({
      status: 'unknown',
      cause: 'organization_unselected',
      reason: 'Choose your organization in the AI Matrx panel.',
    });
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      capturedId: null,
      checkFailed: true,
      checkNeedsOrganization: true,
    });
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

  it('clears the old workspace claim and recognises the new workspace on a switch', async () => {
    const nextWorkspace = deferredLookup();
    mocks.lookup
      .mockResolvedValueOnce({
        status: 'found',
        page: {
          id: 'source-in-old-workspace',
          url: 'u',
          captured_at: '2026-09-25',
          title: 'Guide',
        },
      })
      .mockReturnValueOnce(nextWorkspace.promise);
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(result.current.capturedId).toBe('source-in-old-workspace'));

    act(() => mocks.onOrganizationChange?.('new-workspace'));
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(2));
    expect(result.current).toMatchObject({ capturedId: null, loading: true });

    await act(async () => nextWorkspace.resolve({ status: 'none' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ capturedId: null, checkFailed: false });
  });

  it('ignores an old workspace lookup that finishes after the new workspace lookup', async () => {
    const oldWorkspace = deferredLookup();
    const nextWorkspace = deferredLookup();
    mocks.lookup
      .mockReturnValueOnce(oldWorkspace.promise)
      .mockReturnValueOnce(nextWorkspace.promise);
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(1));

    act(() => mocks.onOrganizationChange?.('new-workspace'));
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(2));
    await act(async () =>
      nextWorkspace.resolve({
        status: 'found',
        page: {
          id: 'source-in-new-workspace',
          url: 'u',
          captured_at: '2026-09-26',
          title: 'Guide',
        },
      }),
    );
    await waitFor(() => expect(result.current.capturedId).toBe('source-in-new-workspace'));

    await act(async () =>
      oldWorkspace.resolve({
        status: 'found',
        page: {
          id: 'source-in-old-workspace',
          url: 'u',
          captured_at: '2026-09-25',
          title: 'Guide',
        },
      }),
    );
    expect(result.current.capturedId).toBe('source-in-new-workspace');
  });

  it('rechecks a late saved broadcast in the current workspace before claiming a Source', async () => {
    mocks.lookup
      .mockResolvedValueOnce({ status: 'none' })
      .mockResolvedValueOnce({ status: 'none' });
    const { result } = renderHook(() => usePageRecognition());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => mocks.onOrganizationChange?.('new-workspace'));
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The background answer was produced in the previous workspace, after
    // the side panel had already switched. Its id cannot become this page's.
    mocks.lookup.mockResolvedValueOnce({ status: 'none' });
    act(() =>
      mocks.onPageAlreadyCaptured?.({
        url: 'https://docs.example.com/guide',
        id: 'source-in-old-workspace',
        capturedAt: '2026-09-25',
      }),
    );
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ capturedId: null, capturedAt: null });
  });
});
