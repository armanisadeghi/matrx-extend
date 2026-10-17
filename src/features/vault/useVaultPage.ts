/**
 * The tab beside the panel, as the package's `page` + `fill` abilities.
 *
 * Three existing mechanics, unchanged:
 *   - the SERVER's "which logins may fill this page" read (`fetchBrowserLoginMatches`,
 *     bound to the exact tab, page and actor);
 *   - the focused frame's own offer from the service worker
 *     (`credential-suggestions:panel-status`, re-read on `credential-assistance:changed`);
 *   - Fill through that offer (`credential-suggestions:panel-fill`), and "Sign in for me"
 *     through the SAME `credential_login` handler the agent runs (one origin check,
 *     one top-frame rule, one audit trail for the human button and the agent).
 *
 * Every action runs through the panel admission: a tab, page or account change
 * mid-way makes it a no-op (`not_started`).
 */

import { fetchBrowserLoginMatches } from '@/lib/api/routes/vault';
import { isBrowserSupported } from '@/lib/browser/detect';
import { isFillablePageUrl, normalizeLoginUrl } from '@/lib/credentials/login-urls';
import {
  type PanelSavedLoginSnapshot,
  parsePanelSavedLoginStatus,
} from '@/lib/credentials/panel-saved-login-status';
import { credential_login } from '@/lib/tools/handlers/credential-login';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ExtensionFill,
  type ExtensionPage,
  type FillOutcome,
  type SignInOutcome,
  fillOutcomeOf,
  matchErrorOf,
  signInOutcomeOf,
} from './extension-vault-host';
import type { PanelActionAdmission } from './usePanelAdmission';

type Actor = { userId: string; organizationId: string };

type MatchRead =
  | { owner: string; status: 'ready'; ids: string[] }
  | { owner: string; status: 'error'; reason: string };

