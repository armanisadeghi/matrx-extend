import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  error: null as string | null,
  signIn: vi.fn(),
  retry: vi.fn(),
  user: null as null | { id: string },
  status: 'signed-out' as 'signed-out' | 'signing-in',
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => auth,
}));

import { AuthGate } from '@/components/AuthGate';

describe('AuthGate sign-in failure notice', () => {
  beforeEach(() => {
    auth.error = null;
    auth.status = 'signed-out';
    auth.signIn.mockReset();
    auth.retry.mockReset();
    auth.user = null;
  });

  it('shows the real sign-in failure and retries the shared auth action', () => {
    auth.error = 'Token exchange failed (400): invalid_grant';
    render(
      <AuthGate>
        <main>Chat</main>
      </AuthGate>,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'Sign-in failed: Token exchange failed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(auth.retry).toHaveBeenCalledOnce();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(screen.getByText('Chat')).toBeTruthy();
  });
});
