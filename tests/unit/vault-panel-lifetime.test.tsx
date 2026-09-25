import userEvent from '@testing-library/user-event';
// Mounted production panel: replacing its keyed session with an unkeyed child
// must fail the away/back tests; removing admission must send two actions.
import { StrictMode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { vaultRefreshControl } from '../browser/vault-setup-recovery-acceptance.cjs';

const deps = vi.hoisted(() => ({
  tab: { id: 7, url: 'https://example.com/login' },
  user: { id: 'user-a' },
  org: { id: 'org-a' },
  mine: vi.fn(),
  shared: vi.fn(),
  matches: vi.fn(),
  status: vi.fn(),
  fill: vi.fn(),
  login: vi.fn(),
}));
vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: async () => deps.user }));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => deps.org.id }));
vi.mock('@/hooks/use-active-tab', () => ({ useActiveTab: () => deps.tab }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: deps.user }) }));
vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({ active: deps.org }),
}));
vi.mock('@/lib/browser/detect', () => ({ isBrowserSupported: () => true }));
vi.mock('@/lib/tools/handlers/credential-login', () => ({ credential_login: { run: deps.login } }));
vi.mock('@/lib/api/routes/vault', () => ({
  WEBSITE_LOGIN_DEFINITION_KEY: 'website_login',
  hasRealUserToken: async () => true,
  describeVaultFailure: (failure: { kind: string; status?: number }) =>
    failure.kind === 'forbidden'
      ? 'The Vault refused this request. You may not have access to this item.'
      : `The Vault is unavailable right now (${failure.status ?? 0}).`,
  fetchMyVaultItems: deps.mine,
  fetchVaultItemsSharedWithMe: deps.shared,
  fetchBrowserLoginMatches: deps.matches,
}));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));
// The transient secret hold is REAL here on purpose: it is pure React state
// plus an auto-clear timer, and every component in this tree (the item detail
// and the password generator) depends on its exact shape. A stand-in returning
// a hand-written object silently rots the moment a component starts using
// another of its fields — which is exactly how this file broke when the
// generator panel was mounted into VaultView.
vi.mock('@/lib/clipboard/copy', () => ({ copyToClipboard: vi.fn() }));
vi.mock('@/lib/messaging/native', () => ({ send: async () => null, on: () => () => {} }));
import { STORAGE_KEYS } from '@/config/env';
import { VaultView } from '@/features/vault/VaultView';
import { type VaultData, useVault } from '@/features/vault/useVault';

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const offerId = '111111112222333344445555555555555555';
const match = {
  ok: true,
  data: { matches: [{ item_id: id, display_name: 'Saved example', username_hint: 'a…' }] },
};
const readyPanelStatus = {
  status: 'ready',
  offerId,
  itemIds: [id],
  matches: [{ item_id: id, display_name: 'Saved example' }],
  pageUrl: 'https://example.com/login',
  frameId: 0,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let node: HTMLDivElement;
const activations = new Set<() => void>();
const storageListeners = new Set<
  (
    changes: Record<string, chrome.storage.StorageChange>,
    area: 'local' | 'managed' | 'session' | 'sync',
  ) => void
>();
const listeners = new Set<(message: unknown) => void>();
async function render() {
  await act(async () => {
    root.render(
      <StrictMode>
        <VaultView />
      </StrictMode>,
    );
  });
}
function button(text: string) {
  const found = [...node.querySelectorAll('button')].find((b) => b.textContent === text);
  expect(found, `button ${text}`).toBeTruthy();
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  deps.tab = { id: 7, url: 'https://example.com/login' };
  deps.user = { id: 'user-a' };
  deps.org = { id: 'org-a' };
  vi.clearAllMocks();
  listeners.clear();
  activations.clear();
  storageListeners.clear();
  deps.mine.mockResolvedValue({ ok: true, data: [] });
  deps.shared.mockResolvedValue({ ok: true, data: [] });
  deps.matches.mockResolvedValue(match);
  deps.status.mockResolvedValue(readyPanelStatus);
  deps.fill.mockResolvedValue({ status: 'filled' });
  deps.login.mockResolvedValue({ status: 'authenticated' });
  const event = { addListener: vi.fn(), removeListener: vi.fn() };
  Object.assign(chrome, {
    tabs: {
      query: async () => [deps.tab],
      onActivated: {
        addListener: (fn: () => void) => activations.add(fn),
        removeListener: (fn: () => void) => activations.delete(fn),
      },
      onUpdated: event,
    },
    windows: { onFocusChanged: event },
    runtime: {
      connect: vi.fn(() => ({
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      sendMessage: (message: { kind: string }) =>
        message.kind.endsWith('panel-status') ? deps.status(message) : deps.fill(message),
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.add(fn),
        removeListener: (fn: (message: unknown) => void) => listeners.delete(fn),
      },
    },
  });
  chrome.storage.onChanged.addListener = (fn) => {
    storageListeners.add(fn);
  };
  chrome.storage.onChanged.removeListener = (fn) => {
    storageListeners.delete(fn);
  };
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

it('fills without invoking Sign in and uses fixed result copy', async () => {
  await act(async () => button('Fill').click());
  expect(deps.fill).toHaveBeenCalledTimes(1);
  expect(deps.login).not.toHaveBeenCalled();
  expect(node.textContent).toContain('Filled. Review the form, then sign in.');
});
it('shows manual review when the bound fill cannot fully restore the form', async () => {
  deps.fill.mockResolvedValueOnce({ status: 'partial_manual_check' });
  await act(async () => button('Fill').click());
  expect(deps.fill).toHaveBeenCalledTimes(1);
  expect(deps.login).not.toHaveBeenCalled();
  expect(node.textContent).toContain(
    'Matrx could not fully restore the login fields. Review them before signing in.',
  );
});
it.each(['tab', 'url', 'user', 'org'])(
  'drops results through %s away/back and retains shared admission',
  async (dimension) => {
    const pending = deferred<{ status: string }>();
    deps.fill.mockReturnValueOnce(pending.promise);
    const click = button('Fill');
    await act(async () => click.click());
    const initial = { tab: deps.tab, user: deps.user, org: deps.org };
    if (dimension === 'tab') deps.tab = { ...deps.tab, id: 9 };
    if (dimension === 'url') deps.tab = { ...deps.tab, url: 'https://example.com/other' };
    if (dimension === 'user') deps.user = { id: 'user-b' };
    if (dimension === 'org') deps.org = { id: 'org-b' };
    await render();
    Object.assign(deps, initial);
    await render();
    await act(async () => button('Sign in').click());
    expect(deps.login).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ status: 'filled' }));
    expect(node.textContent).not.toContain('Filled. Review');
    await act(async () => button('Sign in').click());
    expect(deps.login).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Signed in.');
  },
);
it('admits only one Fill or Sign in in the same event batch', async () => {
  const pending = deferred<{ status: string }>();
  deps.fill.mockReturnValueOnce(pending.promise);
  const fill = button('Fill');
  const login = button('Sign in');
  await act(async () => {
    fill.click();
    login.click();
    fill.click();
  });
  expect(deps.fill).toHaveBeenCalledTimes(1);
  expect(deps.login).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ status: 'filled' }));
});
it('ignores reordered status responses and does not show old matching rows after navigation', async () => {
  const oldStatus = deferred<unknown>();
  deps.status.mockReturnValueOnce(oldStatus.promise);
  await act(async () => {
    for (const fn of listeners)
      fn({ __matrx: true, kind: 'credential-assistance:changed', payload: { tabId: 7 } });
  });
  deps.status.mockResolvedValue({ status: 'none', itemIds: [] });
  await act(async () => {
    for (const fn of listeners)
      fn({ __matrx: true, kind: 'credential-assistance:changed', payload: { tabId: 7 } });
  });
  await act(async () => oldStatus.resolve({ status: 'ready', itemIds: [id] }));
  expect([...node.querySelectorAll('button')].some((b) => b.textContent === 'Fill')).toBe(false);
  const newMatches = deferred<unknown>();
  deps.matches.mockReturnValueOnce(newMatches.promise);
  deps.status.mockResolvedValueOnce({ status: 'none', itemIds: [] });
  deps.tab = { id: 8, url: 'https://other.example/login' };
  await render();
  expect(node.textContent).not.toContain('Saved example');
  await act(async () => newMatches.resolve({ ok: true, data: { matches: [] } }));
  expect(node.textContent).not.toContain('Saved example');
});

