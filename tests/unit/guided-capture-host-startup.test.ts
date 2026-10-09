import { registerGuidedCaptureHost } from '@/lib/guided-capture/host';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('registers the capture port when tab-removal events are unavailable', () => {
  const connectListener = vi.fn();
  vi.stubGlobal('chrome', {
    tabs: {},
    runtime: { onConnect: { addListener: connectListener } },
  });

  registerGuidedCaptureHost();

  expect(connectListener).toHaveBeenCalledOnce();
  expect(connectListener).toHaveBeenCalledWith(expect.any(Function));
});
