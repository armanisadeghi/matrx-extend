import { settingsStorage } from '@/lib/settings/persistence';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestUpdateCheck: vi.fn(),
  getEnginePortOverride: vi.fn(),
  setEnginePortOverride: vi.fn(),
  setPairToken: vi.fn(),
  clearPairToken: vi.fn(),
  confirm: vi.fn(),
  desktopTransport: 'none' as 'none' | 'http',
  signOut: vi.fn(),
  clearLocal: vi.fn(),
  clearSession: vi.fn(),
  send: vi.fn(),
  user: null as null | { id: string; email: string },
  chooseOrganization: vi.fn(),
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
  useActiveOrganization: (archiveFilter: string) => ({
    active: null,
    organizations: mocks.user
      ? [
          { id: 'active-org', name: 'Active Studio', archivedAt: null },
          { id: 'archived-org', name: 'Old Studio', archivedAt: '2026-09-30T00:00:00Z' },
        ].filter((organization) =>
          archiveFilter === 'all'
            ? true
            : archiveFilter === 'archived'
              ? !!organization.archivedAt
              : !organization.archivedAt,
        )
      : [],
    error: null,
    loading: false,
    mustChoose: false,
    choose: mocks.chooseOrganization,
  }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: mocks.user, signIn: vi.fn(), signOut: mocks.signOut, isAdmin: false }),
}));
vi.mock('@/hooks/use-desktop', () => ({
  useDesktopBridge: () => ({ transport: mocks.desktopTransport, health: null }),
}));
vi.mock('@/lib/desktop/discovery', () => ({
  getEnginePortOverride: mocks.getEnginePortOverride,
  setEnginePortOverride: mocks.setEnginePortOverride,
}));
vi.mock('@/lib/desktop/http', () => ({
  clearPairToken: mocks.clearPairToken,
  setPairToken: mocks.setPairToken,
}));
vi.mock('@/lib/desktop/types', () => ({
  desktopStatusTextClass: () => '',
  engineHealthState: () => 'ok',
  formatDesktopConnectionLabel: () => 'Not connected',
}));
vi.mock('@ai-matrx/kit/confirm-opener', () => ({ confirm: mocks.confirm }));
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
  DEFAULT_ARCHIVE_FILTER: 'active',
  ArchiveFilter: ({
    value,
    onValueChange,
  }: { value: string; onValueChange: (value: string) => void }) => (
    <div role="group" aria-label="Filter organizations by archive status">
      <button
        type="button"
        onClick={() => onValueChange('active')}
        aria-pressed={value === 'active'}
      >
        Active only
      </button>
      <button
        type="button"
        onClick={() => onValueChange('archived')}
        aria-pressed={value === 'archived'}
      >
        Archived only
      </button>
      <button type="button" onClick={() => onValueChange('all')} aria-pressed={value === 'all'}>
        Active + archived
      </button>
    </div>
  ),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  BasicInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Select: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div role="option" tabIndex={0} aria-selected={false}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  Switch: ({
    onCheckedChange: _onCheckedChange,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    onCheckedChange?: (checked: boolean) => void;
  }) => <input {...props} readOnly />,
  ConfirmDialog: ({
    open,
    title,
    description,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    description: React.ReactNode;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        {description}
        <button onClick={onConfirm}>Clear & sign out</button>
      </div>
    ) : null,
}));