it('invalidates same-account token replacement before a late Fill can publish', async () => {
  const pending = deferred<{ status: string }>();
  deps.fill.mockReturnValueOnce(pending.promise);
  await act(async () => button('Fill').click());
  await act(async () => {
    for (const fn of storageListeners) fn({ [STORAGE_KEYS.ACCESS_TOKEN]: {} }, 'local');
    pending.resolve({ status: 'filled' });
  });
  expect(node.textContent).not.toContain('Filled. Review');
});
it('refuses an action when activation races the active-tab lookup', async () => {
  const tab = deferred<chrome.tabs.Tab[]>();
  chrome.tabs.query = vi.fn().mockReturnValueOnce(tab.promise);
  await act(async () => button('Sign in').click());
  await act(async () => {
    for (const fn of activations) fn();
    tab.resolve([{ id: 7, url: 'https://example.com/login' } as chrome.tabs.Tab]);
  });
  expect(deps.login).not.toHaveBeenCalled();
  expect(deps.fill).not.toHaveBeenCalled();
});
it('drops late Sign in results on unmount and remount', async () => {
  const pending = deferred<{ status: string }>();
  deps.login.mockReturnValueOnce(pending.promise);
  await act(async () => button('Sign in').click());
  await act(async () => root.render(null));
  await render();
  await act(async () => button('Fill').click());
  expect(deps.fill).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ status: 'authenticated' }));
  expect(node.textContent).not.toContain('Signed in.');
});

