import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelActionAdmission } from './usePanelAdmission';
import { useNewPasswordFieldsHost } from './VaultView';

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
    const admission = { run: async <T,>(f: () => Promise<T>) => f() } as unknown as PanelActionAdmission;
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
