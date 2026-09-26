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
  });

  afterEach(async () => {
    const { POPUP_LAUNCH_INTENT_KEY } = await import('@/lib/panel/launch-intent');
    await chrome.storage.session.remove(POPUP_LAUNCH_INTENT_KEY);
    document.body.innerHTML = '';
  });

  it('hands Capture page to Scrape once, while Open chat leaves the panel route alone', async () => {
    const { POPUP_LAUNCH_INTENT_KEY, takePopupLaunchTarget } = await import(
      '@/lib/panel/launch-intent'
    );
    const set = vi.spyOn(chrome.storage.session, 'set');
    await import('@/entrypoints/popup/main');

    await userEvent.click(await screen.findByRole('button', { name: 'Open chat' }));
    expect(set).not.toHaveBeenCalled();
    expect(await takePopupLaunchTarget()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Capture page' }));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        [POPUP_LAUNCH_INTENT_KEY]: expect.objectContaining({ kind: 'capture-page' }),
      }),
    );

    expect(await takePopupLaunchTarget()).toBe('scrape');
    expect(await takePopupLaunchTarget()).toBeNull();
    expect(await chrome.storage.session.get([POPUP_LAUNCH_INTENT_KEY])).toEqual({});
    set.mockRestore();
  });
});
