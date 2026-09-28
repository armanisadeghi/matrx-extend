import {
  cleanupNetworkTapMain,
  networkTapCleanupPresent,
  networkTapMain,
} from '@/lib/data-pattern/network-tap';
import { afterEach, expect, it, vi } from 'vitest';
const bindingName = '__matrx_capture_privacy';
afterEach(() => {
  (window as unknown as Record<string, () => void>)[`${bindingName}_cleanup`]?.();
  delete (window as unknown as Record<string, unknown>).__matrx_net_tap_installed__;
  vi.restoreAllMocks();
});
it('real saved tap sends response and credential canaries only to the CDP binding', async () => {
  const binding = vi.fn();
  (window as unknown as Record<string, unknown>)[bindingName] = binding;
  window.fetch = vi.fn(
    async () =>
      new Response('{"events":[{"title":"PRIVATE_RESPONSE_CANARY"}]}', {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const pageMessages = vi.spyOn(window, 'postMessage');
  const observer = vi.fn();
  window.addEventListener('message', observer);
  try {
    networkTapMain(4096, bindingName);
    await window.fetch('https://calendar.invalid/api?token=CREDENTIAL_CANARY');
    await vi.waitFor(() => expect(binding).toHaveBeenCalledTimes(2));
    expect(binding.mock.calls.at(-1)?.[0]).toContain('PRIVATE_RESPONSE_CANARY');
    expect(pageMessages).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('message', observer);
  }
});
it('an explicitly started manual capture retains its existing relay', async () => {
  window.fetch = vi.fn(
    async () => new Response('{"events":[]}', { headers: { 'content-type': 'application/json' } }),
  );
  const pageMessages = vi.spyOn(window, 'postMessage');
  networkTapMain(4096);
  await window.fetch('https://calendar.invalid/api');
  await vi.waitFor(() => expect(pageMessages).toHaveBeenCalledOnce());
});

it('runs the saved-capture cleanup function only while this capture hook is present', () => {
  const originalFetch = window.fetch;
  networkTapMain(4096, bindingName);
  const hookNonce = (window as unknown as Record<string, unknown>)[`${bindingName}_hook_nonce`];
  expect(typeof hookNonce).toBe('string');
  expect(networkTapCleanupPresent(bindingName, hookNonce as string)).toBe(true);
  expect(networkTapCleanupPresent(bindingName, 'b'.repeat(32))).toBe(false);
  expect(cleanupNetworkTapMain(bindingName, hookNonce as string)).toBe(true);
  expect(window.fetch).toBe(originalFetch);
  expect(networkTapCleanupPresent(bindingName, hookNonce as string)).toBe(false);
  expect(cleanupNetworkTapMain(bindingName, hookNonce as string)).toBe(false);
});
