/**
 * Cross-browser panel surface.
 *
 * Chromium exposes a tab/window-addressable `sidePanel`; Firefox exposes a
 * window-global `sidebarAction`. Keep that distinction here so callers do not
 * accidentally promise Firefox a tab-specific panel.
 */

export interface PanelOpenRequest {
  tabId?: number;
  windowId?: number;
}

export interface PanelOpenAttempt {
  promise: Promise<unknown> | null;
  reason: string;
}

/** Preserve the browser's rejection while always giving the person a usable next step. */
export function panelOpenRemedy(reason: string): string {
  const action = 'Open Matrx from the browser toolbar and try again.';
  return reason.includes('Open Matrx') ? reason : `${reason} ${action}`;
}

type FirefoxSidebarAction = { open: () => Promise<unknown> };
type PanelChrome = typeof chrome & { sidebarAction?: FirefoxSidebarAction };

function firefoxSidebarAction(): FirefoxSidebarAction | undefined {
  return (chrome as PanelChrome).sidebarAction;
}

/** True only for Firefox's window-global sidebar API. */
export function hasFirefoxSidebarAction(): boolean {
  return typeof firefoxSidebarAction()?.open === 'function';
}

/**
 * Invoke the native panel API synchronously. Chromium keeps the exact request
 * it received; Firefox deliberately receives no tab/window argument.
 */
export function openPanel(request: PanelOpenRequest): PanelOpenAttempt {
  try {
    if (typeof chrome.sidePanel?.open === 'function') {
      return {
        promise: chrome.sidePanel.open(request as Parameters<typeof chrome.sidePanel.open>[0]),
        reason: 'pending',
      };
    }
    const sidebarAction = firefoxSidebarAction();
    if (typeof sidebarAction?.open === 'function') {
      return { promise: sidebarAction.open(), reason: 'pending' };
    }
  } catch (err) {
    return { promise: null, reason: (err as Error)?.message ?? 'open-failed' };
  }
  return {
    promise: null,
    reason: 'panel-unavailable: Open Matrx from the browser toolbar.',
  };
}

/**
 * Firefox's sidebar can be opened only from a browser-owned gesture. This
 * deliberately has no Chromium fallback: callers use it before their first
 * await, then take the normal Chromium route after their durable work.
 */
export function openFirefoxSidebarFromGesture(): PanelOpenAttempt | null {
  if (!hasFirefoxSidebarAction()) return null;
  return openPanel({});
}

/** Chrome-only action-click behavior. Firefox's toolbar popup owns its click. */
export function configurePanelActionClick(): void {
  const setPanelBehavior = chrome.sidePanel?.setPanelBehavior;
  if (typeof setPanelBehavior !== 'function') return;
  try {
    setPanelBehavior({ openPanelOnActionClick: true }).catch((err) =>
      console.error('[matrx-extend] sidePanel.setPanelBehavior failed', err),
    );
  } catch (err) {
    console.error('[matrx-extend] sidePanel.setPanelBehavior failed', err);
  }
}