/** The focused frame's offer, re-read whenever the service worker says assistance changed. */
function usePanelSnapshot(tabId: number | null, admission: PanelActionAdmission) {
  const [snapshot, setSnapshot] = useState<PanelSavedLoginSnapshot>({
    status: 'loading',
    itemIds: [],
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    let request = 0;
    const read = () => {
      if (tabId == null) return;
      const ticket = ++request;
      setSnapshot({ status: 'loading', itemIds: [] });
      void chrome.runtime
        .sendMessage({
          __matrx: true,
          kind: 'credential-suggestions:panel-status',
          payload: { tabId },
        })
        .then((value: unknown) => {
          if (live && ticket === request && admission.current())
            setSnapshot(parsePanelSavedLoginStatus(value));
        })
        .catch(() => {
          if (live && ticket === request && admission.current())
            setSnapshot({ status: 'unavailable', itemIds: [] });
        });
    };
    read();
    const listener = (message: unknown) => {
      const env = message as { __matrx?: unknown; kind?: unknown; payload?: { tabId?: unknown } };
      if (
        env?.__matrx === true &&
        env.kind === 'credential-assistance:changed' &&
        env.payload?.tabId === tabId
      )
        read();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      live = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
    // `revision` re-reads on Check again.
  }, [admission, tabId, revision]);
  return { snapshot, setSnapshot, reread: () => setRevision((n) => n + 1) };
}

export function useVaultPage(
  tab: { id: number | null; url: string | null },
  actor: Actor | null,
  admission: PanelActionAdmission,
): { page: ExtensionPage | undefined; fill: ExtensionFill | undefined } {
  const { snapshot, setSnapshot, reread } = usePanelSnapshot(tab.id, admission);
  // The focused frame's page (a sign-in form inside a frame) answers for matches, as before.
  const pageUrl = snapshot.status === 'ready' ? snapshot.pageUrl : tab.url;
  const normalized = normalizeLoginUrl(pageUrl);
  const fillable = isFillablePageUrl(pageUrl);
  const owner = `${tab.id ?? 'none'}:${normalized ?? 'none'}:${actor?.userId ?? 'none'}:${actor?.organizationId ?? 'none'}`;
  const [read, setRead] = useState<MatchRead | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const run = ++generation.current;
    if (!actor || tab.id == null || !normalized || !fillable) return;
    void fetchBrowserLoginMatches(normalized, undefined, { expectedActor: actor }).then(
      (result) => {
        if (run !== generation.current || !admission.current()) return;
        setRead(
          result.ok
            ? { owner, status: 'ready', ids: result.data.matches.map((m) => m.item_id) }
            : { owner, status: 'error', reason: result.failure.kind },
        );
      },
    );
    return () => {
      generation.current++;
    };
    // `retry` re-runs the same read.
  }, [actor, admission, fillable, normalized, owner, tab.id, retry]);

  const current = read?.owner === owner ? read : null;
  const matchesPending = !!actor && tab.id != null && !!normalized && fillable && !current;

  const fill = useCallback<ExtensionFill>(
    async (itemId) => {
      if (
        tab.id == null ||
        snapshot.status !== 'ready' ||
        !snapshot.itemIds.includes(itemId) ||
        !admission.current()
      )
        return 'not_started';
      const offerId = snapshot.offerId;
      const tabId = tab.id;
      let outcome: FillOutcome = 'not_started';
      await admission.run(async () => {
        try {
          const result = (await chrome.runtime.sendMessage({
            __matrx: true,
            kind: 'credential-suggestions:panel-fill',
            payload: { tabId, offerId, itemId },
          })) as { status?: unknown };
          outcome = fillOutcomeOf(result?.status);
        } catch {
          outcome = 'unavailable';
        } finally {
          // The offer is spent: the person focuses a field again for the next Fill.
          setSnapshot((s) =>
            s.status === 'ready' && s.offerId === offerId ? { status: 'none', itemIds: [] } : s,
          );
        }
      });
      return outcome;
    },
    [admission, setSnapshot, snapshot, tab.id],
  );

  const signInSupported = isBrowserSupported(credential_login.supportedBrowsers);
  const signIn = useCallback(
    async (itemId: string): Promise<SignInOutcome> => {
      const tabId = tab.id;
      if (tabId == null) return 'unknown';
      let outcome: SignInOutcome = 'unknown';
      await admission.run(async () => {
        try {
          const result = await credential_login.run(
            { action: 'auto', credential_item_id: itemId },
            {
              conversationId: null,
              runId: 'vault-panel',
              callId: `vault-panel-${Date.now()}`,
              agentName: null,
              permissionMode: 'act',
              assignedTabId: tabId,
            },
          );
          outcome = signInOutcomeOf(String(result.status));
        } catch {
          // Never surface a thrown error: a fill exception can carry the value on some engines.
          outcome = 'unknown';
        }
      });
      return outcome;
    },
    [admission, tab.id],
  );

  const page = useMemo<ExtensionPage | undefined>(() => {
    if (tab.id == null) return undefined;
    const refresh = () => {
      reread();
      setRetry((n) => n + 1);
    };
    const blocked: ExtensionPage['blocked'] = !fillable
      ? 'restricted'
      : snapshot.status === 'loading'
        ? 'checking'
        : snapshot.status === 'unavailable'
          ? 'unavailable'
          : snapshot.status === 'disabled'
            ? 'matching_off'
            : snapshot.status === 'none'
              ? 'no_field'
              : undefined;
    // "Sign in for me" fills and submits the TOP frame only: never offered for a frame's form.
    const canSignIn =
      fillable && snapshot.status === 'ready' && snapshot.frameId === 0 && signInSupported;
    const matchingItemIds = current?.status === 'ready' ? current.ids : [];
    return {
      url: pageUrl ?? '',
      matchingItemIds,
      matchState:
        current?.status === 'error'
          ? {
              status: 'error',
              reason: matchErrorOf(current.reason),
              retry: () => setRetry((n) => n + 1),
            }
          : matchesPending
            ? { status: 'loading' }
            : { status: 'ready' },
      ...(snapshot.status === 'ready'
        ? { fillableItemIds: snapshot.itemIds.filter((id) => matchingItemIds.includes(id)) }
        : {}),
      ...(blocked ? { blocked } : {}),
      ...(canSignIn ? { signIn } : {}),
      refresh,
    };
  }, [
    current,
    fillable,
    matchesPending,
    pageUrl,
    reread,
    signIn,
    signInSupported,
    snapshot,
    tab.id,
  ]);

  return { page, fill: page ? fill : undefined };
}
