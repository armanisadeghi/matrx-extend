import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/AuthGate', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/NoticeHost', () => ({ NoticeHost: () => null }));
vi.mock('@/components/PermissionPromptModal', () => ({ PermissionPromptModal: () => null }));
vi.mock('@/components/UserMenu', () => ({ UserMenu: () => null }));
vi.mock('@/features/org/OrganizationPickerDialog', () => ({
  OrganizationPickerDialog: () => null,
}));
vi.mock('@/features/vault/LocalBrowserApprovalHost', () => ({
  LocalBrowserApprovalHost: () => null,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: null, url: null, title: null }),
}));
vi.mock('@/hooks/use-agenda-listener', () => ({ useAgendaListener: () => undefined }));
vi.mock('@/hooks/use-auto-extract', () => ({ useAutoExtract: () => undefined }));
vi.mock('@/hooks/use-auto-scrape', () => ({ useAutoScrape: () => undefined }));
vi.mock('@/hooks/use-context-menu-listener', () => ({ useContextMenuListener: () => undefined }));
vi.mock('@/hooks/use-guidance-sync', () => ({ useGuidanceSync: () => undefined }));
vi.mock('@/hooks/use-highlight-bridge', () => ({ useHighlightBridge: () => undefined }));
vi.mock('@/hooks/use-parallel-event-bridge', () => ({ useParallelEventBridge: () => undefined }));
vi.mock('@/features/capture-ladder/use-capture-pickup', () => ({ useCapturePickup: () => null }));
vi.mock('@/features/capture-ladder/use-needs-you-count', () => ({
  useNeedsYouCount: () => ({ count: 0, elsewhereTotal: 0, label: 'Capture', live: false }),
}));
vi.mock('@/lib/agents/catalog', () => ({ getAgentCatalog: () => ({}) }));
vi.mock('@/lib/debug/log', () => ({
  useDebugStore: (selector: (state: { events: never[] }) => unknown) => selector({ events: [] }),
}));
vi.mock('@/lib/auth/identity', () => ({ logExtensionIdentityOnce: vi.fn() }));
vi.mock('@/lib/messaging/native', () => ({
  on: () => () => undefined,
  send: () => Promise.resolve({ state: 'none' }),
}));
vi.mock('@/features/chat/ChatView', () => ({ ChatView: () => <div>Chat</div> }));
vi.mock('@/features/scrape/ScrapeView', () => ({ ScrapeView: () => <div>Scrape</div> }));
vi.mock('@ai-matrx/agents/catalog/react', () => ({
  AgentCatalogProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@ai-matrx/design-system', () => ({
  ConfirmDialogHost: () => null,
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) =>
    value === 'chat' ? <div>{children}</div> : null,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('popup capture claim recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    globalThis.chrome.windows = {
      getCurrent: vi.fn(async () => ({ id: 9 })),
    } as unknown as typeof chrome.windows;
    globalThis.chrome.runtime = {
      getContexts: vi.fn(async () => [
        { contextId: 'panel-9', contextType: 'SIDE_PANEL', windowId: 9 },
      ]),
    } as unknown as typeof chrome.runtime;
    globalThis.chrome.storage.onChanged = {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as typeof chrome.storage.onChanged;
  });

  afterEach(async () => {
    const { POPUP_LAUNCH_INTENT_KEY } = await import('@/lib/panel/launch-intent');
    const rows = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(
      Object.keys(rows).filter((key) => key.startsWith(`${POPUP_LAUNCH_INTENT_KEY}.`)),
    );
    vi.restoreAllMocks();
  });

  it('announces a quarantined claim failure and only routes after Open Scrape', async () => {
    const { armCapturePagePanel, requestCapturePagePanel } = await import(
      '@/lib/panel/launch-intent'
    );
    const request = requestCapturePagePanel(9);
    await request.write;
    await armCapturePagePanel(request, 'panel-9');
    vi.spyOn(chrome.storage.session, 'remove').mockRejectedValueOnce(new Error('remove failed'));

    const { useSidepanelTabStore } = await import('@/state/sidepanel-tab');
    useSidepanelTabStore.getState().setTab('chat');
    const { App } = await import('@/entrypoints/sidepanel/App');
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Capture did not open');
    expect(useSidepanelTabStore.getState().tab).toBe('chat');

    await userEvent.click(screen.getByRole('button', { name: 'Open Scrape' }));
    expect(useSidepanelTabStore.getState().tab).toBe('scrape');
    expect(screen.queryByRole('alert')).toBeNull();

    const { takePopupLaunchTarget } = await import('@/lib/panel/launch-intent');
    await expect(takePopupLaunchTarget(9, 'panel-9')).resolves.toEqual({ status: 'none' });
  });
});
