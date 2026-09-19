import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listeners = new Set<(message: unknown) => void>();
const sendMessage = vi.fn();

vi.mock('@/lib/supabase/schemas', () => ({
  platformDb: () => ({ rpc: vi.fn() }),
}));

import { PasswordGenerator } from './PasswordGenerator';

const admission = {
  current: () => true,
  run: async <T,>(work: () => Promise<T>) => work(),
};

afterEach(() => {
  cleanup();
  sendMessage.mockReset();
  listeners.clear();
});

describe('PasswordGenerator', () => {
  it('is closed and inert until the person explicitly opens and generates', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: (listener: (message: unknown) => void) => listeners.add(listener),
          removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
        },
      },
    };

    render(
      <PasswordGenerator
        tabId={12}
        actor={{ userId: 'user-1', organizationId: 'org-1' }}
        admission={admission}
      />,
    );

    expect(screen.queryByLabelText('Password length')).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /password generator/i }));
    expect(screen.getByLabelText('Password length')).toHaveProperty('value', '24');
    expect(screen.getByRole('button', { name: 'Generate' })).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
