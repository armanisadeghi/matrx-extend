/**
 * The side panel's ear for "the web app just sent you a page".
 *
 * Two ways in, because the panel may or may not already exist when the web app
 * asks:
 *  - a FRESH POINTER in chrome storage, read on mount — covers the panel that
 *    opens after the RPC (or was opened by hand a moment later);
 *  - the `capture:pick-up` runtime message — covers the panel that was already
 *    open, which must react now and not on the next 60s poll tick.
 *
 * Unlike `frontend:open-panel-hint`, which this repo broadcasts to nobody at
 * all, this message HAS this listener.
 */

import {
  CAPTURE_PICKUP_MESSAGE,
  type CapturePickup,
  readFreshCapturePickup,
} from '@/lib/capture-ladder/pickup';
import { useEffect, useState } from 'react';

interface PickupMessage {
  __matrx?: unknown;
  kind?: unknown;
}

/**
 * The pointer the web app set, while it is still fresh. Null when the person
 * simply opened the panel themselves.
 */
export function useCapturePickup(): CapturePickup | null {
  const [pickup, setPickup] = useState<CapturePickup | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reread = (): void => {
      void readFreshCapturePickup().then((next) => {
        if (!cancelled) setPickup(next);
      });
    };
    reread();

    if (
      typeof chrome === 'undefined' ||
      typeof chrome.runtime?.onMessage?.addListener !== 'function'
    ) {
      return () => {
        cancelled = true;
      };
    }
    const listener = (message: unknown): void => {
      const msg = message as PickupMessage | null;
      if (!msg || msg.__matrx !== true || msg.kind !== CAPTURE_PICKUP_MESSAGE) return;
      reread();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  return pickup;
}
