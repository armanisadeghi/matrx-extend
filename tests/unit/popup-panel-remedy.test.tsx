import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  attempt: { promise: null as Promise<unknown> | null, reason: 'Native Firefox refusal' },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'admin@admin.com' }, signIn: vi.fn() }),
}));
vi.mock('@/lib/panel/adapter', () => ({
  openFirefoxSidebarFromGesture: () => state.attempt,
  openPanel: vi.fn(),
  panelOpenRemedy: (reason: string) =>
    `${reason} Open Matrx from the browser toolbar and try again.`,
}));

describe('popup panel remedy', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    state.attempt = { promise: null, reason: 'Native Firefox refusal' };
    window.close = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the mounted popup open and names the action after a synchronous Firefox refusal', async () => {
    await import('@/entrypoints/popup/main');
    await userEvent.click(await screen.findByRole('button', { name: 'Open chat' }));

    expect(screen.getByRole('alert').textContent).toContain(
      'Native Firefox refusal Open Matrx from the browser toolbar and try again.',
    );
    expect(window.close).not.toHaveBeenCalled();
  });
});