it('fences list and match publication at invalidation even before React remount', async () => {
  let current = true;
  let data!: VaultData;
  const admission = { current: () => current, run: async <T,>(work: () => Promise<T>) => work() };
  // Keep actor identity stable to avoid a dependency loop in this isolated probe.
  const actor = { userId: 'user-a', organizationId: 'org-a' };
  function StableProbe() {
    data = useVault(deps.tab.url, deps.tab.id, actor, admission);
    return (
      <div>
        {data.mine.map((item) => item.display_name).join(',')}|
        {data.matches.map((item) => item.display_name).join(',')}
      </div>
    );
  }
  const matches = deferred<unknown>();
  deps.matches.mockReturnValue(matches.promise);
  await act(async () => root.render(<StableProbe />));
  const mine = deferred<unknown>();
  deps.mine.mockReturnValueOnce(mine.promise);
  await act(async () => {
    void data.reload();
  });
  await act(async () => {
    current = false;
    mine.resolve({ ok: true, data: [{ display_name: 'Old actor row' }] });
    matches.resolve({ ok: true, data: { matches: [{ display_name: 'Old actor match' }] } });
  });
  expect(node.textContent).not.toContain('Old actor');
});

it('clears revoked Vault metadata and restores it only after a successful reload', async () => {
  let data!: VaultData;
  const admission = { current: () => true, run: async <T,>(work: () => Promise<T>) => work() };
  const actor = { userId: 'user-a', organizationId: 'org-a' };
  const original = { id: 'original', display_name: 'Previously visible login' };
  const recovered = { id: 'recovered', display_name: 'Recovered login' };
  deps.mine
    .mockResolvedValueOnce({ ok: true, data: [original] })
    .mockResolvedValueOnce({ ok: false, failure: { kind: 'forbidden' } })
    .mockResolvedValueOnce({ ok: true, data: [recovered] });
  function Probe() {
    data = useVault(deps.tab.url, deps.tab.id, actor, admission);
    return (
      <div>
        {data.mine.map((item) => item.display_name).join(',')}|{data.error}
      </div>
    );
  }

  await act(async () => root.render(<Probe />));
  expect(node.textContent).toContain('Previously visible login');

  await act(async () => void (await data.reload()));
  expect(node.textContent).not.toContain('Previously visible login');
  expect(node.textContent).toContain('You may not have access to this item.');

  await act(async () => void (await data.reload()));
  expect(node.textContent).toContain('Recovered login');
  expect(node.textContent).not.toContain('You may not have access to this item.');
});

it('clears and restores Shared-scope metadata through the rendered Vault controls', async () => {
  const sharedItem = (id: string, display_name: string) => ({
    id,
    display_name,
    definition_key: 'website_login',
    description: null,
    status: 'active',
    login_urls: ['https://shared.example/login'],
    uri_match_mode: 'host',
    notes: null,
    browser_fill_enabled: false,
    fields: [],
    capabilities: { can_use: false, can_edit: false, can_reveal: false, can_manage: false },
  });
  const original = sharedItem('shared-original', 'Previously shared login');
  const recovered = sharedItem('shared-recovered', 'Recovered shared login');
  await act(async () => root.render(null));
  deps.shared.mockResolvedValueOnce({ ok: true, data: [original] });
  await act(async () => root.render(<VaultView />));
  const shared = [...node.querySelectorAll('button')].find((item) =>
    item.textContent?.startsWith('Shared ('),
  );
  expect(shared).toBeTruthy();
  await act(async () => void (await userEvent.click(shared!)));
  expect(node.textContent).toContain('Previously shared login');

  deps.shared.mockResolvedValueOnce({ ok: false, failure: { kind: 'forbidden' } });
  const refresh = node.querySelector<HTMLButtonElement>('button[title="Refresh"]');
  expect(refresh).toBeTruthy();
  await act(async () => refresh?.click());
  expect(node.textContent).not.toContain('Previously shared login');
  expect(node.textContent).toContain('Nobody has shared a login with you.');
  expect(node.textContent).toContain('You may not have access to this item.');

  deps.shared.mockResolvedValueOnce({ ok: true, data: [recovered] });
  await act(async () => refresh?.click());
  expect(node.textContent).toContain('Recovered shared login');
  expect(node.textContent).not.toContain('You may not have access to this item.');
});

it('selects Vault Refresh from the active Vault panel when another mounted view also refreshes', async () => {
  await act(async () => {
    root.render(
      <>
        <button id="vault-trigger" title="Vault" data-state="active" />
        <div role="tabpanel" data-state="active" aria-labelledby="vault-trigger">
          <VaultView />
        </div>
        <div role="tabpanel" data-state="inactive" aria-labelledby="screenshots-trigger">
          <button title="Refresh">Other view refresh</button>
        </div>
      </>,
    );
  });
  const selected = new Function('document', `return ${vaultRefreshControl}`)(
    document,
  ) as HTMLButtonElement | null;
  expect(selected).toBeTruthy();
  expect(selected?.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
    'vault-trigger',
  );
});
