import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmationParent } from './vault-confirmation';

const confirmationFactory = vi.hoisted(() => vi.fn());
vi.mock('./vault-confirmation-host', async (importOriginal) => {
  const original = await importOriginal<typeof import('./vault-confirmation-host')>();
  return { ...original, createVaultConfirmationHost: confirmationFactory };
});

import { useNewPasswordFieldsHost, useVaultConfirmationHost } from './VaultView';
import type { PanelActionAdmission } from './usePanelAdmission';

/**
 * The generator's "Fill page" host survives StrictMode (review E4, 2026-10-22):
 * it was made in useMemo and disposed in a cleanup-only effect, so the dev
 * build's mount → cleanup → mount kept the DISPOSED copy and every "Fill page"
 * said "This page can't be reached" without ever opening the panel port.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useNewPasswordFieldsHost', () => {
  it('leaves a live host after StrictMode remounts: find() opens the panel port', async () => {
    const port = {
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      disconnect: vi.fn(),
    };
    const connect = vi.fn(() => port);
    vi.stubGlobal('chrome', {
      runtime: {
        connect,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn(async () => undefined),
      },
    });
    const admission = {
      run: async <T,>(f: () => Promise<T>) => f(),
    } as unknown as PanelActionAdmission;
    const held: { current: ReturnType<typeof useNewPasswordFieldsHost> } = { current: null };
    function Probe() {
      held.current = useNewPasswordFieldsHost(7, admission);
      return null;
    }
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(held.current).not.toBeNull();
    void held.current?.find();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('useVaultConfirmationHost', () => {
  it('cancels only the discarded StrictMode controller and leaves the remounted workspace live', () => {
    const made: Array<{ dispose: ReturnType<typeof vi.fn>; marker: number }> = [];
    confirmationFactory.mockImplementation(() => {
      const host = { dispose: vi.fn(), marker: made.length + 1 };
      made.push(host);
      return host;
    });
    const actor: ConfirmationParent = {
      userId: '1f82af75-fb56-4881-9721-3f0580e166a4',
      sessionId: 'session-harbor-dental',
      organizationId: 'f60ac767-0f56-4b4d-9c5a-73cc824bb54c',
      email: 'admin@admin.com',
      hasPassword: true,
    };
    const held: { current: ReturnType<typeof useVaultConfirmationHost> } = { current: null };
    function Probe() {
      held.current = useVaultConfirmationHost(actor);
      return null;
    }

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    expect(made).toHaveLength(2);
    expect(made[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]?.dispose).not.toHaveBeenCalled();
    expect((held.current as unknown as { marker: number }).marker).toBe(2);
  });
});
