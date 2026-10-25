import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmationParent } from './vault-confirmation';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  return {
    promise: new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
    resolve,
    reject,
  };
}

const state = vi.hoisted(() => ({
  user: { id: '1f82af75-fb56-4881-9721-3f0580e166a4' } as { id: string } | null,
  organization: { id: 'f60ac767-0f56-4b4d-9c5a-73cc824bb54c' } as { id: string } | null,
  reads: [] as Array<Promise<ConfirmationParent | null>>,
  read: vi.fn(),
  authSessionChanged: null as (() => void) | null,
  admission: { run: async (work: () => Promise<unknown>) => work() },
  hosts: [] as Array<{
    key: string;
    dispose: ReturnType<typeof vi.fn>;
    identity: { marker: string };
    api: object;
  }>,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: state.user, signIn: vi.fn(), status: 'signed-in' }),
}));
vi.mock('@/hooks/use-active-organization', () => ({
  useActiveOrganization: () => ({ active: state.organization }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: null, url: null }),
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({}) }));
vi.mock('@/lib/supabase/schemas', () => ({ platformDb: () => ({}) }));
vi.mock('@ai-matrx/kit/outbound', () => ({ openOutbound: vi.fn() }));
vi.mock('./usePanelAdmission', () => ({
  usePanelAdmission: () => ({ admission: state.admission }),
}));
vi.mock('./useVaultPage', () => ({ useVaultPage: () => ({}) }));
vi.mock('./extension-vault-host', () => ({
  createCaptureHost: () => ({}),
  createFillSetupHost: () => ({}),
  createNewPasswordFieldsHost: () => ({ dispose: vi.fn() }),
}));
vi.mock('./vault-confirmation-host', () => ({
  readVaultParentMetadata: state.read,
  listenForVaultAuthSessionChanges: (listener: () => void) => {
    state.authSessionChanged = listener;
    return () => {
      if (state.authSessionChanged === listener) state.authSessionChanged = null;
    };
  },
  createVaultConfirmationHost: (parent: ConfirmationParent) => {
    const key = `${parent.userId}:${parent.sessionId}:${parent.organizationId}`;
    const host = { key, dispose: vi.fn(), identity: { marker: key }, api: {} };
    state.hosts.push(host);
    return host;
  },
}));
vi.mock('@ai-matrx/vault', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ai-matrx/vault')>();
  return {
    ...original,
    VaultApp: ({ host }: { host: { identity: { marker: string } } }) => (
      <div data-testid="vault-workspace">{host.identity.marker}</div>
    ),
    createApiVaultPort: () => ({}),
    createVaultKnobs: () => ({}),
  };
});
vi.mock('@ai-matrx/design-system/controls', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

import { VaultView } from './VaultView';

const actorA: ConfirmationParent = {
  userId: '1f82af75-fb56-4881-9721-3f0580e166a4',
  sessionId: 'session-harbor-dental-a',
  organizationId: 'f60ac767-0f56-4b4d-9c5a-73cc824bb54c',
  email: 'admin@admin.com',
  hasPassword: true,
};

function nextRead(): Deferred<ConfirmationParent | null> {
  const value = deferred<ConfirmationParent | null>();
  state.reads.push(value.promise);
  return value;
}

async function mountActor(actor: ConfirmationParent) {
  const initial = nextRead();
  const view = render(<VaultView />);
  await act(async () => initial.resolve(actor));
  await waitFor(() =>
    expect(screen.getByTestId('vault-workspace').textContent).toContain(actor.sessionId),
  );
  return view;
}

beforeEach(() => {
  state.user = { id: actorA.userId };
  state.organization = { id: actorA.organizationId };
  state.reads = [];
  state.hosts = [];
  state.authSessionChanged = null;
  state.read.mockReset();
  state.read.mockImplementation(
    () => state.reads.shift() ?? Promise.reject(new Error('missing read')),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('mounted Vault metadata transitions', () => {
  it.each([
    [
      'actor',
      '829cb697-f3a0-4bfe-ab7a-60b1dc260ae4',
      actorA.organizationId,
      '829cb697-f3a0-4bfe-ab7a-60b1dc260ae4',
      'bd181e59-fd4d-4a87-af0c-6f8f617f55e4',
    ],
    [
      'organization',
      actorA.userId,
      'f96c462f-107c-42a1-a035-aa292e80e40f',
      '829cb697-f3a0-4bfe-ab7a-60b1dc260ae4',
      'f96c462f-107c-42a1-a035-aa292e80e40f',
    ],
  ])(
    'retires the known %s workspace while new verified metadata is pending and ignores the stale old resolution',
    async (_case, nextUserId, nextOrganizationId, finalUserId, finalOrganizationId) => {
      const view = await mountActor(actorA);
      const oldHost = state.hosts.at(-1);
      const stale = nextRead();
      state.user = { id: nextUserId };
      state.organization = { id: nextOrganizationId };
      view.rerender(<VaultView />);

      await waitFor(() => expect(screen.queryByTestId('vault-workspace')).toBeNull());
      expect(oldHost?.dispose).toHaveBeenCalledTimes(1);

      const newest = nextRead();
      state.user = { id: finalUserId };
      state.organization = { id: finalOrganizationId };
      view.rerender(<VaultView />);
      const finalActor = {
        ...actorA,
        userId: finalUserId,
        organizationId: finalOrganizationId,
        sessionId: `session-${_case}-newest`,
      };
      await act(async () => newest.resolve(finalActor));
      await waitFor(() =>
        expect(screen.getByTestId('vault-workspace').textContent).toContain(finalActor.sessionId),
      );
      await act(async () => stale.resolve({ ...actorA, sessionId: `stale-${_case}` }));
      expect(screen.getByTestId('vault-workspace').textContent).toContain(finalActor.sessionId);
    },
  );

  it('retains one controller for a same-session AUTH_SESSION refresh, then replaces it for a new session and ignores a stale rejection', async () => {
    await mountActor(actorA);
    const originalHost = state.hosts.at(-1);
    const sameSession = nextRead();
    act(() => state.authSessionChanged?.());
    expect(screen.getByTestId('vault-workspace').textContent).toContain(actorA.sessionId);
    expect(originalHost?.dispose).not.toHaveBeenCalled();
    await act(async () => sameSession.resolve({ ...actorA, email: 'rotated@admin.com' }));
    expect(state.hosts).toHaveLength(1);
    expect(originalHost?.dispose).not.toHaveBeenCalled();

    const staleFailure = nextRead();
    act(() => state.authSessionChanged?.());
    const newSession = nextRead();
    act(() => state.authSessionChanged?.());
    const actorB = { ...actorA, sessionId: 'session-harbor-dental-b' };
    await act(async () => newSession.resolve(actorB));
    await waitFor(() =>
      expect(screen.getByTestId('vault-workspace').textContent).toContain(actorB.sessionId),
    );
    expect(originalHost?.dispose).toHaveBeenCalledTimes(1);
    await act(async () => staleFailure.reject(new Error('stale JWKS failure')));
    expect(screen.getByTestId('vault-workspace').textContent).toContain(actorB.sessionId);
    expect(screen.queryByText('stale JWKS failure')).toBeNull();
  });
});