import { SettingsView } from './SettingsView';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
      local: browserLoginReady ? { get: vi.fn(), clear: mocks.clearLocal } : {},
      session: { clear: mocks.clearSession },
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
    mocks.user = null;
    mocks.chooseOrganization.mockReset();
    mocks.getEnginePortOverride.mockReset().mockResolvedValue(null);
    mocks.setEnginePortOverride.mockReset().mockResolvedValue(undefined);
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.requestUpdateCheck.mockReset();
  });

  afterEach(() => {
    cleanup();
    setUserAgent('Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36');
  });

  it('shows a retry control when preference storage rejects a save', async () => {
    setChromeRuntime({ requestUpdateCheck: mocks.requestUpdateCheck });
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);
    chrome.storage.local.set = save;
    render(<SettingsView />);

    await settingsStorage.setItem('matrx.settings.v1', '{"state":{"theme":"dark"},"version":6}');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save preferences');
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
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

describe('SettingsView organization archive filter', () => {
  beforeEach(() => {
    mocks.user = { id: 'member-1', email: 'member@example.test' };
    mocks.chooseOrganization.mockReset();
    mocks.getEnginePortOverride.mockResolvedValue(null);
    setChromeRuntime({});
  });

  afterEach(() => {
    cleanup();
    mocks.user = null;
  });

  it('reveals archived memberships on this surface without offering them as work targets', () => {
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Organization' }));
    expect(section.getByRole('option', { name: 'Active Studio' })).toBeTruthy();
    expect(section.queryByText('Old Studio')).toBeNull();

    fireEvent.click(section.getByRole('button', { name: 'Archived only' }));
    const archived = section.getByText('Old Studio');
    expect(archived.closest('button')).toBeNull();
    expect(section.getByText(/Archived · view only/)).toBeTruthy();
    expect(section.getByText(/restore an archived organization/i)).toBeTruthy();
    expect(mocks.chooseOrganization).not.toHaveBeenCalled();

    fireEvent.click(section.getByRole('button', { name: 'Active + archived' }));
    expect(section.getByRole('option', { name: 'Active Studio' })).toBeTruthy();
    expect(section.getByText('Old Studio')).toBeTruthy();
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

  it('keeps the saved port when storage rejects a replacement, then saves the retry', async () => {
    mocks.setEnginePortOverride
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = await section.findByDisplayValue('65001');

    fireEvent.change(input, { target: { value: '65002' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    expect(await section.findByText('Could not save port. Try again.')).toBeTruthy();
    expect(section.getByText('override')).toBeTruthy();
    expect(mocks.send).not.toHaveBeenCalled();

    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.setEnginePortOverride).toHaveBeenNthCalledWith(2, 65002));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(section.queryByText('Could not save port. Try again.')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('65002');
  });

  it('does not show a cleared override when storage rejects removal', async () => {
    mocks.setEnginePortOverride.mockRejectedValueOnce(new Error('storage unavailable'));
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = await section.findByDisplayValue('65001');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    expect(await section.findByText('Could not save port. Try again.')).toBeTruthy();
    expect(section.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(section.getByText('override')).toBeTruthy();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('shows a reload error when reading the saved port fails', async () => {
    mocks.getEnginePortOverride.mockReset().mockRejectedValue(new Error('storage unavailable'));
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));

    expect(
      await section.findByText('Could not load saved port. Reopen Settings to try again.'),
    ).toBeTruthy();
    expect(mocks.setEnginePortOverride).not.toHaveBeenCalled();
  });

  it('preserves a port typed while the initial saved-port read is pending', async () => {
    const initialRead = deferred();
    mocks.getEnginePortOverride.mockReset().mockImplementation(async () => {
      await initialRead.promise;
      return 65001;
    });
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = section.getByPlaceholderText('auto') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '65003' } });
    initialRead.resolve();
    await waitFor(() => expect(section.getByText('override')).toBeTruthy());
    expect(input.value).toBe('65003');
    expect(mocks.setEnginePortOverride).not.toHaveBeenCalled();
  });

  it('waits for a pending initial read before saving the newer entered port', async () => {
    const initialRead = deferred();
    mocks.getEnginePortOverride.mockReset().mockImplementation(async () => {
      await initialRead.promise;
      return 65001;
    });
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = section.getByPlaceholderText('auto') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '65003' } });
    fireEvent.click(section.getByRole('button', { name: 'Set' }));
    expect(mocks.setEnginePortOverride).not.toHaveBeenCalled();
    initialRead.resolve();
    await waitFor(() => expect(mocks.setEnginePortOverride).toHaveBeenCalledWith(65003));
    await waitFor(() => expect(section.getByRole('button', { name: 'Save' })).toBeTruthy());
    expect(input.value).toBe('65003');
  });

  it('persists overlapping port choices in submission order', async () => {
    const first = deferred();
    const second = deferred();
    let storedPort = 65001;
    mocks.setEnginePortOverride
      .mockImplementationOnce(async (port: number) => {
        await first.promise;
        storedPort = port;
      })
      .mockImplementationOnce(async (port: number) => {
        await second.promise;
        storedPort = port;
      });
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = await section.findByDisplayValue('65001');

    fireEvent.change(input, { target: { value: '65002' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.setEnginePortOverride).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: '65003' } });
    fireEvent.click(section.getByRole('button', { name: 'Save' }));
    expect(mocks.setEnginePortOverride).toHaveBeenCalledTimes(1);

    first.resolve();
    await waitFor(() => expect(mocks.setEnginePortOverride).toHaveBeenNthCalledWith(2, 65003));
    expect(storedPort).toBe(65002);
    second.resolve();
    await waitFor(() => expect(storedPort).toBe(65003));
    expect((input as HTMLInputElement).value).toBe('65003');
  });
});

