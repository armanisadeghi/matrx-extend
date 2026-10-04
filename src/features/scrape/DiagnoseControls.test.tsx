import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  listeners: new Map<string, (payload: never) => unknown>(),
  page: {
    id: 41,
    documentId: 'intake-document-a',
    pageKey: 'intake-page-a' as string | null,
    url: 'https://harbor-dental.test/intake',
    title: 'New patient intake',
    identityStatus: 'ready' as const,
    identityError: null as string | null,
  },
  executeScript: vi.fn(),
  copied: [] as string[],
}));

vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, handler: (payload: never) => unknown) => {
    bridge.listeners.set(kind, handler);
    return () => bridge.listeners.delete(kind);
  },
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => bridge.page,
  getActiveTabIdentitySnapshot: () => bridge.page,
  isCurrentPageIdentity: (pageKey: string | null) =>
    pageKey !== null && pageKey === bridge.page.pageKey,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock('@/lib/clipboard/copy', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/clipboard/copy')>();
  return {
    ...original,
    copyToClipboard: async (text: string) => {
      bridge.copied.push(text);
      return true;
    },
  };
});

import { DiagnoseCard, DiagnoseLauncher } from '@/features/scrape/DiagnoseCard';
import { useScrape } from '@/hooks/use-scrape';
import { CHANNELS } from '@/lib/messaging/schemas';
import { mountDiagnosePicker, unmountDiagnosePicker } from '@/lib/scrape/diagnose-picker';
import { useScrapeStore } from '@/state/scrape';

const pickerResult = (sessionId: string, mode: 'missing' | 'unwanted') => ({
  sessionId,
  mode,
  selectorChain: ['#insurance', 'main'],
  leafTag: 'div',
  leafHtml: '<div id="insurance">Insurance consent</div>',
  leafTruncated: false,
  parentHtml: '<main><div id="insurance">Insurance consent</div></main>',
  parentTruncated: false,
  siblingHtml: null,
  siblingTruncated: false,
  siblingCount: 0,
  leafTextPreview: 'Insurance consent',
  anchorCandidates: ['Insurance consent'],
  pickedAtUrl: bridge.page.url,
  pickedAtTitle: bridge.page.title,
});

beforeEach(() => {
  bridge.listeners.clear();
  bridge.page.pageKey = 'intake-page-a';
  bridge.executeScript.mockReset().mockResolvedValue([]);
  bridge.copied = [];
  useScrapeStore.getState().setCurrent(null);
  useScrapeStore.getState().clearDiagnose();
  const chrome = globalThis.chrome as typeof globalThis.chrome & Record<string, unknown>;
  chrome.scripting = { executeScript: bridge.executeScript } as never;
  chrome.runtime = { sendMessage: vi.fn().mockResolvedValue(undefined) } as never;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => bridge.copied.push(text) },
  });
});
afterEach(() => {
  unmountDiagnosePicker();
  document.body.innerHTML = '';
  cleanup();
  vi.restoreAllMocks();
});

