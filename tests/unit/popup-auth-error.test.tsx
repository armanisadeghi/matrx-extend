import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  error: 'OAuth sign-in is unavailable because this browser does not provide an identity API',
  signIn: vi.fn(),
  status: 'signed-out',
  user: null,
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('@/lib/panel/adapter', () => ({
  openFirefoxSidebarFromGesture: vi.fn(),
  openPanel: vi.fn(),
  panelOpenRemedy: vi.fn(),
}));

describe('popup sign-in errors', () => {
  beforeEach(() => {
    vi.resetModules();
    auth.error =
      'OAuth sign-in is unavailable because this browser does not provide an identity API';
    auth.status = 'signed-out';
    auth.user = null;
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('shows an identity-API failure after a popup sign-in attempt', async () => {
    await import('@/entrypoints/popup/main');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Sign-in failed: OAuth sign-in is unavailable',
      );
    });
    expect(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled')).toBe(false);
  });
});
