import { generateCredentialSecret } from '@ai-matrx/kit/credential-generator';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  copy: vi.fn(),
  sendMessage: vi.fn(),
  listeners: new Set<(message: unknown) => void>(),
  portListeners: new Set<(message: unknown) => void>(),
  portDisconnects: new Set<() => void>(),
  connectionCount: 0,
  autoHandshake: true,
  ports: [] as Array<{ handshake: () => void; disconnect: () => void }>,
}));
vi.mock('@/lib/supabase/schemas', () => ({ platformDb: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/clipboard/copy', () => ({ copyToClipboard: mocks.copy }));
import { PasswordGenerator } from './PasswordGenerator';

const offer = {
  id: 'offer-1',
  origin: 'https://account.example',
  frameId: 0,
  fieldCount: 2,
  constraints: [],
  expiresAt: Date.now() + 30_000,
};
const actor = { userId: 'user-1', organizationId: 'org-1' };
const admission = { current: () => true, run: async <T,>(work: () => Promise<T>) => work() };
const renderGenerator = () =>
  render(<PasswordGenerator tabId={12} actor={actor} admission={admission} />);
const open = () => fireEvent.click(screen.getByRole('button', { name: /password generator/i }));
async function generate() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await screen.findByRole('button', { name: 'Reveal generated value' });
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.copy.mockReset().mockResolvedValue(true);
  mocks.sendMessage.mockReset();
  mocks.listeners.clear();
  mocks.portListeners.clear(); mocks.portDisconnects.clear(); mocks.connectionCount = 0; mocks.autoHandshake = true; mocks.ports = [];
  mocks.rpc
    .mockResolvedValueOnce({ data: 1024, error: null })
    .mockResolvedValueOnce({ data: 64, error: null });
  mocks.sendMessage.mockResolvedValue({ status: 'ready', offers: [offer] });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: mocks.sendMessage,
      connect: () => {
        const connectionId = (++mocks.connectionCount).toString(16).padStart(36, '0');
        const messageListeners = new Set<(message: unknown) => void>();
        const disconnectListeners = new Set<() => void>();
        const handshake = () => messageListeners.forEach((listener) => listener({ __matrxCredentialGeneration: true, operation: 'connected', connectionId }));
        const disconnect = () => disconnectListeners.forEach((listener) => listener());
        const port = {
          onMessage: { addListener: (listener: (message: unknown) => void) => { mocks.portListeners.add(listener); messageListeners.add(listener); if (mocks.autoHandshake) handshake(); }, removeListener: (listener: (message: unknown) => void) => { mocks.portListeners.delete(listener); messageListeners.delete(listener); } },
          onDisconnect: { addListener: (listener: () => void) => { mocks.portDisconnects.add(listener); disconnectListeners.add(listener); }, removeListener: (listener: () => void) => { mocks.portDisconnects.delete(listener); disconnectListeners.delete(listener); } },
          disconnect,
        };
        mocks.ports.push({ handshake, disconnect });
        return port;
      },
      onMessage: {
        addListener: (listener: (message: unknown) => void) => mocks.listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) => mocks.listeners.delete(listener),
      },
    },
  };
});
afterEach(cleanup);