describe('SettingsView desktop pair code', () => {
  beforeEach(() => {
    mocks.getEnginePortOverride.mockReset().mockResolvedValue(null);
    mocks.setPairToken.mockReset();
    mocks.clearPairToken.mockReset();
    mocks.confirm.mockReset().mockResolvedValue(true);
    mocks.desktopTransport = 'none';
    setChromeRuntime({});
  });

  afterEach(cleanup);

  it('keeps a rejected code available for retry and clears it only after storage succeeds', async () => {
    mocks.setPairToken
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = section.getByPlaceholderText('Pair code') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'local-desktop-pair-code' } });
    fireEvent.click(section.getByRole('button', { name: 'Pair' }));
    expect(await section.findByText('Could not save pair code. Try again.')).toBeTruthy();
    expect(input.value).toBe('local-desktop-pair-code');

    fireEvent.click(section.getByRole('button', { name: 'Pair' }));
    await waitFor(() => expect(mocks.setPairToken).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(input.value).toBe(''));
    expect(section.queryByText('Could not save pair code. Try again.')).toBeNull();
  });

  it('reports a rejected removal and only clears the error after a confirmed retry', async () => {
    mocks.desktopTransport = 'http';
    mocks.clearPairToken
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const forget = section.getByRole('button', { name: 'Forget pair code' });

    fireEvent.click(forget);
    expect(await section.findByText('Could not forget pair code. Try again.')).toBeTruthy();
    expect(mocks.clearPairToken).toHaveBeenCalledTimes(1);

    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(forget);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.clearPairToken).toHaveBeenCalledTimes(1);
    expect(section.getByText('Could not forget pair code. Try again.')).toBeTruthy();

    fireEvent.click(forget);
    await waitFor(() => expect(mocks.clearPairToken).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(section.queryByText('Could not forget pair code. Try again.')).toBeNull(),
    );
  });

  it('keeps a newer pair code through an older completion and persists the latest submission', async () => {
    const first = deferred();
    const second = deferred();
    let storedCode = '';
    mocks.setPairToken
      .mockImplementationOnce(async (code: string) => {
        await first.promise;
        storedCode = code;
      })
      .mockImplementationOnce(async (code: string) => {
        await second.promise;
        storedCode = code;
      });
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Desktop bridge' }));
    const input = section.getByPlaceholderText('Pair code') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'old-pair-code' } });
    fireEvent.click(section.getByRole('button', { name: 'Pair' }));
    await waitFor(() => expect(mocks.setPairToken).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'new-pair-code' } });
    fireEvent.click(section.getByRole('button', { name: 'Pair' }));
    expect(mocks.setPairToken).toHaveBeenCalledTimes(1);

    first.resolve();
    await waitFor(() => expect(mocks.setPairToken).toHaveBeenNthCalledWith(2, 'new-pair-code'));
    expect(input.value).toBe('new-pair-code');
    expect(storedCode).toBe('old-pair-code');
    second.resolve();
    await waitFor(() => expect(storedCode).toBe('new-pair-code'));
    await waitFor(() => expect(input.value).toBe(''));
  });
});

describe('SettingsView local data reset', () => {
  beforeEach(() => {
    mocks.getEnginePortOverride.mockReset().mockResolvedValue(null);
    mocks.clearLocal.mockReset();
    mocks.clearSession.mockReset().mockResolvedValue(undefined);
    mocks.signOut.mockReset().mockResolvedValue(undefined);
    setChromeRuntime({});
  });

  afterEach(cleanup);

  it('keeps confirmation open after a rejected clear and signs out only after retry succeeds', async () => {
    mocks.clearLocal
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Data & reset' }));
    fireEvent.click(section.getByRole('button', { name: 'Clear local data on this device' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Clear local data?' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear & sign out' }));
    expect(await within(dialog).findByText('Could not finish reset. Try again.')).toBeTruthy();
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear & sign out' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.clearLocal).toHaveBeenCalledTimes(2);
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  });

  it('reports a failed session clear before signing out', async () => {
    mocks.clearLocal.mockResolvedValue(undefined);
    mocks.clearSession.mockRejectedValue(new Error('session storage unavailable'));
    render(<SettingsView />);
    const section = within(screen.getByRole('region', { name: 'Data & reset' }));
    fireEvent.click(section.getByRole('button', { name: 'Clear local data on this device' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Clear local data?' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear & sign out' }));
    expect(await within(dialog).findByText('Could not finish reset. Try again.')).toBeTruthy();
    expect(mocks.clearLocal).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
