import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestUpdateCheck: vi.fn(),
  getEnginePortOverride: vi.fn(),
  setEnginePortOverride: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <section aria-label={label}>{children}</section>
  ),
}));
vi.mock('@/features/settings/AdvancedAgentCapabilities', () => ({
  AdvancedAgentCapabilities: () => null,
}));
vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({
    active: null,
    organizations: [],
    error: null,
    loading: false,
    mustChoose: false,
    choose: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null, signIn: vi.fn(), signOut: vi.fn(), isAdmin: false }),
}));
vi.mock('@/hooks/use-desktop', () => ({
  useDesktopBridge: () => ({ transport: 'none', health: null }),
}));
vi.mock('@/lib/desktop/discovery', () => ({
  getEnginePortOverride: mocks.getEnginePortOverride,
  setEnginePortOverride: mocks.setEnginePortOverride,
}));
vi.mock('@/lib/desktop/http', () => ({ clearPairToken: vi.fn(), setPairToken: vi.fn() }));
vi.mock('@/lib/desktop/types', () => ({
  desktopStatusTextClass: () => '',
  engineHealthState: () => 'ok',
  formatDesktopConnectionLabel: () => 'Not connected',
}));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));
vi.mock('@/lib/mandates', () => ({ DEFAULT_CHAT_MANDATE_KEY: 'test' }));
vi.mock('@/lib/messaging/native', () => ({ send: mocks.send }));
vi.mock('@/lib/messaging/schemas', () => ({ CHANNELS: { DESKTOP_REDISCOVER: 'rediscover' } }));
vi.mock('@/state/settings', () => ({
  useSettingsStore: () => ({
    theme: 'system',
    defaultAgentId: null,
    defaultPermissionMode: 'ask',
    defaultChatSpeed: 'fast',
    scrapeDeepClean: false,
    scrapeAutoOnLoad: false,
    scrapeAutoMode: 'capture',
    sharePageIdentity: false,
    captureLoginsEnabled: true,
    offerSavedLoginsEnabled: true,
    credentialAssistancePresentation: 'quiet',
    setTheme: vi.fn(),
    setDefaultAgentId: vi.fn(),
    setDefaultPermissionMode: vi.fn(),
    setDefaultChatSpeed: vi.fn(),
    setScrapeDeepClean: vi.fn(),
    setScrapeAutoOnLoad: vi.fn(),
    setScrapeAutoMode: vi.fn(),
    setSharePageIdentity: vi.fn(),
    setCaptureLoginsEnabled: vi.fn(),
    setOfferSavedLoginsEnabled: vi.fn(),
    setCredentialAssistancePresentation: vi.fn(),
  }),
}));
vi.mock('@ai-matrx/agents/catalog/react', () => ({ AgentListDropdown: () => null }));
vi.mock('@ai-matrx/design-system', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Select: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  Switch: ({
    onCheckedChange: _onCheckedChange,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    onCheckedChange?: (checked: boolean) => void;
  }) => <input {...props} readOnly />,
  ConfirmDialog: () => null,
}));

import { SettingsView } from './SettingsView';

function setChromeRuntime({
  requestUpdateCheck,
  browserLoginReady = true,
}: {
  requestUpdateCheck?: typeof chrome.runtime.requestUpdateCheck;
  browserLoginReady?: boolean;
}) {
  Object.assign(chrome, {
    runtime: {
      id: 'extension-id',
      getManifest: () => ({ version: '0.2.54' }),
      sendMessage: vi.fn(),
      ...(requestUpdateCheck ? { requestUpdateCheck } : {}),
    },
    tabs: browserLoginReady ? { get: vi.fn() } : {},
    scripting: browserLoginReady ? { executeScript: vi.fn() } : {},
    storage: {
      local: browserLoginReady ? { get: vi.fn(), clear: vi.fn() } : {},
      session: { clear: vi.fn() },
    },
  });
}

function about() {
  return within(screen.getByRole('region', { name: 'About' }));
}

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
}

