import { STORAGE_KEYS } from '@/config/env';
import { getCurrentUser } from '@/lib/auth/flow';
import { normalizeLoginUrl } from '@/lib/credentials/login-urls';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';

export interface PanelActionAdmission {
  current: () => boolean;
  run: <T>(work: () => Promise<T>) => Promise<T | null>;
}

// One per sidepanel JS realm, including when its Vault view is unmounted.
// Holds no credential or actor data; released only by the admitted operation.
let panelActionBusy = false;

/** One lock outlives keyed sessions; invalidation happens before async refresh. */
export function usePanelAdmission(
  tabId: number | null,
  pageUrl: string | null,
  actor: { userId: string; organizationId: string } | null,
) {
  const selectedTab = useRef(tabId);
  selectedTab.current = tabId;
  const epoch = useRef(0);
  const [revision, redraw] = useReducer((n: number) => n + 1, 0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      epoch.current++;
      redraw();
    };
    const updated = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === selectedTab.current && (change.url !== undefined || change.status === 'loading'))
        invalidate();
    };
    const message = (value: { __matrx?: boolean; kind?: string }) => {
      if (value?.__matrx && value.kind === CHANNELS.AUTH_STATE_CHANGED) invalidate();
    };
    const storage = (changes: Record<string, unknown>, area: string) => {
      if (
        area === 'local' &&
        [
          STORAGE_KEYS.ACCESS_TOKEN,
          STORAGE_KEYS.USER_PROFILE,
          STORAGE_KEYS.ACTIVE_ORGANIZATION,
        ].some((key) => key in changes)
      )
        invalidate();
    };
    chrome.tabs.onActivated.addListener(invalidate);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.windows.onFocusChanged.addListener(invalidate);
    chrome.runtime.onMessage.addListener(message);
    chrome.storage.onChanged.addListener(storage);
    return () => {
      mounted.current = false;
      chrome.tabs.onActivated.removeListener(invalidate);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.windows.onFocusChanged.removeListener(invalidate);
      chrome.runtime.onMessage.removeListener(message);
      chrome.storage.onChanged.removeListener(storage);
    };
  }, []);
  const owner = JSON.stringify([
    tabId,
    normalizeLoginUrl(pageUrl),
    actor?.userId,
    actor?.organizationId,
    revision,
  ]);
  const token = useMemo(() => ({ owner }), [owner]);
  const latest = useRef(token);
  latest.current = token;
  const capturedEpoch = epoch.current;
  const current = useCallback(
    () => mounted.current && latest.current === token && epoch.current === capturedEpoch,
    [token, capturedEpoch],
  );
  const admission = useMemo<PanelActionAdmission>(
    () => ({
      current,
      run: async (work) => {
        if (panelActionBusy || !current() || !actor || tabId == null) return null;
        panelActionBusy = true;
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (
            !current() ||
            tab?.id !== tabId ||
            normalizeLoginUrl(tab.url ?? null) !== normalizeLoginUrl(pageUrl)
          )
            return null;
          const user = await getCurrentUser();
          if (!current() || user?.id !== actor.userId) return null;
          const org = await getActiveOrganizationId();
          if (!current() || org !== actor.organizationId) return null;
          return await work();
        } catch {
          // Admission errors may include backend data; never surface raw text.
          return null;
        } finally {
          panelActionBusy = false;
        }
      },
    }),
    [actor, current, pageUrl, tabId],
  );
  return { owner, admission };
}
