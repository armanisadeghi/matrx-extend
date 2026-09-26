import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  verifiedUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  setSupabaseSession: vi.fn(),
  checkIsAdmin: vi.fn(),
  pingHealth: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('@/lib/auth/flow', () => ({
  restoreSupabaseSession: mocks.restore,
  getVerifiedCurrentUser: mocks.verifiedUser,
  signIn: mocks.signIn,
  signOut: mocks.signOut,
}));
vi.mock('@/lib/api/routes/health', () => ({ pingHealth: mocks.pingHealth }));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: mocks.broadcast,
  on: () => () => undefined,
}));
vi.mock('@/lib/supabase/client', () => ({ setSupabaseSession: mocks.setSupabaseSession }));
vi.mock('@/lib/supabase/queries', () => ({ checkIsAdmin: mocks.checkIsAdmin }));

import { resetAuthBootGuard, useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/state/auth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Probe({ name }: { name: string }) {
  const { error, signIn, signOut, status, user } = useAuth();
  return (
    <>
      <button data-testid={`${name}-sign-in`} type="button" onClick={() => void signIn()}>
        Sign in
      </button>
      <button data-testid={`${name}-sign-out`} type="button" onClick={() => void signOut()}>
        Sign out
      </button>
      <output data-testid={`${name}-identity`}>{user?.email ?? 'guest'}</output>
      <output data-testid={`${name}-status`}>{status}</output>
      <output data-testid={`${name}-error`}>{error ?? ''}</output>
    </>
  );
}

describe('useAuth overlapping sign-in attempts', () => {
  beforeEach(() => {
    resetAuthBootGuard();
    useAuthStore.setState({ user: null, isAdmin: false, status: 'signed-out', error: null });
    mocks.restore.mockReset().mockResolvedValue(true);
    mocks.verifiedUser.mockReset().mockResolvedValue(null);
    mocks.signIn.mockReset();
    mocks.signOut.mockReset().mockResolvedValue(undefined);
    mocks.setSupabaseSession.mockReset().mockResolvedValue(undefined);
    mocks.checkIsAdmin.mockReset().mockResolvedValue(false);
    mocks.pingHealth.mockReset();
    mocks.broadcast.mockReset();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        session: { get: vi.fn().mockResolvedValue({}) },
      },
    });
  });

  it('keeps the newer successful sign-in visible when an older attempt fails later', async () => {
    const first = deferred<never>();
    const second = deferred<{
      user: {
        id: string;
        email: string;
        email_verified: boolean;
        full_name: null;
        avatar_url: null;
      };
      tokens: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
      };
    }>();
    mocks.signIn
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    mocks.verifiedUser.mockResolvedValue({
      id: 'new-user',
      email: 'new@example.com',
      email_verified: true,
      full_name: null,
      avatar_url: null,
    });

    render(<Probe name="one" />);
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(signIn);
    fireEvent.click(signIn);

    second.resolve({
      user: {
        id: 'new-user',
        email: 'new@example.com',
        email_verified: true,
        full_name: null,
        avatar_url: null,
      },
      tokens: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'bearer',
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId('one-identity').textContent).toBe('new@example.com'),
    );

    first.reject(new Error('old attempt failed'));
    await Promise.resolve();

    expect(screen.getByTestId('one-identity').textContent).toBe('new@example.com');
    expect(screen.getByTestId('one-status').textContent).toBe('signed-in');
    expect(screen.getByTestId('one-error').textContent).toBe('');
  });

  it('does not resurrect auth after another useAuth instance signs out during admin lookup', async () => {
    const login = deferred<{
      user: {
        id: string;
        email: string;
        email_verified: boolean;
        full_name: null;
        avatar_url: null;
      };
      tokens: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
      };
    }>();
    const adminLookup = deferred<boolean>();
    mocks.signIn.mockImplementationOnce(() => login.promise);
    mocks.verifiedUser.mockResolvedValue({
      id: 'old-user',
      email: 'old@example.com',
      email_verified: true,
      full_name: null,
      avatar_url: null,
    });
    mocks.checkIsAdmin.mockImplementationOnce(() => adminLookup.promise);

    render(
      <>
        <Probe name="first" />
        <Probe name="second" />
      </>,
    );
    fireEvent.click(screen.getByTestId('first-sign-in'));
    login.resolve({
      user: {
        id: 'old-user',
        email: 'old@example.com',
        email_verified: true,
        full_name: null,
        avatar_url: null,
      },
      tokens: {
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        expires_in: 3600,
        token_type: 'bearer',
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId('first-identity').textContent).toBe('old@example.com'),
    );

    fireEvent.click(screen.getByTestId('second-sign-out'));
    await waitFor(() => expect(screen.getByTestId('first-identity').textContent).toBe('guest'));
    adminLookup.resolve(true);
    await Promise.resolve();

    expect(screen.getByTestId('first-identity').textContent).toBe('guest');
    expect(screen.getByTestId('first-status').textContent).toBe('signed-out');
    expect(mocks.broadcast).toHaveBeenCalledWith(expect.anything(), { user: null, isAdmin: false });
    expect(mocks.broadcast).not.toHaveBeenCalledWith(expect.anything(), {
      user: expect.objectContaining({ id: 'old-user' }),
      isAdmin: true,
    });
  });
});