describe('Scrape diagnose picker', () => {
  it('applies the active mode and the actual picked payload to the current page result', async () => {
    useScrapeStore.getState().setDiagnoseMode('unwanted');
    const hook = renderHook(() => useScrape());

    await act(async () => hook.result.current.launchDiagnose());

    expect(useScrapeStore.getState().diagnose.picking).toBe(true);
    expect(bridge.executeScript).toHaveBeenCalledTimes(2);
    const firstInjection = bridge.executeScript.mock.calls[0]?.[0] as {
      args: [string, string];
      target: { tabId: number; documentIds: string[] };
    };
    expect(firstInjection.args[0]).toBe('unwanted');
    expect(firstInjection.target).toEqual({ tabId: 41, documentIds: ['intake-document-a'] });

    act(() => {
      bridge.listeners.get(CHANNELS.DIAGNOSE_PICKER_RESULT)?.(
        pickerResult(firstInjection.args[1], 'unwanted') as never,
      );
    });

    const result = useScrapeStore.getState().diagnose.lastResult;
    expect(result).toMatchObject({
      pageKey: 'intake-page-a',
      mode: 'unwanted',
      leafHtml: '<div id="insurance">Insurance consent</div>',
      selectorChain: ['#insurance', 'main'],
    });
    expect(result?.capturedAt).toEqual(expect.any(Number));
    expect(useScrapeStore.getState().diagnose.picking).toBe(false);
    hook.unmount();
  });

  it('ends the current pick on cancel without applying a result', async () => {
    const hook = renderHook(() => useScrape());
    useScrapeStore.getState().setDiagnoseLaunchError({
      pageKey: 'intake-page-a',
      message: 'Previous picker failure',
    });
    await act(async () => hook.result.current.launchDiagnose());
    const firstInjection = bridge.executeScript.mock.calls[0]?.[0] as { args: [string, string] };
    act(() => {
      bridge.listeners.get(CHANNELS.DIAGNOSE_PICKER_EXIT)?.({
        sessionId: firstInjection.args[1],
      } as never);
    });

    expect(useScrapeStore.getState().diagnose.picking).toBe(false);
    expect(useScrapeStore.getState().diagnose.lastResult).toBeNull();
    expect(useScrapeStore.getState().diagnose.launchError).toBeNull();
    hook.unmount();
  });

  it('ignores a result captured for the previous page after navigation', async () => {
    const hook = renderHook(() => useScrape());
    await act(async () => hook.result.current.launchDiagnose());
    const firstInjection = bridge.executeScript.mock.calls[0]?.[0] as { args: [string, string] };

    bridge.page.pageKey = 'intake-page-b';
    hook.rerender();
    act(() => {
      bridge.listeners.get(CHANNELS.DIAGNOSE_PICKER_RESULT)?.(
        pickerResult(firstInjection.args[1], 'missing') as never,
      );
    });

    expect(useScrapeStore.getState().diagnose.picking).toBe(false);
    expect(useScrapeStore.getState().diagnose.lastResult).toBeNull();
    hook.unmount();
  });

  it('shows a picker-specific retry after script injection fails without losing the capture', async () => {
    const injectionError = new Error('content script unavailable');
    bridge.executeScript.mockRejectedValueOnce(injectionError);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hook = renderHook(() => useScrape());
    const captured = { article: { title: 'New patient intake' } } as never;
    useScrapeStore.getState().setCurrent(captured, bridge.page.pageKey);
    render(<DiagnoseLauncher onLaunch={() => void hook.result.current.launchDiagnose()} />);

    await act(async () => hook.result.current.launchDiagnose());

    expect(useScrapeStore.getState().diagnose.picking).toBe(false);
    expect(useScrapeStore.getState().diagnose.lastResult).toBeNull();
    expect(useScrapeStore.getState().current).toBe(captured);
    expect(screen.getByRole('alert').textContent).toContain('could not start');
    expect(screen.getByRole('button', { name: 'Retry picker' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry picker' }));
    await vi.waitFor(() => expect(useScrapeStore.getState().diagnose.picking).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bridge.executeScript).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalledWith(
      '[matrx-extend] diagnose picker injection failed',
      injectionError,
    );
    hook.unmount();
  });

  it('ignores an old launch failure after a newer picker starts', async () => {
    let rejectOld: ((error: Error) => void) | undefined;
    bridge.executeScript.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hook = renderHook(() => useScrape());
    let oldLaunch: Promise<void> | undefined;
    act(() => {
      oldLaunch = hook.result.current.launchDiagnose();
    });
    await act(async () => hook.result.current.launchDiagnose());
    const secondInjection = bridge.executeScript.mock.calls[1]?.[0] as { args: [string, string] };
    await act(async () => {
      rejectOld?.(new Error('old document denied'));
      await oldLaunch;
    });

    expect(useScrapeStore.getState().diagnose.picking).toBe(true);
    expect(useScrapeStore.getState().diagnose.launchError).toBeNull();
    expect(warning).not.toHaveBeenCalled();
    act(() =>
      bridge.listeners.get(CHANNELS.DIAGNOSE_PICKER_RESULT)?.(
        pickerResult(secondInjection.args[1], 'missing') as never,
      ),
    );
    expect(useScrapeStore.getState().diagnose.lastResult?.sessionId).toBe(secondInjection.args[1]);
    expect(useScrapeStore.getState().diagnose.launchError).toBeNull();
    hook.unmount();
  });

  it('dismisses a launch error without changing the captured page', async () => {
    const captured = { article: { title: 'New patient intake' } } as never;
    useScrapeStore.getState().setCurrent(captured, bridge.page.pageKey);
    useScrapeStore.getState().setDiagnoseLaunchError({
      pageKey: 'intake-page-a',
      message: 'Picker could not start.',
    });
    render(<DiagnoseLauncher onLaunch={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useScrapeStore.getState().current).toBe(captured);
  });

  it('does not inject a stale document after its mode stamp resolves', async () => {
    let resolveOld: ((value: unknown[]) => void) | undefined;
    bridge.executeScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const hook = renderHook(() => useScrape());
    let oldLaunch: Promise<void> | undefined;
    act(() => {
      oldLaunch = hook.result.current.launchDiagnose();
    });
    bridge.page.pageKey = 'intake-page-b';
    hook.rerender();
    await act(async () => hook.result.current.launchDiagnose());
    await act(async () => {
      resolveOld?.([]);
      await oldLaunch;
    });

    expect(bridge.executeScript).toHaveBeenCalledTimes(3);
    expect(useScrapeStore.getState().diagnose.picking).toBe(true);
    expect(useScrapeStore.getState().diagnose.launchError).toBeNull();
    hook.unmount();
  });
});

describe('diagnose picker page component', () => {
  it('captures a real selected element and sends its chosen mode and session', () => {
    document.body.innerHTML = '<main><button id="insurance">Insurance consent</button></main>';
    mountDiagnosePicker('missing', 'session-dom-a');
    const target = document.querySelector('#insurance');
    expect(target).not.toBeNull();
    expect(
      document.querySelector('#matrx-diagnose-picker-host')?.shadowRoot?.textContent,
    ).toContain('SHOULD be in the scrape');

    fireEvent.click(target as HTMLButtonElement);

    const message = vi.mocked(chrome.runtime.sendMessage).mock.calls.at(-1)?.[0] as unknown as {
      kind: string;
      payload: { mode: string; sessionId: string; leafHtml: string; selectorChain: string[] };
    };
    expect(message).toMatchObject({
      kind: CHANNELS.DIAGNOSE_PICKER_RESULT,
      payload: {
        mode: 'missing',
        sessionId: 'session-dom-a',
        leafHtml: '<button id="insurance">Insurance consent</button>',
      },
    });
    expect(message.payload.selectorChain.join(' ')).toContain('#insurance');
    expect(document.querySelector('#matrx-diagnose-picker-host')).toBeNull();
  });

  it('returns to the page when Escape cancels the active picker', () => {
    mountDiagnosePicker('unwanted', 'session-escape-a');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
      __matrx: true,
      kind: CHANNELS.DIAGNOSE_PICKER_EXIT,
      payload: { mode: 'unwanted', sessionId: 'session-escape-a' },
    });
    expect(document.querySelector('#matrx-diagnose-picker-host')).toBeNull();
  });

  it('sends picker exit when capture of the clicked element throws', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.innerHTML = '<button id="broken">Target</button>';
    const target = document.querySelector('#broken') as HTMLButtonElement;
    Object.defineProperty(target, 'outerHTML', {
      get: () => {
        throw new Error('capture denied');
      },
    });
    mountDiagnosePicker('missing', 'session-error-a');

    fireEvent.click(target);

    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({
      __matrx: true,
      kind: CHANNELS.DIAGNOSE_PICKER_EXIT,
      payload: { mode: 'missing', sessionId: 'session-error-a' },
    });
    expect(warning).toHaveBeenCalledWith(
      '[matrx-extend] diagnose capture failed',
      expect.objectContaining({ message: 'capture denied' }),
    );
  });
});

describe('diagnose controls and result card', () => {
  it('shows the selected mode and prevents launching while a pick is active', async () => {
    const onLaunch = vi.fn();
    const user = userEvent.setup();
    render(<DiagnoseLauncher onLaunch={onLaunch} />);
    await user.click(screen.getByRole('button', { name: 'Unwanted' }));
    expect(useScrapeStore.getState().diagnose.mode).toBe('unwanted');
    await user.click(screen.getByRole('button', { name: 'Pick on page' }));
    expect(onLaunch).toHaveBeenCalledOnce();

    cleanup();
    useScrapeStore.getState().setDiagnosePicking(true);
    render(<DiagnoseLauncher onLaunch={onLaunch} />);
    expect((screen.getByRole('button', { name: 'Picking…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows result sections, copies distinct formats, retains the note, and dismisses the result', async () => {
    const user = userEvent.setup();
    useScrapeStore.getState().setDiagnoseResult({
      ...pickerResult('session-card-a', 'unwanted'),
      pageKey: 'intake-page-a',
      capturedAt: 1_800_000_000_000,
    });
    render(<DiagnoseCard />);

    expect(screen.getByText('Unwanted element')).toBeTruthy();
    await user.type(
      screen.getByPlaceholderText(/Why shouldn.t this be in the scrape/),
      'Menu noise',
    );
    await user.click(screen.getByRole('button', { name: 'Selectors (2)' }));
    await user.click(screen.getByRole('button', { name: 'HTML' }));
    expect(screen.getByText('L0:', { exact: false })).toBeTruthy();
    expect(screen.getByText('<div id="insurance">Insurance consent</div>')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Copy diagnose bundle' }));
    await user.click(screen.getByRole('button', { name: /Selectors only/ }));
    await vi.waitFor(() => expect(bridge.copied.at(-1)).toBe('L0: #insurance\nL1: main'));
    await user.click(screen.getByRole('button', { name: 'Copy diagnose bundle' }));
    await user.click(screen.getByRole('button', { name: /Leaf HTML only/ }));
    await vi.waitFor(() =>
      expect(bridge.copied.at(-1)).toBe('<div id="insurance">Insurance consent</div>'),
    );
    expect(bridge.copied[0]).not.toBe(bridge.copied[1]);

    await user.click(screen.getByRole('button', { name: 'Copy diagnose bundle' }));
    await user.click(screen.getByRole('button', { name: /For AI agent/ }));
    await vi.waitFor(() => expect(bridge.copied.at(-1)).toContain('Menu noise'));
    expect(bridge.copied.at(-1)).toContain('Unwanted element');

    await user.click(screen.getByTitle('Dismiss'));
    expect(useScrapeStore.getState().diagnose.lastResult).toBeNull();
    expect(useScrapeStore.getState().diagnose.draftNote).toBe('');
  });

  it('hides a result captured for another active page', () => {
    useScrapeStore.getState().setDiagnoseResult({
      ...pickerResult('session-stale-a', 'missing'),
      pageKey: 'intake-page-old',
      capturedAt: 1_800_000_000_000,
    });
    render(<DiagnoseCard />);
    expect(screen.queryByText('Missing element')).toBeNull();
  });
});
