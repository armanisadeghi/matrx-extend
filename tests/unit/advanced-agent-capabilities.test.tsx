import { AdvancedAgentCapabilities } from '@/features/settings/AdvancedAgentCapabilities';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/settings/AuditKeyCard', () => ({ AuditKeyCard: () => null }));

const granted = new Set(['debugger', 'clipboardRead']);
const contains = vi.fn(async ({ permissions }: { permissions: string[] }) =>
  permissions.every((permission) => granted.has(permission)),
);
const request = vi.fn(async ({ permissions }: { permissions: string[] }) => {
  for (const permission of permissions) granted.add(permission);
  return true;
});
const remove = vi.fn(async ({ permissions }: { permissions: string[] }) => {
  for (const permission of permissions) granted.delete(permission);
  return true;
});

beforeEach(() => {
  granted.clear();
  granted.add('debugger');
  granted.add('clipboardRead');
  contains.mockClear();
  request.mockClear();
  remove.mockClear();
  vi.stubGlobal('chrome', {
    permissions: {
      contains,
      request,
      remove,
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Advanced agent capabilities', () => {
  it('shows the required debugger grant as status while optional grants remain removable', async () => {
    render(<AdvancedAgentCapabilities />);

    const debuggerRow = screen.getByLabelText('DevTools Protocol permission');
    await waitFor(() =>
      expect(debuggerRow.textContent).toContain('Included with this Chrome extension'),
    );
    expect(within(debuggerRow).queryByRole('switch')).toBeNull();

    const clipboardRow = screen.getByText('Clipboard read').closest('label');
    expect(clipboardRow).not.toBeNull();
    const clipboardSwitch = within(clipboardRow as HTMLElement).getByRole('switch');
    await waitFor(() => expect(clipboardSwitch.getAttribute('data-state')).toBe('checked'));
    fireEvent.click(clipboardSwitch);

    await waitFor(() => expect(remove).toHaveBeenCalledWith({ permissions: ['clipboardRead'] }));
    await waitFor(() => expect(clipboardSwitch.getAttribute('data-state')).toBe('unchecked'));
    expect(remove).not.toHaveBeenCalledWith({ permissions: ['debugger'] });
    expect(request).not.toHaveBeenCalledWith({ permissions: ['debugger'] });
  });

  it('reports a refused optional removal and preserves the actual grant state', async () => {
    remove.mockResolvedValueOnce(false);
    render(<AdvancedAgentCapabilities />);

    const clipboardRow = screen.getByText('Clipboard read').closest('label');
    const clipboardSwitch = within(clipboardRow as HTMLElement).getByRole('switch');
    await waitFor(() => expect(clipboardSwitch.getAttribute('data-state')).toBe('checked'));
    fireEvent.click(clipboardSwitch);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Chrome did not remove Clipboard read',
      ),
    );
    expect(clipboardSwitch.getAttribute('data-state')).toBe('checked');
  });

  it('explains when debugger is absent in this browser build', async () => {
    granted.delete('debugger');
    render(<AdvancedAgentCapabilities />);

    const debuggerRow = screen.getByLabelText('DevTools Protocol permission');
    await waitFor(() =>
      expect(debuggerRow.textContent).toContain('Unavailable in this browser or extension build'),
    );
    expect(within(debuggerRow).queryByRole('switch')).toBeNull();
  });
});
