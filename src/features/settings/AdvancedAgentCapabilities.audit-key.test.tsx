import { AdvancedAgentCapabilities } from '@/features/settings/AdvancedAgentCapabilities';
import { DeviceKeyOutcomeUnknownError } from '@/lib/audit/device-key';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportKey: vi.fn(),
  rotateKey: vi.fn(),
  count: vi.fn(),
  recent: vi.fn(),
  failures: vi.fn(),
  writeText: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/audit/device-key', () => ({
  DeviceKeyOutcomeUnknownError: class extends Error {},
  exportPublicKeyJwk: mocks.exportKey,
  rotateDeviceKey: mocks.rotateKey,
}));
vi.mock('@/lib/audit/log', () => ({
  MAX_RECEIPTS: 1000,
  getReceiptCount: mocks.count,
  getRecentReceipts: mocks.recent,
  getAuditFailureCount: mocks.failures,
}));
vi.mock('@/lib/debug/log', () => ({ log: { error: mocks.logError } }));
vi.mock('@/lib/permissions/optional', () => ({
  OPTIONAL_PERMISSION_LABELS: {},
  declaredRuntimeOptionalPermissions: () => [],
  hasOptionalPermissions: async () => true,
  removeOptionalPermission: vi.fn(),
  requestOptionalPermission: vi.fn(),
}));
vi.mock('@ai-matrx/design-system', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Switch: () => null,
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
  }: { open: boolean; title: string; onConfirm: () => void }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>
          Rotate key
        </button>
      </div>
    ) : null,
}));

const key = {
  publicKeyId: 'isolated-key',
  createdAt: 1,
  publicKeyJwk: { kty: 'OKP', x: 'public-only' },
};

beforeEach(() => {
  mocks.exportKey.mockReset().mockResolvedValue(key);
  mocks.rotateKey.mockReset().mockResolvedValue(undefined);
  mocks.count.mockReset().mockResolvedValue(2);
  mocks.recent.mockReset().mockResolvedValue([]);
  mocks.failures.mockReset().mockResolvedValue(0);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.logError.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});
afterEach(cleanup);

describe('Settings admin audit key', () => {
  it('shows a failed initial read and retries the actual details load', async () => {
    mocks.count.mockRejectedValueOnce(new Error('isolated read failure'));
    render(<AdvancedAgentCapabilities />);
    expect(await screen.findByRole('alert', { name: /audit details/i })).toBeTruthy();
    expect(screen.queryByText('loading…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry audit details/i }));
    expect(await screen.findByText('isolated-key')).toBeTruthy();
    expect(screen.queryByRole('alert', { name: /audit details/i })).toBeNull();
  });

  it('reports clipboard failure without claiming copy, then succeeds on retry', async () => {
    mocks.writeText.mockRejectedValueOnce(new Error('isolated clipboard denial'));
    const { container } = render(<AdvancedAgentCapabilities />);
    await screen.findByText('isolated-key');
    fireEvent.click(screen.getByRole('button', { name: 'Export public key' }));
    expect(await screen.findByRole('alert', { name: /export public key/i })).toBeTruthy();
    expect(container.querySelector('.lucide-check')).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith('ui', 'Audit public key export failed', {
      name: 'Error',
    });
    fireEvent.click(screen.getByRole('button', { name: /retry export/i }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert', { name: /export public key/i })).toBeNull();
    expect(container.querySelector('.lucide-check')).not.toBeNull();
  });

  it('keeps successful rotation distinct from a failed refresh and retries only the read', async () => {
    render(<AdvancedAgentCapabilities />);
    await screen.findByText('isolated-key');
    mocks.count.mockRejectedValueOnce(new Error('isolated refresh failure'));
    fireEvent.click(screen.getByRole('button', { name: 'Re-key' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rotate key' }),
    );
    expect(await screen.findByText(/key rotated/i)).toBeTruthy();
    expect(await screen.findByRole('alert', { name: /audit details/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry audit details/i }));
    await waitFor(() => expect(screen.queryByRole('alert', { name: /audit details/i })).toBeNull());
    expect(mocks.rotateKey).toHaveBeenCalledTimes(1);
  });

  it('blocks another rotation while an ambiguous active-key write is unresolved', async () => {
    render(<AdvancedAgentCapabilities />);
    await screen.findByText('isolated-key');
    mocks.rotateKey.mockRejectedValueOnce(new DeviceKeyOutcomeUnknownError());
    fireEvent.click(screen.getByRole('button', { name: 'Re-key' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rotate key' }),
    );
    expect(await screen.findByRole('alert', { name: /audit key status unknown/i })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Re-key' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /retry audit details/i }));
    await waitFor(() =>
      expect(screen.queryByRole('alert', { name: /audit key status unknown/i })).toBeNull(),
    );
    expect((screen.getByRole('button', { name: 'Re-key' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(mocks.rotateKey).toHaveBeenCalledTimes(1);
  });
});
