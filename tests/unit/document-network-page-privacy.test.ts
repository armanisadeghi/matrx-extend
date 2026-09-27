import { afterEach, expect, it, vi } from 'vitest';
import { networkTapMain } from '@/lib/data-pattern/network-tap';
const bindingName = '__matrx_capture_privacy';
afterEach(() => {
  (window as unknown as Record<string, () => void>)[`${bindingName}_cleanup`]?.();
  delete (window as unknown as Record<string, unknown>).__matrx_net_tap_installed__;
  vi.restoreAllMocks();
});
it('real saved tap sends response and credential canaries only to the CDP binding', async () => {
  const binding = vi.fn();
  (window as unknown as Record<string, unknown>)[bindingName] = binding;
  window.fetch = vi.fn(async () => new Response('{"events":[{"title":"PRIVATE_RESPONSE_CANARY"}]}', { headers: { 'content-type': 'application/json' } }));
  const pageMessages = vi.spyOn(window, 'postMessage');
  const observer = vi.fn(); window.addEventListener('message', observer);
  try {
    networkTapMain(4096, bindingName);
    await window.fetch('https://calendar.invalid/api?token=CREDENTIAL_CANARY');
    await vi.waitFor(() => expect(binding).toHaveBeenCalledOnce());
    expect(binding.mock.calls[0]![0]).toContain('PRIVATE_RESPONSE_CANARY');
    expect(pageMessages).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
  } finally { window.removeEventListener('message', observer); }
});
it('an explicitly started manual capture retains its existing relay', async () => {
  window.fetch = vi.fn(async () => new Response('{"events":[]}', { headers: { 'content-type': 'application/json' } }));
  const pageMessages = vi.spyOn(window, 'postMessage');
  networkTapMain(4096);
  await window.fetch('https://calendar.invalid/api');
  await vi.waitFor(() => expect(pageMessages).toHaveBeenCalledOnce());
});