describe('SettingsView About', () => {
  beforeEach(() => {
    mocks.getEnginePortOverride.mockReset().mockResolvedValue(null);
    mocks.setEnginePortOverride.mockReset().mockResolvedValue(undefined);
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.requestUpdateCheck.mockReset();
  });

  afterEach(() => {
    cleanup();
    setUserAgent('Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36');
  });

  it('shows installed details, local API availability, and a browser-scoped no-update result', () => {
    mocks.requestUpdateCheck.mockImplementation((callback) => callback('no_update'));
    setChromeRuntime({ requestUpdateCheck: mocks.requestUpdateCheck });

    render(<SettingsView />);

    expect(about().getByText('0.2.54')).toBeTruthy();
    expect(about().getByText('extension-id')).toBeTruthy();
    expect(about().getByText('Available')).toBeTruthy();
    expect(
      about().getByText(
        'Vault checks whether saved logins can be used for this browser and site when you choose one.',
      ),
    ).toBeTruthy();
    fireEvent.click(about().getByRole('button', { name: 'Check for extension update' }));
    expect(mocks.requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(about().getByText('Your browser did not find an update right now.')).toBeTruthy();
  });

  it('labels Firefox-like local APIs as available without claiming saved-logins are ready', () => {
    setUserAgent('Mozilla/5.0 Firefox/130.0');
    setChromeRuntime({ requestUpdateCheck: mocks.requestUpdateCheck });

    render(<SettingsView />);

    expect(about().getByText('Firefox')).toBeTruthy();
    expect(about().getByText('Available')).toBeTruthy();
    expect(about().queryByText('Ready')).toBeNull();
    expect(
      about().getByText(
        'Vault checks whether saved logins can be used for this browser and site when you choose one.',
      ),
    ).toBeTruthy();
  });

  it('gives a browser-managed update path and an honest unavailable cue when APIs are absent', () => {
    setChromeRuntime({ browserLoginReady: false });

    render(<SettingsView />);

    expect(about().getByText('Unavailable')).toBeTruthy();
    expect(
      about().getByText(
        'Reload or reinstall Matrx Extend in a supported browser to use saved logins.',
      ),
    ).toBeTruthy();
    expect(about().queryByRole('button', { name: 'Check for extension update' })).toBeNull();
    expect(
      about().getByText(/Updates are managed by your browser. Open its Extensions page/),
    ).toBeTruthy();
  });

  it('reports an available update and directs the user to browser update controls', () => {
    mocks.requestUpdateCheck.mockImplementation((callback) =>
      callback('update_available', { version: '0.2.55' }),
    );
    setChromeRuntime({ requestUpdateCheck: mocks.requestUpdateCheck });

    render(<SettingsView />);
    fireEvent.click(about().getByRole('button', { name: 'Check for extension update' }));

    expect(
      about().getByText(
        'Version 0.2.55 is available. Open your browser’s Extensions page, find Matrx Extend, and use its update controls to finish the update.',
      ),
    ).toBeTruthy();
  });

  it.each([
    [
      'throttled',
      (callback: (status: 'throttled') => void) => callback('throttled'),
      /limited update checks/,
    ],
    [
      'failed',
      () => {
        throw new Error('update service unavailable');
      },
      /Could not check right now/,
    ],
  ])('reports a %s update check accurately', (_case, implementation, expected) => {
    mocks.requestUpdateCheck.mockImplementation(implementation);
    setChromeRuntime({ requestUpdateCheck: mocks.requestUpdateCheck });

    render(<SettingsView />);
    fireEvent.click(about().getByRole('button', { name: 'Check for extension update' }));

    expect(about().getByText(expected)).toBeTruthy();
  });
});

describe('SettingsView local engine port', () => {
  beforeEach(() => {
    mocks.getEnginePortOverride.mockReset().mockResolvedValue(65001);
    mocks.setEnginePortOverride.mockReset().mockResolvedValue(undefined);
    mocks.send.mockReset().mockResolvedValue(undefined);
    setChromeRuntime({});
  });

  afterEach(cleanup);

  it('clears the stale range error when a blank save removes an override', async () => {
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = await section.findByDisplayValue('65001');

    fireEvent.change(input, { target: { value: '65536' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    expect(section.getByText('Port must be 1–65535.')).toBeTruthy();
    expect(mocks.setEnginePortOverride).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.setEnginePortOverride).toHaveBeenCalledWith(null));
    await waitFor(() => expect(section.getByRole('button', { name: 'Set' })).toBeTruthy());
    expect(section.queryByText('Port must be 1–65535.')).toBeNull();
  });

  it('clears the range error when a valid port replaces the invalid input', async () => {
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = await section.findByDisplayValue('65001');

    fireEvent.change(input, { target: { value: '65536' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    expect(section.getByText('Port must be 1–65535.')).toBeTruthy();

    fireEvent.change(input, { target: { value: '65002' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.setEnginePortOverride).toHaveBeenCalledWith(65002));
    expect(section.queryByText('Port must be 1–65535.')).toBeNull();
  });
});
