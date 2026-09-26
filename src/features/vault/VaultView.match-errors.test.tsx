import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteSection } from './VaultView';

afterEach(cleanup);

const baseProps = () => ({
  host: 'example.com',
  blockedReason: null,
  pageUrl: 'https://example.com/login',
  matches: [],
  matchesLoading: false,
  matchesError: null,
  running: null,
  outcome: null,
  panelStatus: 'none' as const,
  allowAutomaticLogin: false,
  panelOutcome: null,
  panelOutcomeHost: null,
  panelRunning: null,
  panelItemIds: [],
  onFill: vi.fn(),
  onUseHere: vi.fn(),
  onDismissOutcome: vi.fn(),
  onCreateFromPage: vi.fn(),
  onRetryMatches: vi.fn(),
});

describe('SiteSection match lookup failures', () => {
  it.each([
    [
      { kind: 'forbidden' } as const,
      'The Vault refused this request. You may not have access to this item.',
    ],
    [{ kind: 'server_error', status: 0 } as const, 'The Vault is unavailable right now (0).'],
    [{ kind: 'server_error', status: 200 } as const, 'The Vault is unavailable right now (200).'],
  ])('does not turn %o into a missing-login claim or mutation', (matchesError, message) => {
    const props = { ...baseProps(), matchesError };
    render(<SiteSection {...props} />);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No saved login fills this page.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save this site' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetryMatches).toHaveBeenCalledTimes(1);
    expect(props.onCreateFromPage).not.toHaveBeenCalled();
    expect(props.onFill).not.toHaveBeenCalled();
    expect(props.onUseHere).not.toHaveBeenCalled();
  });

  it('returns to the ordinary empty state after a successful retry result', () => {
    const props = baseProps();
    const { rerender } = render(
      <SiteSection {...props} matchesError={{ kind: 'server_error', status: 0 }} />,
    );
    rerender(<SiteSection {...props} />);

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByText('No saved login fills this page.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save this site' }));
    expect(props.onCreateFromPage).toHaveBeenCalledTimes(1);
  });

  it('does not expose an absence claim, save action, or candidate while retrying', () => {
    const props = baseProps();
    render(
      <SiteSection
        {...props}
        matchesLoading
        matches={[{ item_id: 'candidate', display_name: 'Stale candidate' }]}
      />,
    );

    expect(screen.getByText('Checking saved logins…')).toBeTruthy();
    expect(screen.queryByText('Stale candidate')).toBeNull();
    expect(screen.queryByText('No saved login fills this page.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save this site' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();
  });
});
