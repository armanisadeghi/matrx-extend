import type { SidepanelTab } from '@/state/sidepanel-tab';

export const POPUP_LAUNCH_INTENT_KEY = 'matrx.sidepanel.popup_launch_intent';
const CAPTURE_PAGE_INTENT_TTL_MS = 15_000;

type CapturePageIntent = {
  phase: 'pending' | 'armed';
  kind: 'capture-page';
  windowId: number;
  requestId: string;
  createdAt: number;
  expiresAt: number;
  contextId?: string;
};

export interface CapturePagePanelRequest {
  key: string;
  intent: CapturePageIntent;
  write: Promise<void>;
}

export function armCapturePagePanel(
  request: CapturePagePanelRequest,
  contextId: string,
): Promise<void> {
  const armed = { ...request.intent, phase: 'armed' as const, contextId };
  return chrome.storage.session.set({ [request.key]: armed }).then(() => {
    request.intent = armed;
  });
}

type SidePanelContext = { contextId: string; contextType: string; windowId?: number };

export async function waitForSidePanelContextId(windowId: number): Promise<string | null> {
  const runtime = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: { contextTypes: string[] }) => Promise<SidePanelContext[]>;
  };
  if (!runtime.getContexts) return null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let contexts: SidePanelContext[];
    try {
      contexts = await runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
    } catch {
      return null;
    }
    const matches = contexts.filter(
      (context) => context.contextType === 'SIDE_PANEL' && context.windowId === windowId,
    );
    if (matches.length === 1) return matches[0]?.contextId ?? null;
    if (matches.length > 1) return null;
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function isCapturePageIntent(value: unknown): value is CapturePageIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CapturePageIntent>;
  return (
    candidate.kind === 'capture-page' &&
    (candidate.phase === 'pending' || candidate.phase === 'armed') &&
    typeof candidate.windowId === 'number' &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.expiresAt === 'number'
  );
}

function keyFor(windowId: number, requestId: string): string {
  return `${POPUP_LAUNCH_INTENT_KEY}.${windowId}.${requestId}`;
}

export function requestCapturePagePanel(windowId: number): CapturePagePanelRequest {
  const requestId = crypto.randomUUID();
  const createdAt = Date.now();
  const intent: CapturePageIntent = {
    phase: 'pending',
    kind: 'capture-page',
    windowId,
    requestId,
    createdAt,
    expiresAt: createdAt + CAPTURE_PAGE_INTENT_TTL_MS,
  };
  const key = keyFor(windowId, requestId);
  return { key, intent, write: chrome.storage.session.set({ [key]: intent }) };
}

/** Removes only this click's record, even if a later click is already stored. */
export async function clearCapturePagePanel(request: CapturePagePanelRequest): Promise<boolean> {
  await request.write.catch(() => undefined);
  try {
    await chrome.storage.session.remove(request.key);
    return true;
  } catch {
    return false;
  }
}

const claimQueues = new Map<number, Promise<void>>();
const attemptedClaimKeys = new Map<string, number>();

/**
 * The result of consuming a popup route request. `claim_failed` deliberately
 * carries no intent data: the panel only needs to tell the person that Capture
 * did not open and offer the safe manual Scrape route.
 */
export type PopupLaunchTargetClaim =
  | { status: 'none' }
  | { status: 'claimed'; target: SidepanelTab }
  | { status: 'claim_failed' };

function pruneAttemptedClaims(now: number): void {
  for (const [key, expiresAt] of attemptedClaimKeys) {
    if (expiresAt < now) attemptedClaimKeys.delete(key);
  }
}

/** Claims the latest unexpired request for one window, then removes its snapshot. */
export function takePopupLaunchTarget(
  windowId: number,
  contextId: string,
): Promise<PopupLaunchTargetClaim> {
  const previous = claimQueues.get(windowId) ?? Promise.resolve();
  const claimPopupLaunchTarget = previous.then(async (): Promise<PopupLaunchTargetClaim> => {
    let rows: Record<string, unknown>;
    try {
      rows = await chrome.storage.session.get(null);
    } catch {
      return { status: 'none' };
    }

    const now = Date.now();
    pruneAttemptedClaims(now);
    const candidates: Array<[string, CapturePageIntent]> = [];
    for (const [key, value] of Object.entries(rows)) {
      if (
        key.startsWith(`${POPUP_LAUNCH_INTENT_KEY}.${windowId}.`) &&
        isCapturePageIntent(value) &&
        value.windowId === windowId &&
        value.phase === 'armed' &&
        value.contextId === contextId &&
        !attemptedClaimKeys.has(key) &&
        value.expiresAt >= now
      ) {
        candidates.push([key, value]);
      }
    }
    candidates.sort(([, left], [, right]) => right.createdAt - left.createdAt);
    if (candidates.length === 0) return { status: 'none' };

    try {
      await chrome.storage.session.remove(candidates.map(([key]) => key));
    } catch {
      for (const [key, intent] of candidates) attemptedClaimKeys.set(key, intent.expiresAt);
      return { status: 'claim_failed' };
    }
    for (const [key, intent] of candidates) attemptedClaimKeys.set(key, intent.expiresAt);
    return { status: 'claimed', target: 'scrape' };
  });
  claimQueues.set(
    windowId,
    claimPopupLaunchTarget.then(
      () => undefined,
      () => undefined,
    ),
  );
  return claimPopupLaunchTarget;
}
