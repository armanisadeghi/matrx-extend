import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: { id: 47, url: 'https://parent.example/account' } as { id: number; url: string },
  user: { id: 'user-focused-frame' },
  organization: { id: 'org-focused-frame' },
  panelStatus: undefined as unknown,
  sendMessage: vi.fn(),
  tabsQuery: vi.fn(),
  automaticLogin: vi.fn(),
  listeners: new Set<(message: unknown) => void>(),
}));

vi.mock('@/hooks/use-active-tab', () => ({ useActiveTab: () => mocks.tab }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: mocks.user, status: 'signed-in', signIn: vi.fn() }),
}));
vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({ active: mocks.organization }),
}));
vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => mocks.organization.id,
}));
vi.mock('@/features/vault/useVault', () => ({
  useVault: () => ({
    auth: 'ready',
    loading: false,
    error: null,
    mine: [],
    shared: [],
    matches: [{ item_id: 'ffffffff-1111-4111-8111-111111111111', display_name: 'Parent account' }],
    matchesLoading: false,
    matchesError: null,
    reload: vi.fn(),
    retryMatches: vi.fn(),
    patchItem: vi.fn(),
    createItem: vi.fn(),
    changeFieldValue: vi.fn(),
    addField: vi.fn(),
    removeVaultField: vi.fn(),
    removeVaultItem: vi.fn(),
  }),
  useCredentialLogin: () => ({
    supported: true,
    running: null,
    outcome: null,
    useHere: mocks.automaticLogin,
    dismiss: vi.fn(),
  }),
}));
vi.mock('@/lib/messaging/native', () => ({ send: async () => null, on: () => () => {} }));
vi.mock('@/lib/clipboard/copy', () => ({ copyToClipboard: vi.fn() }));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));

import { VaultView } from './VaultView';

const OFFER_ID = '1234567890abcdef1234567890abcdef1234';
const PERSONAL_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const WORK_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const readyChildStatus = {
  status: 'ready',
  offerId: OFFER_ID,
  itemIds: [PERSONAL_ID, WORK_ID],
  matches: [
    { item_id: PERSONAL_ID, display_name: 'Child personal' },
    { item_id: WORK_ID, display_name: 'Child work' },
  ],
  pageUrl: 'https://accounts.child.example/login',
  frameId: 4,
};
const readyTopStatus = {
  ...readyChildStatus,
  frameId: 0,
};

const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
const port = () => ({
  onMessage: event(),
  onDisconnect: event(),
  disconnect: vi.fn(),
});

beforeEach(() => {
  mocks.tab = { id: 47, url: 'https://parent.example/account' };
  mocks.panelStatus = readyChildStatus;
  mocks.sendMessage.mockReset().mockImplementation(async (message: { kind?: string }) => {
    if (message.kind === 'credential-suggestions:panel-status') return mocks.panelStatus;
    if (message.kind === 'credential-suggestions:panel-fill') return { status: 'filled' };
    return null;
  });
  mocks.automaticLogin.mockReset();
  mocks.tabsQuery.mockReset().mockResolvedValue([mocks.tab]);
  mocks.listeners.clear();
  const tabsActivated = event();
  const tabsUpdated = event();
  const windowFocused = event();
  Object.assign(chrome, {
    tabs: {
      query: mocks.tabsQuery,
      create: vi.fn(),
      onActivated: tabsActivated,
      onUpdated: tabsUpdated,
    },
    windows: { onFocusChanged: windowFocused },
    runtime: {
      sendMessage: mocks.sendMessage,
      connect: () => port(),
      onMessage: {
        addListener: (listener: (message: unknown) => void) => mocks.listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) => mocks.listeners.delete(listener),
      },
    },
  });
  chrome.storage.onChanged.addListener = vi.fn();
  chrome.storage.onChanged.removeListener = vi.fn();
});

afterEach(cleanup);

