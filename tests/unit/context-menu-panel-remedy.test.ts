import { beforeEach, describe, expect, it, vi } from 'vitest';

const broadcast = vi.hoisted(() => vi.fn());

vi.mock('@/lib/debug/log', () => ({ log: { warn: vi.fn() } }));
vi.mock('@/lib/messaging/native', () => ({ broadcast }));

describe('context-menu panel remedy', () => {
  let clicked:
    | ((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => Promise<void>)
    | null = null;
  const stored: Array<Record<string, unknown>> = [];
  const notifications: Array<{
    id: string;
    options: chrome.notifications.NotificationOptions<true>;
  }> = [];
  const order: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    clicked = null;
    stored.length = 0;
    notifications.length = 0;
    order.length = 0;
    globalThis.chrome = {
      contextMenus: {
        removeAll: (callback?: () => void) => callback?.(),
        create: () => undefined,
        onClicked: {
          addListener: (
            listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void,
          ) => {
            clicked = listener as unknown as typeof clicked;
          },
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: {
        session: {
          set: async (values: Record<string, unknown>) => {
            order.push('storage');
            stored.push(values);
          },
        },
      },
      notifications: {
        create: async (id: string, options: chrome.notifications.NotificationOptions<true>) => {
          notifications.push({ id, options });
          return id;
        },
      },
      sidebarAction: {
        open: () => {
          throw new Error('Firefox rejected sidebar open');
        },
      },
    } as unknown as typeof chrome;
  });

  it('keeps the draft and broadcasts it while showing the synchronous Firefox remedy', async () => {
    const { setupContextMenus } = await import('@/lib/context-menus/setup');
    setupContextMenus();
    if (!clicked) throw new Error('Context-menu listener was not registered');

    await clicked(
      {
        menuItemId: 'matrx.menu.ask-selection',
        selectionText: 'Summarize this',
      } as chrome.contextMenus.OnClickData,
      { windowId: 4 } as chrome.tabs.Tab,
    );

    expect(stored).toEqual([{ 'matrx.chat.pending_draft': 'Summarize this' }]);
    expect(broadcast).toHaveBeenCalledWith('chat:draft-from-selection', { text: 'Summarize this' });
    expect(notifications).toEqual([
      expect.objectContaining({
        id: 'matrx-panel-open-remedy',
        options: expect.objectContaining({ title: 'Open Matrx from the toolbar' }),
      }),
    ]);
  });

  it('invokes Chromium native open before a pending durable draft write', async () => {
    let releaseStorage!: () => void;
    const storagePending = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });
    (globalThis.chrome as unknown as { sidebarAction?: unknown }).sidebarAction = undefined;
    (
      globalThis.chrome as unknown as { sidePanel: { open: (request: unknown) => Promise<void> } }
    ).sidePanel = {
      open: async () => void order.push('open'),
    };
    globalThis.chrome.storage.session.set = async (values: Record<string, unknown>) => {
      order.push('storage');
      stored.push(values);
      await storagePending;
    };
    const { setupContextMenus } = await import('@/lib/context-menus/setup');
    setupContextMenus();
    if (!clicked) throw new Error('Context-menu listener was not registered');

    const settled = clicked(
      {
        menuItemId: 'matrx.menu.ask-selection',
        selectionText: 'Summarize this',
      } as chrome.contextMenus.OnClickData,
      { windowId: 4 } as chrome.tabs.Tab,
    );
    await Promise.resolve();
    expect(order).toEqual(['open', 'storage']);
    releaseStorage();
    await settled;
  });

  it.each([
    [{ menuItemId: 'unknown.menu', selectionText: 'text' }, 'unknown menu'],
    [{ menuItemId: 'matrx.menu.ask-selection', selectionText: '   ' }, 'empty selection'],
  ])('does nothing for an %s', async (info) => {
    const { setupContextMenus } = await import('@/lib/context-menus/setup');
    setupContextMenus();
    if (!clicked) throw new Error('Context-menu listener was not registered');

    await clicked(info as chrome.contextMenus.OnClickData, { windowId: 4 } as chrome.tabs.Tab);

    expect(order).toEqual([]);
    expect(stored).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });
});
