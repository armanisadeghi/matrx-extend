import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('assigned tab resolution', () => {
  it('refuses a closed explicit assignment instead of falling back to the focused tab', async () => {
    const query = vi.fn(async () => [{ id: 99 }]);
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => {
          throw new Error('No tab with id: 7');
        }),
        query,
      },
    });
    const { getAssignedTab } = await import('@/lib/tools/handlers/_active-tab');
    await expect(getAssignedTab({ assignedTabId: 7 } as never)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the focused-tab path for an explicit null assignment', async () => {
    const focused = { id: 99 } as chrome.tabs.Tab;
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn(), query: vi.fn(async () => [focused]) },
    });
    const { getAssignedTab } = await import('@/lib/tools/handlers/_active-tab');
    await expect(getAssignedTab({ assignedTabId: null } as never)).resolves.toBe(focused);
  });
});