describe('VaultView focused child-frame projection', () => {
  it('renders the canonical child host and accounts with Fill only', async () => {
    render(<VaultView />);

    expect(await screen.findByText('accounts.child.example')).toBeTruthy();
    expect(screen.getByText('Child personal')).toBeTruthy();
    expect(screen.getByText('Child work')).toBeTruthy();
    expect(screen.queryByText('Parent account')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Fill' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(mocks.automaticLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    [
      'malformed',
      {
        status: 'ready',
        itemIds: [PERSONAL_ID],
        matches: [{ item_id: PERSONAL_ID, display_name: 'Untrusted child account' }],
        pageUrl: 'https://accounts.child.example/login',
        frameId: 4,
      },
    ],
  ])('fails closed when focused-frame status is %s', async (_label, status) => {
    mocks.panelStatus = status;
    render(<VaultView />);

    expect(
      await screen.findByText(
        'Saved logins are unavailable right now. Enter the login manually, or focus the username or password field on a supported sign-in page and try Fill again.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByText('Untrusted child account')).toBeNull();
    expect(mocks.automaticLogin).not.toHaveBeenCalled();
  });

  it('guides a browser-restricted page to a regular sign-in website or manual entry', async () => {
    mocks.tab = { id: 47, url: 'about:blank' };
    mocks.panelStatus = { status: 'unavailable', itemIds: [] };
    render(<VaultView />);

    expect(
      await screen.findByText(
        "This browser page can't be filled. Open a sign-in page on a regular website, or enter the login manually.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(mocks.automaticLogin).not.toHaveBeenCalled();
  });

  it('gives manual focus guidance and withholds Sign in when no supported-page offer exists', async () => {
    mocks.panelStatus = { status: 'none', itemIds: [] };
    render(<VaultView />);

    expect(
      await screen.findByText(
        'No login field is ready to fill. Enter the login manually, or focus the username or password field on a supported sign-in page and try Fill again.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(mocks.automaticLogin).not.toHaveBeenCalled();
  });

  it('preserves Fill and Sign in for a current top-level ready offer', async () => {
    mocks.panelStatus = readyTopStatus;
    render(<VaultView />);

    expect(await screen.findByText('Child personal')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Fill' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2);
    expect(mocks.automaticLogin).not.toHaveBeenCalled();
  });

  it('distinguishes duplicate saved-login names and fills the selected item id', async () => {
    mocks.panelStatus = {
      ...readyChildStatus,
      matches: [
        { item_id: PERSONAL_ID, display_name: 'Harbor Dental patient portal' },
        { item_id: WORK_ID, display_name: 'Harbor Dental patient portal' },
      ],
    };
    render(<VaultView />);

    expect((await screen.findAllByText('Harbor Dental patient portal')).length).toBe(2);
    expect(screen.getByText('· ID a')).toBeTruthy();
    const selectedSuffix = screen.getByText('· ID b');
    const selectedRow = selectedSuffix.closest('li');
    expect(selectedRow).toBeTruthy();

    fireEvent.click(within(selectedRow as HTMLLIElement).getByRole('button', { name: 'Fill' }));

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        __matrx: true,
        kind: 'credential-suggestions:panel-fill',
        payload: { tabId: 47, offerId: OFFER_ID, itemId: WORK_ID },
      }),
    );
  });

  it('selects only the three username-eligible duplicate Fill rows by their stable suffix', async () => {
    const first = 'aa111111-1111-4111-8111-111111111111';
    const selected = 'aa222222-2222-4222-8222-222222222222';
    const third = 'ab333333-3333-4333-8333-333333333333';
    mocks.panelStatus = {
      ...readyChildStatus,
      itemIds: [first, selected, third],
      matches: [
        { item_id: first, display_name: 'Harbor Dental patient portal' },
        { item_id: selected, display_name: 'Harbor Dental patient portal' },
        { item_id: third, display_name: 'Harbor Dental patient portal' },
      ],
    };
    render(<VaultView />);
    const { selectEligibleFillSelector } = await import(
      '../../../tests/browser/firefox-vault/multi-account-acceptance.mjs'
    );
    const expected = [
      'Harbor Dental patient portal · ID aa2',
      'Harbor Dental patient portal · ID aa1',
      'Harbor Dental patient portal · ID ab',
    ];
    const selector = selectEligibleFillSelector(document, expected);
    expect(typeof selector).toBe('string');
    const chosen = document.querySelector(selector as string);
    expect(chosen?.closest('li')?.textContent).toContain('ID aa2');

    const clone = chosen?.closest('li')?.cloneNode(true) as Element | undefined;
    chosen?.closest('li')?.parentElement?.append(clone as Node);
    expect(selectEligibleFillSelector(document, expected)).toBeNull();
    clone?.remove();
    const duplicate = screen.getByText('· ID aa1');
    duplicate.textContent = ' · ID aa2';
    expect(selectEligibleFillSelector(document, expected)).toBeNull();
    duplicate.textContent = ' · ID aa1';

    fireEvent.click(chosen as HTMLElement);
    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        __matrx: true,
        kind: 'credential-suggestions:panel-fill',
        payload: { tabId: 47, offerId: OFFER_ID, itemId: selected },
      }),
    );
  });

  it('sends the displayed child account with its exact offer id when Fill is clicked', async () => {
    render(<VaultView />);
    const account = await screen.findByText('Child personal');
    const row = account.closest('li');
    expect(row).toBeTruthy();

    fireEvent.click(within(row as HTMLLIElement).getByRole('button', { name: 'Fill' }));

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        __matrx: true,
        kind: 'credential-suggestions:panel-fill',
        payload: { tabId: 47, offerId: OFFER_ID, itemId: PERSONAL_ID },
      }),
    );
    expect(mocks.automaticLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['has no active tab', async () => []],
    [
      'cannot query the active tab',
      async () => {
        throw new Error('tab_query_refused');
      },
    ],
  ])(
    'shows an actionable outcome when admission %s before Fill work starts',
    async (_label, query) => {
      mocks.tabsQuery.mockImplementation(query);
      render(<VaultView />);
      const account = await screen.findByText('Child personal');
      const row = account.closest('li');
      expect(row).toBeTruthy();

      fireEvent.click(within(row as HTMLLIElement).getByRole('button', { name: 'Fill' }));

      expect(
        await screen.findByText(
          'Could not start filling. Focus the login field, then try Fill again.',
        ),
      ).toBeTruthy();
      expect(mocks.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'credential-suggestions:panel-fill',
        }),
      );
    },
  );
});
