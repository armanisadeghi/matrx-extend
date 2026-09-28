import { beforeEach, describe, expect, it, vi } from 'vitest';
import { take_screenshot } from './read';

describe('take_screenshot document ownership', () => {
  const url = 'https://harbordental.test/intake';
  let documentId = 'harbor-intake-first';
  let activeTabId = 18;
  const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,AAAA');
  const ctx = {
    conversationId: null,
    runId: 'harbor-intake-run',
    callId: 'harbor-intake-capture',
    agentName: 'assistant',
    permissionMode: 'act' as const,
    assignedTabId: 18,
  };

  beforeEach(() => {
    documentId = 'harbor-intake-first';
    activeTabId = 18;
    captureVisibleTab.mockReset();
    captureVisibleTab.mockResolvedValue('data:image/png;base64,AAAA');
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => ({ id: 18, windowId: 4, url, title: 'Harbor Dental intake' })),
        query: vi.fn(async () => [{ id: activeTabId }]),
        captureVisibleTab,
      },
      webNavigation: { getFrame: vi.fn(async () => ({ documentId, url })) },
    });
  });

  it('refuses to process or persist a same-URL replacement captured during the window API call', async () => {
    captureVisibleTab.mockImplementationOnce(async () => {
      documentId = 'harbor-intake-reloaded';
      return 'data:image/png;base64,AAAA';
    });
    const result = await take_screenshot.run({ mode: 'visible', persist: true } as never, ctx);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/page changed during screenshot/i);
    expect(captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('refuses the agent-assigned tab when another tab owns the visible window', async () => {
    activeTabId = 19;
    const result = await take_screenshot.run({ mode: 'visible', persist: true } as never, ctx);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/active tab changed/i);
    expect(captureVisibleTab).not.toHaveBeenCalled();
  });
});
