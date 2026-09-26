import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const panel = vi.hoisted(() => ({
  open: vi.fn(() => ({ promise: Promise.resolve(), reason: 'pending' })),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'admin@admin.com' }, signIn: vi.fn(), status: 'signed-in' }),
}));
vi.mock('@/lib/panel/adapter', () => ({
  openFirefoxSidebarFromGesture: () => null,
  openPanel: panel.open,
  panelOpenRemedy: (reason: string) => reason,
}));

describe('popup capture route', () => {
  beforeEach(() => {
    vi.resetModules();
    panel.open.mockClear();
    document.body.innerHTML = '<div id="app"></div>';
    window.close = vi.fn();
    globalThis.chrome.tabs = {
      query: vi.fn(async () => [{ windowId: 9 }]),
    } as unknown as typeof chrome.tabs;
    globalThis.chrome.windows = {
      getCurrent: vi.fn(async () => ({ id: 9 })),
    } as unknown as typeof chrome.windows;
  });

  afterEach(async () => {
    const { POPUP_LAUNCH_INTENT_KEY } = await import('@/lib/panel/launch-intent');
    await chrome.storage.session.remove(POPUP_LAUNCH_INTENT_KEY);
    document.body.innerHTML = '';
  });

  it('hands Capture page to its own Scrape panel once, while Open chat leaves the panel route alone', async () => {
    const { POPUP_LAUNCH_INTENT_KEY, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    const set = vi.spyOn(chrome.storage.session, 'set');
    await import('@/entrypoints/popup/main');

    await userEvent.click(await screen.findByRole('button', { name: 'Open chat' }));
    expect(set).not.toHaveBeenCalled();
    expect(await takePopupLaunchTarget(9)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Capture page' }));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        [POPUP_LAUNCH_INTENT_KEY]: expect.objectContaining({ kind: 'capture-page', windowId: 9 }),
      }),
    );

    expect(await takePopupLaunchTarget(9)).toBe('scrape');
    expect(await takePopupLaunchTarget(9)).toBeNull();
    expect(await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY])).toEqual({});
    set.mockRestore();
  });

  it('never routes a second browser window, then lets the initiating window claim it', async () => {
    const { requestCapturePagePanel, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    const request = requestCapturePagePanel(9);
    await request.write;

    expect(await takePopupLaunchTarget(10)).toBeNull();
    expect(await takePopupLaunchTarget(9)).toBe('scrape');
  });

  it('serializes concurrent claims so only one callback can route the page', async () => {
    const { requestCapturePagePanel, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    const request = requestCapturePagePanel(9);
    await request.write;

    await expect(
      Promise.all([takePopupLaunchTarget(9), takePopupLaunchTarget(9)]),
    ).resolves.toEqual(['scrape', null]);
  });

  it('fails closed when removing a claimed intent fails', async () => {
    const { requestCapturePagePanel, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    const request = requestCapturePagePanel(9);
    await request.write;
    const remove = vi
      .spyOn(chrome.storage.session, 'remove')
      .mockRejectedValueOnce(new Error('remove failed'));

    await expect(takePopupLaunchTarget(9)).resolves.toBeNull();
    remove.mockRestore();
  });

  it('clears its own pending intent and names a native panel refusal', async () => {
    panel.open.mockReturnValueOnce({
      promise: null,
      reason: 'Native panel refusal',
    } as unknown as ReturnType<typeof panel.open>);
    const { POPUP_LAUNCH_INTENT_KEY, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    await import('@/entrypoints/popup/main');

    await userEvent.click(await screen.findByRole('button', { name: 'Capture page' }));
    await vi.waitFor(async () => {
      expect(screen.getByRole('alert').textContent).toContain('Native panel refusal');
      expect(await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY])).toEqual({});
    });
    await userEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(await takePopupLaunchTarget(9)).toBeNull();
  });

  it('clears its own pending intent when native panel opening rejects', async () => {
    let rejectPanel!: (reason?: unknown) => void;
    panel.open.mockReturnValueOnce({
      promise: new Promise<void>((_resolve, reject) => {
        rejectPanel = reject;
      }),
      reason: 'pending',
    });
    const { POPUP_LAUNCH_INTENT_KEY } = await import('@/lib/panel/launch-intent');
    await import('@/entrypoints/popup/main');

    await userEvent.click(await screen.findByRole('button', { name: 'Capture page' }));
    rejectPanel(new Error('Native panel rejected'));
    await vi.waitFor(async () => {
      expect(screen.getByRole('alert').textContent).toContain('Native panel rejected');
      expect(await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY])).toEqual({});
    });
  });

  it('clears only the failed click, leaving a newer capture intent intact', async () => {
    const { clearCapturePagePanel, requestCapturePagePanel, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    const failed = requestCapturePagePanel(9);
    await failed.write;
    const newer = requestCapturePagePanel(9);
    await newer.write;

    await expect(clearCapturePagePanel(failed)).resolves.toBe(false);
    expect(await takePopupLaunchTarget(9)).toBe('scrape');
  });

  it('shows a capture preparation failure instead of leaving a redirect behind', async () => {
    const set = vi
      .spyOn(chrome.storage.session, 'set')
      .mockRejectedValueOnce(new Error('write failed'));
    const { POPUP_LAUNCH_INTENT_KEY } = await import('@/lib/panel/launch-intent');
    await import('@/entrypoints/popup/main');

    await userEvent.click(await screen.findByRole('button', { name: 'Capture page' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain("Couldn't prepare Capture page"),
    );
    expect(await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY])).toEqual({});
    set.mockRestore();
  });
});
