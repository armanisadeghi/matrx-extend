import { generateCredentialSecret } from '@ai-matrx/kit/credential-generator';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  copy: vi.fn(),
  sendMessage: vi.fn(),
  listeners: new Set<(message: unknown) => void>(),
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
  mocks.rpc
    .mockResolvedValueOnce({ data: 1024, error: null })
    .mockResolvedValueOnce({ data: 64, error: null });
  mocks.sendMessage.mockResolvedValue({ status: 'ready', offers: [offer] });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: mocks.sendMessage,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => mocks.listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) => mocks.listeners.delete(listener),
      },
    },
  };
});
afterEach(cleanup);

describe('PasswordGenerator', () => {
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
});
