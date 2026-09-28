import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: { id: 23, url: 'https://example.org/a', title: 'A' } as {
    id: number;
    url: string;
    title: string;
  },
  preparePage: vi.fn(),
}));

vi.mock('@/hooks/use-active-tab', () => ({ useActiveTab: () => mocks.tab }));
vi.mock('@/lib/data-pattern/page-prep', () => ({
  defaultPagePrepConfig: { dismissBanners: true, expandLoadMore: true, scrollToBottom: true },
  preparePage: mocks.preparePage,
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

import { PrepareTab } from '@/features/showcase/tabs/PrepareTab';
import { usePagePrep } from '@/hooks/use-page-prep';

type Report = Awaited<ReturnType<typeof usePagePrep>>['report'];

function report(duration_ms: number, label: string): NonNullable<Report> {
  return {
    duration_ms,
    banners_dismissed: [{ selector: '#consent', text: label }],
    load_more_clicks: [],
    scroll_steps: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.tab = { id: 23, url: 'https://example.org/a', title: 'A' };
  mocks.preparePage.mockReset();
});

describe('Prepare current-attempt lifecycle', () => {
  it('clears a previous success during retry and shows only the failed attempt afterward', async () => {
    const second = deferred<NonNullable<Report>>();
    mocks.preparePage
      .mockResolvedValueOnce(report(91, 'first banner'))
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(<PrepareTab />);

    await user.click(screen.getByRole('button', { name: 'Prepare page' }));
    expect(await screen.findByText('Prepared in 91ms')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Prepare page' }));
    expect(screen.queryByText('Prepared in 91ms')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeTruthy();

    await act(async () => {
      second.reject(new Error('Script access denied'));
    });
    expect(screen.getByText('Script access denied')).toBeTruthy();
    expect(screen.queryByText(/Prepared in/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Prepare page' })).toBeTruthy();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a late %s from A after navigation and accepts a fresh B result',
    async (settlement) => {
      const oldRun = deferred<NonNullable<Report>>();
      mocks.preparePage
        .mockReturnValueOnce(oldRun.promise)
        .mockResolvedValueOnce(report(45, 'B banner'));
      const hook = renderHook(() => usePagePrep());
      let oldPromise!: Promise<Report>;
      act(() => {
        oldPromise = hook.result.current.run();
      });
      expect(hook.result.current.running).toBe(true);

      mocks.tab = { id: 23, url: 'https://example.org/b', title: 'B' };
      hook.rerender();
      expect(hook.result.current).toMatchObject({ report: null, error: null, running: false });
      await act(async () => {
        if (settlement === 'resolve') oldRun.resolve(report(88, 'A banner'));
        else oldRun.reject(new Error('A access denied'));
        await oldPromise;
      });
      expect(hook.result.current).toMatchObject({ report: null, error: null, running: false });

      await act(async () => {
        await hook.result.current.run();
      });
      expect(mocks.preparePage).toHaveBeenLastCalledWith(23, {});
      expect(hook.result.current.report).toEqual(report(45, 'B banner'));
      expect(hook.result.current.error).toBeNull();
    },
  );

  it('keeps newer overlapping run status when the older run finishes later', async () => {
    const older = deferred<NonNullable<Report>>();
    const newer = deferred<NonNullable<Report>>();
    mocks.preparePage.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const hook = renderHook(() => usePagePrep());
    let first!: Promise<Report>;
    let second!: Promise<Report>;
    act(() => {
      first = hook.result.current.run();
      second = hook.result.current.run();
    });
    await act(async () => {
      older.resolve(report(99, 'old'));
      await first;
    });
    expect(hook.result.current).toMatchObject({ report: null, error: null, running: true });
    await act(async () => {
      newer.resolve(report(33, 'new'));
      await second;
    });
    expect(hook.result.current.report).toEqual(report(33, 'new'));
    expect(hook.result.current.running).toBe(false);
  });

  it.each(['before', 'after'] as const)(
    'ignores an older rejection %s the newer result settles',
    async (order) => {
      const older = deferred<NonNullable<Report>>();
      const newer = deferred<NonNullable<Report>>();
      mocks.preparePage.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const hook = renderHook(() => usePagePrep());
      let first!: Promise<Report>;
      let second!: Promise<Report>;
      act(() => {
        first = hook.result.current.run();
        second = hook.result.current.run();
      });

      if (order === 'before') {
        await act(async () => {
          older.reject(new Error('old access denied'));
          await first;
        });
        expect(hook.result.current).toMatchObject({ report: null, error: null, running: true });
      }
      await act(async () => {
        newer.resolve(report(33, 'new'));
        await second;
      });
      expect(hook.result.current).toMatchObject({
        report: report(33, 'new'),
        error: null,
        running: false,
      });
      if (order === 'after') {
        await act(async () => {
          older.reject(new Error('old access denied'));
          await first;
        });
        expect(hook.result.current).toMatchObject({
          report: report(33, 'new'),
          error: null,
          running: false,
        });
      }
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'reset cancels a late %s and releases the running state',
    async (settlement) => {
      const pending = deferred<NonNullable<Report>>();
      mocks.preparePage.mockReturnValue(pending.promise);
      const hook = renderHook(() => usePagePrep());
      let completion!: Promise<Report>;
      act(() => {
        completion = hook.result.current.run();
      });
      act(() => hook.result.current.reset());
      expect(hook.result.current).toMatchObject({ report: null, error: null, running: false });
      await act(async () => {
        if (settlement === 'resolve') pending.resolve(report(60, 'old'));
        else pending.reject(new Error('old access denied'));
        await completion;
      });
      expect(hook.result.current).toMatchObject({ report: null, error: null, running: false });
    },
  );

  it('unmount discards an in-flight error and allows a new mount to prepare independently', async () => {
    const pending = deferred<NonNullable<Report>>();
    mocks.preparePage
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(report(22, 'fresh'));
    const first = renderHook(() => usePagePrep());
    let completion!: Promise<Report>;
    act(() => {
      completion = first.result.current.run();
    });
    first.unmount();
    await act(async () => {
      pending.reject(new Error('old failure'));
      await completion;
    });
    const second = renderHook(() => usePagePrep());
    await act(async () => {
      await second.result.current.run();
    });
    expect(second.result.current.report).toEqual(report(22, 'fresh'));
    expect(second.result.current.error).toBeNull();
  });
});
