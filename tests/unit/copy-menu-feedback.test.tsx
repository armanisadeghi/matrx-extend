import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ copy: vi.fn() }));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock('@/lib/clipboard/copy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clipboard/copy')>()),
  copyToClipboard: mocks.copy,
}));
// Keep the real CopyMenu state and action path; only replace popover presentation.
vi.mock('@ai-matrx/design-system', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { CopyMenu } from '@/components/CopyMenu';
import { stringifyJson } from '@/lib/clipboard/copy';

afterEach(() => {
  cleanup();
  mocks.copy.mockReset();
});

describe('CopyMenu feedback', () => {
  it('shows a failed copy instead of a green check when JSON cannot be prepared', async () => {
    const cyclic: Record<string, unknown> = { event_title: 'Harbor Jazz Friday' };
    cyclic['related_event'] = cyclic;
    render(<CopyMenu options={[{ label: 'JSON', getContent: () => stringifyJson(cyclic) }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not prepare this content');
    expect(screen.getByRole('img', { name: 'Copy failed' })).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Copied' })).toBeNull();
    expect(mocks.copy).not.toHaveBeenCalled();
  });

  it('shows a failed copy for a rejected clipboard write in the multi-option menu', async () => {
    mocks.copy.mockResolvedValue(false);
    render(
      <CopyMenu
        options={[
          { label: 'JSON', getContent: () => '{"event_title":"Harbor Jazz Friday"}' },
          { label: 'TSV', getContent: () => 'event_title\nHarbor Jazz Friday' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Copy failed');
    expect(screen.getByRole('img', { name: 'Copy failed' })).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Copied' })).toBeNull();
    expect(mocks.copy).toHaveBeenCalledWith('{"event_title":"Harbor Jazz Friday"}');
  });

  it('shows the success check only after the clipboard write succeeds', async () => {
    mocks.copy.mockResolvedValue(true);
    render(<CopyMenu options={[{ label: 'JSON', getContent: () => '{"event_title":"Sunday Matinee"}' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('img', { name: 'Copied' })).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
