import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({ ALARMS: { AGENDA_SCAN: 'agenda-scan' } }));
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/messaging/native', () => ({ send: vi.fn() }));
vi.mock('@/lib/agenda/context-match', () => ({
  cooldownElapsed: vi.fn(),
  tabMatchesTask: vi.fn(),
}));
vi.mock('@/lib/agenda/queries', () => ({
  claimDueFire: vi.fn(),
  computeNextDueAfterRun: vi.fn(),
  listContextMatchTasks: vi.fn(),
  listDueForSurface: vi.fn(),
  reapExpiredRuns: vi.fn(),
}));

describe('agenda panel remedy', () => {
  let clicked: ((notificationId: string) => Promise<void>) | null = null;
  const updates: Array<{ id: string; options: chrome.notifications.NotificationOptions<true> }> =
    [];
  const cleared: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    clicked = null;
    updates.length = 0;
    cleared.length = 0;
    globalThis.chrome = {
      notifications: {
        onClicked: {
          addListener: (listener: (notificationId: string) => void) => {
            clicked = listener as unknown as typeof clicked;
          },
        },
        update: async (id: string, options: chrome.notifications.NotificationOptions<true>) => {
          updates.push({ id, options });
          return true;
        },
        clear: async (id: string) => {
          cleared.push(id);
          return true;
        },
      },
      sidebarAction: { open: async () => undefined },
      storage: { session: { set: async () => undefined } },
    } as unknown as typeof chrome;
  });

  it('keeps a clicked Firefox Agenda notification visible with the toolbar remedy', async () => {
    const { registerAgendaNotificationClicks } = await import('@/lib/agenda/scanner');
    registerAgendaNotificationClicks();
    if (!clicked) throw new Error('Agenda notification listener was not registered');

    await clicked('matrx-agenda:task-1');

    expect(updates).toEqual([
      expect.objectContaining({
        id: 'matrx-agenda:task-1',
        options: expect.objectContaining({
          title: 'Matrx needs the toolbar to open',
          requireInteraction: true,
        }),
      }),
    ]);
    expect(cleared).toEqual([]);
  });

  it('keeps a rejected Chromium Agenda notification visible with the native reason', async () => {
    (globalThis.chrome as unknown as { sidebarAction?: unknown }).sidebarAction = undefined;
    (
      globalThis.chrome as unknown as { windows: { getCurrent: () => Promise<{ id: number }> } }
    ).windows = {
      getCurrent: async () => ({ id: 4 }),
    };
    (globalThis.chrome as unknown as { sidePanel: { open: () => Promise<void> } }).sidePanel = {
      open: async () => Promise.reject(new Error('Native Chrome refusal')),
    };
    const { registerAgendaNotificationClicks } = await import('@/lib/agenda/scanner');
    registerAgendaNotificationClicks();
    if (!clicked) throw new Error('Agenda notification listener was not registered');

    await clicked('matrx-agenda:task-2');

    expect(updates[0]?.options.message).toContain('Native Chrome refusal');
    expect(updates[0]?.options.message).toContain(
      'Open Matrx from the browser toolbar and try again.',
    );
    expect(cleared).toEqual([]);
  });

  it('keeps a synchronously refused Chromium Agenda notification visible with a recovery action', async () => {
    (globalThis.chrome as unknown as { sidebarAction?: unknown }).sidebarAction = undefined;
    (
      globalThis.chrome as unknown as { windows: { getCurrent: () => Promise<{ id: number }> } }
    ).windows = {
      getCurrent: async () => ({ id: 4 }),
    };
    (globalThis.chrome as unknown as { sidePanel: { open: () => never } }).sidePanel = {
      open: () => {
        throw new Error('Native Chrome synchronous refusal');
      },
    };
    const { registerAgendaNotificationClicks } = await import('@/lib/agenda/scanner');
    registerAgendaNotificationClicks();
    if (!clicked) throw new Error('Agenda notification listener was not registered');

    await clicked('matrx-agenda:task-synchronous-refusal');

    expect(updates[0]?.options.message).toContain('Native Chrome synchronous refusal');
    expect(updates[0]?.options.message).toContain(
      'Open Matrx from the browser toolbar and try again.',
    );
    expect(cleared).toEqual([]);
  });

  it('clears an Agenda notification only after Chromium opens the panel', async () => {
    (globalThis.chrome as unknown as { sidebarAction?: unknown }).sidebarAction = undefined;
    (
      globalThis.chrome as unknown as { windows: { getCurrent: () => Promise<{ id: number }> } }
    ).windows = {
      getCurrent: async () => ({ id: 4 }),
    };
    (globalThis.chrome as unknown as { sidePanel: { open: () => Promise<void> } }).sidePanel = {
      open: async () => undefined,
    };
    const { registerAgendaNotificationClicks } = await import('@/lib/agenda/scanner');
    registerAgendaNotificationClicks();
    if (!clicked) throw new Error('Agenda notification listener was not registered');

    await clicked('matrx-agenda:task-3');

    expect(updates).toEqual([]);
    expect(cleared).toEqual(['matrx-agenda:task-3']);
  });
});