describe('PasswordGenerator', () => {
  it('clears a mounted panel on disconnect and uses a fresh connection for a later Generate', async () => {
    renderGenerator();
    open();
    await generate();
    const first = (mocks.sendMessage.mock.calls[0]?.[0] as { connectionId: string }).connectionId;
    mocks.ports[0]!.disconnect();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull());
    mocks.rpc.mockReset()
      .mockResolvedValueOnce({ data: 1024, error: null })
      .mockResolvedValueOnce({ data: 64, error: null });
    await generate();
    const last = mocks.sendMessage.mock.calls.at(-1)?.[0] as { connectionId: string; operation: string };
    expect(last.operation).toBe('discover');
    expect(last.connectionId).not.toBe(first);
    mocks.sendMessage.mockResolvedValueOnce({ status: 'filled', message: 'Filled. Matrx did not submit the form.' });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await screen.findByText('Filled. Matrx did not submit the form.');
  });

  it('ignores a late handshake from a disconnected port', async () => {
    renderGenerator();
    open();
    const staleListener = [...mocks.portListeners][0]!;
    mocks.autoHandshake = false;
    mocks.ports[0]!.disconnect();
    staleListener({ __matrxCredentialGeneration: true, operation: 'connected', connectionId: 'f'.repeat(36) });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    mocks.ports[1]!.disconnect();
  });

  it('is closed and inert until explicitly opened and generated', () => {
    renderGenerator();
    expect(screen.queryByLabelText('Password length')).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    open();
    expect(screen.getByLabelText('Password length')).toHaveProperty('value', '24');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('uses the published engine for explicit password reveal, copy, and Use without submit', async () => {
    renderGenerator();
    open();
    await generate();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      __matrxCredentialGeneration: true,
      operation: 'discover',
      connectionId: expect.any(String),
      tabId: 12,
    });
    expect(screen.getByText('••••••••••••••••••••••••')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal generated value' }));
    expect(screen.getByRole('button', { name: 'Hide generated value' })).toBeTruthy();
    const value = document.querySelector('code')?.textContent ?? '';
    expect(value).toHaveLength(24);
    expect(value).toMatch(/[a-z]/);
    expect(value).toMatch(/[A-Z]/);
    expect(value).toMatch(/[0-9]/);
    expect(value).toMatch(/[^A-Za-z0-9]/);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await screen.findByText('Copied. Clipboard is not cleared automatically.');
    mocks.sendMessage.mockResolvedValueOnce({
      status: 'filled',
      message: 'Filled. Matrx did not submit the form.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await screen.findByText('Filled. Matrx did not submit the form.');
    const request = mocks.sendMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(request).toMatchObject({
      __matrxCredentialGeneration: true,
      operation: 'use',
      offerId: 'offer-1',
    });
    expect(typeof request.value).toBe('string');
    expect(mocks.sendMessage.mock.calls.some(([item]) => item?.operation === 'submit')).toBe(false);
  });

  it('generates a six-word passphrase under the configured 64-word ceiling', async () => {
    renderGenerator();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Passphrase' }));
    fireEvent.change(screen.getByLabelText('Passphrase separator'), { target: { value: '.' } });
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal generated value' }));
    expect((document.querySelector('code')?.textContent ?? '').split('.')).toHaveLength(6);
  });

  it('uses the installed engine defaults at the documented 64-bit floor', () => {
    const result = generateCredentialSecret(undefined, {
      maxPasswordLength: 1024,
      maxPassphraseWords: 64,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(24);
      expect(result.entropyBitsLowerBound).toBeGreaterThanOrEqual(64);
    }
  });

  it('clears values and offers on options, collapse, Escape, and unmount', async () => {
    const mounted = renderGenerator();
    open();
    await generate();
    fireEvent.change(screen.getByLabelText('Password length'), { target: { value: '25' } });
    expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull();
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      __matrxCredentialGeneration: true,
      operation: 'discard',
      connectionId: expect.any(String),
      offerIds: ['offer-1'],
    });
    mocks.rpc.mockResolvedValue({ data: 1024, error: null });
    mocks.sendMessage.mockResolvedValue({ status: 'ready', offers: [offer] });
    await generate();
    fireEvent.click(screen.getByRole('button', { name: /password generator/i }));
    expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull();
    open();
    await generate();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Password length')).toBeNull();
    mounted.unmount();
  });

  it('expires only its current offer and ignores invalidation for a replaced offer', async () => {
    vi.useFakeTimers();
    try {
      renderGenerator();
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: 'Reveal generated value' })).toBeTruthy();
      for (const listener of mocks.listeners)
        listener({
          __matrxCredentialGeneration: true,
          operation: 'invalidated',
          offerIds: ['older-offer'],
        });
      expect(screen.getByRole('button', { name: 'Reveal generated value' })).toBeTruthy();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull();
      expect(screen.getByText(/expired/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears only when an invalidation names the current offer', async () => {
    renderGenerator();
    open();
    await generate();
    for (const listener of mocks.listeners)
      listener({
        __matrxCredentialGeneration: true,
        operation: 'invalidated',
        offerIds: ['offer-1'],
      });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull(),
    );
    expect(screen.getByText(/page changed/i)).toBeTruthy();
  });

  it.each(['collapse', 'escape', 'options'] as const)(
    'does not generate after deferred limits resolve following %s',
    async (action) => {
      let resolveLimit!: (value: { data: number; error: null }) => void;
      mocks.rpc.mockReset();
      mocks.rpc
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveLimit = resolve as typeof resolveLimit;
            }),
        )
        .mockResolvedValueOnce({ data: 64, error: null });
      renderGenerator();
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
      if (action === 'collapse')
        fireEvent.click(screen.getByRole('button', { name: /password generator/i }));
      if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
      if (action === 'options')
        fireEvent.change(screen.getByLabelText('Password length'), { target: { value: '25' } });
      resolveLimit({ data: 1024, error: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.sendMessage).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull();
    },
  );

  it('does not resolve settings or generate after admission becomes stale', async () => {
    const stale = {
      current: () => false,
      run: async <T,>(_work: () => Promise<T>) => null as T | null,
    };
    render(<PasswordGenerator tabId={12} actor={actor} admission={stale} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('clears a current generated value when discovery loses admission', async () => {
    let runs = 0;
    const discoveryLost = {
      current: () => true,
      run: async <T,>(work: () => Promise<T>) => (++runs === 1 ? work() : null),
    };
    render(<PasswordGenerator tabId={12} actor={actor} admission={discoveryLost} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await screen.findByText(/page or account changed/i);
    expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(document.querySelector('code')).toBeNull();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('never restores a late discovery after collapse', async () => {
    let resolveDiscovery!: (response: { status: 'ready'; offers: (typeof offer)[] }) => void;
    mocks.sendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDiscovery = resolve as typeof resolveDiscovery;
        }),
    );
    renderGenerator();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /password generator/i }));
    resolveDiscovery({ status: 'ready', offers: [offer] });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reveal generated value' })).toBeNull(),
    );
  });

  it('does not let an old discovery clear a newer generated value', async () => {
    let resolveOld!: (response: { status: 'ready'; offers: (typeof offer)[] }) => void;
    mocks.sendMessage
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve as typeof resolveOld;
          }),
      )
      .mockResolvedValue({ status: 'ready', offers: [offer] });
    renderGenerator();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /password generator/i }));
    open();
    mocks.rpc.mockResolvedValue({ data: 1024, error: null });
    await generate();
    resolveOld({ status: 'ready', offers: [offer] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Reveal generated value' })).toBeTruthy();
  });

  it('keeps the Filled result after the former secret TTL elapses', async () => {
    vi.useFakeTimers();
    try {
      renderGenerator();
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      mocks.sendMessage.mockResolvedValueOnce({
        status: 'filled',
        message: 'Filled. Matrx did not submit the form.',
      });
      fireEvent.click(screen.getByRole('button', { name: 'Use' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('Filled. Matrx did not submit the form.')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(screen.getByText('Filled. Matrx did not submit the form.')).toBeTruthy();
      expect(screen.queryByText(/expired/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
