import { AdvancedAgentCapabilities } from '@/features/settings/AdvancedAgentCapabilities';
import { missingPermissionRemedy, permissionRequirementLabel } from '@/lib/permissions/optional';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/settings/AuditKeyCard', () => ({ AuditKeyCard: () => null }));

const granted = new Set(['debugger', 'clipboardRead']);
let declared = ['cookies', 'pageCapture', 'clipboardRead', 'tabCapture'];
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
  declared = ['cookies', 'pageCapture', 'clipboardRead', 'tabCapture'];
  granted.clear();
  granted.add('debugger');
  granted.add('clipboardRead');
  contains.mockReset();
  contains.mockImplementation(async ({ permissions }) =>
    permissions.every((permission) => granted.has(permission)),
  );
  request.mockReset();
  request.mockImplementation(async ({ permissions }) => {
    for (const permission of permissions) granted.add(permission);
    return true;
  });
  remove.mockReset();
  remove.mockImplementation(async ({ permissions }) => {
    for (const permission of permissions) granted.delete(permission);
    return true;
  });
  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({
        permissions: ['debugger', 'sessions'],
        optional_permissions: declared,
      }),
    },
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

    const clipboardRow = (await screen.findByText('Clipboard read')).closest('label');
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

    const clipboardRow = (await screen.findByText('Clipboard read')).closest('label');
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

  it('does not offer switches absent from this browser build manifest', async () => {
    declared = ['cookies', 'clipboardRead'];
    render(<AdvancedAgentCapabilities />);

    await waitFor(() => expect(screen.getByText('Cookies')).toBeTruthy());
    expect(screen.queryByText('Page archive (MHTML)')).toBeNull();
    expect(screen.queryByText('Tab video capture')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('reports a denied optional grant and leaves the switch off', async () => {
    request.mockResolvedValueOnce(false);
    render(<AdvancedAgentCapabilities />);

    const cookiesSwitch = within(
      (await screen.findByText('Cookies')).closest('label') as HTMLElement,
    ).getByRole('switch');
    await waitFor(() => expect(cookiesSwitch.getAttribute('data-state')).toBe('unchecked'));
    fireEvent.click(cookiesSwitch);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Chrome did not grant Cookies'),
    );
    expect(cookiesSwitch.getAttribute('data-state')).toBe('unchecked');
  });

  it('recovers from a rejected status read without leaving controls busy', async () => {
    render(<AdvancedAgentCapabilities />);
    const clipboardSwitch = within(
      (await screen.findByText('Clipboard read')).closest('label') as HTMLElement,
    ).getByRole('switch');
    await waitFor(() => expect(clipboardSwitch.getAttribute('data-state')).toBe('checked'));
    contains.mockRejectedValueOnce(new Error('permissions service unavailable'));
    fireEvent.click(clipboardSwitch);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'could not read extension permissions',
      ),
    );
    expect(clipboardSwitch.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry permission check' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(clipboardSwitch.hasAttribute('disabled')).toBe(false));
    expect(clipboardSwitch.getAttribute('data-state')).toBe('unchecked');
  });

  it('uses the manifest to distinguish required, optional, and unavailable remedies', () => {
    expect(missingPermissionRemedy(['debugger', 'sessions'])).toContain(
      'cannot be enabled in Settings',
    );
    expect(missingPermissionRemedy(['debugger', 'sessions'])).toContain('sessions');
    expect(permissionRequirementLabel(['debugger'])).toBe('req-perm');
    expect(permissionRequirementLabel(['sessions'])).toBe('req-perm');
    expect(missingPermissionRemedy(['cookies'])).toContain(
      'enable optional permission(s) [cookies] in Settings',
    );
    expect(permissionRequirementLabel(['cookies'])).toBe('opt-perm');
    expect(missingPermissionRemedy(['debugger', 'cookies'])).toContain(
      'enable optional permission(s) [cookies] in Settings',
    );
    expect(permissionRequirementLabel(['debugger', 'cookies'])).toBe('mixed perms');
    declared = ['cookies', 'clipboardRead'];
    expect(missingPermissionRemedy(['pageCapture'])).toContain(
      'not declared by this browser build',
    );
    expect(permissionRequirementLabel(['pageCapture'])).toBe('unavailable');
  });

  it('reports a thrown Chrome request and permits a retry', async () => {
    request.mockRejectedValueOnce(new Error('Chrome API unavailable'));
    render(<AdvancedAgentCapabilities />);
    const cookiesSwitch = within(
      (await screen.findByText('Cookies')).closest('label') as HTMLElement,
    ).getByRole('switch');
    fireEvent.click(cookiesSwitch);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Chrome could not change Cookies'),
    );
    expect(cookiesSwitch.getAttribute('data-state')).toBe('unchecked');
    fireEvent.click(cookiesSwitch);
    await waitFor(() => expect(cookiesSwitch.getAttribute('data-state')).toBe('checked'));
  });
});
