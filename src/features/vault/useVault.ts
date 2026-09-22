/**
 * Vault side-panel data layer.
 *
 * Everything the panel knows lives here, in React state, for the lifetime of
 * the panel. NOTHING is persisted — no chrome.storage, no localStorage, no
 * zustand store, not even the masked metadata. The Vault is server-of-record;
 * a stale local copy of "which logins exist" is a privacy surface with no
 * upside.
 *
 * The only plaintext in the whole feature is a revealed field, and that is
 * held by `useTransientSecret` in the component that shows it — never here.
 */

import {
  type BrowserLoginMatch,
  type VaultFieldInput,
  type VaultItemCreateInput,
  type VaultItemMetadataPatch,
  type VaultItemSummary,
  addVaultField,
  createVaultItem,
  deleteVaultField,
  deleteVaultItem,
  describeVaultFailure,
  fetchBrowserLoginMatches,
  fetchMyVaultItems,
  fetchVaultItem,
  fetchVaultItemsSharedWithMe,
  hasRealUserToken,
  updateVaultFieldValue,
  updateVaultItemMetadata,
} from '@/lib/api/routes/vault';
import { isBrowserSupported } from '@/lib/browser/detect';
import { isFillablePageUrl, normalizeLoginUrl } from '@/lib/credentials/login-urls';
import { credential_login } from '@/lib/tools/handlers/credential-login';
import type { CredentialLoginStatus } from '@/lib/tools/handlers/credential-login';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { PanelActionAdmission } from './usePanelAdmission';

export type VaultAuthState = 'checking' | 'signed-out' | 'ready';

export interface VaultData {
  auth: VaultAuthState;
  loading: boolean;
  error: string | null;
  mine: VaultItemSummary[];
  shared: VaultItemSummary[];
  /** Server-approved candidates for the CURRENT tab. Ids + titles only. */
  matches: BrowserLoginMatch[];
  matchesLoading: boolean;
  reload: () => Promise<void>;
  patchItem: (itemId: string, patch: VaultItemMetadataPatch) => Promise<string | null>;
  createItem: (input: VaultItemCreateInput) => Promise<string | null>;
  /**
   * Value-bearing edits. `value` is plaintext travelling OUT once from the
   * calling component's local state — this hook never keeps it, and after the
   * write it refetches the item so the list only ever holds the server mask.
   */
  changeFieldValue: (itemId: string, fieldId: string, value: string) => Promise<string | null>;
  addField: (itemId: string, field: VaultFieldInput) => Promise<string | null>;
  removeVaultField: (itemId: string, fieldId: string) => Promise<string | null>;
  removeVaultItem: (itemId: string) => Promise<string | null>;
}

/**
 * Load the actor's own items, the items shared with them, and the safe match
 * candidates for `pageUrl` — all gated behind a real user JWT.
 */
export function useVault(
  pageUrl: string | null,
  tabId: number | null,
  actor: { userId: string; organizationId: string } | null,
  admission: PanelActionAdmission,
): VaultData {
  const [auth, setAuth] = useState<VaultAuthState>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<VaultItemSummary[]>([]);
  const [shared, setShared] = useState<VaultItemSummary[]>([]);
  const [matches, setMatches] = useState<BrowserLoginMatch[]>([]);
  const [matchesOwner, setMatchesOwner] = useState('');
  const [matchesLoading, setMatchesLoading] = useState(false);
  const generation = useRef(0);
  const matchGeneration = useRef(0);
  const matchOwner = `${tabId ?? 'none'}:${normalizeLoginUrl(pageUrl) ?? 'none'}:${actor?.userId ?? 'none'}:${actor?.organizationId ?? 'none'}`;

  const reload = useCallback(async () => {
    if (!admission.current()) return;
    const run = ++generation.current;
    setLoading(true);
    setError(null);
    if (!(await hasRealUserToken())) {
      if (run !== generation.current || !admission.current()) return;
      setAuth('signed-out');
      setMine([]);
      setShared([]);
      setMatches([]);
      setMatchesOwner('');
      setLoading(false);
      return;
    }
    if (!admission.current()) return;
    const [mineResult, sharedResult] = await Promise.all([
      fetchMyVaultItems(),
      fetchVaultItemsSharedWithMe(),
    ]);
    if (run !== generation.current || !admission.current()) return;
    setAuth(
      mineResult.ok === false && mineResult.failure.kind === 'sign_in_required'
        ? 'signed-out'
        : 'ready',
    );
    if (mineResult.ok) setMine(mineResult.data);
    // A revoked session or access grant must never leave masked Vault metadata
    // visible while the panel explains that the current actor cannot read it.
    // A later successful reload repopulates only the server-authoritative list.
    else setMine([]);
    if (sharedResult.ok) setShared(sharedResult.data);
    else setShared([]);
    // One list failing must not blank the other — report the first failure and
    // keep whatever did load.
    const failure = !mineResult.ok
      ? mineResult.failure
      : !sharedResult.ok
        ? sharedResult.failure
        : null;
    setError(failure ? describeVaultFailure(failure) : null);
    setLoading(false);
  }, [admission]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);

  // Match candidates re-resolve whenever the tab's URL changes — the whole
  // point of the panel is that it answers for the page you are looking at.
  useEffect(() => {
    const run = ++matchGeneration.current;
    const normalized = normalizeLoginUrl(pageUrl);
    if (
      !admission.current() ||
      auth !== 'ready' ||
      !actor ||
      tabId == null ||
      !normalized ||
      !isFillablePageUrl(pageUrl)
    ) {
      setMatches([]);
      setMatchesOwner('');
      setMatchesLoading(false);
      return;
    }
    setMatchesLoading(true);
    void (async () => {
      if (!admission.current()) return;
      const result = await fetchBrowserLoginMatches(normalized, undefined, {
        expectedActor: actor,
      });
      if (run !== matchGeneration.current || !admission.current()) return;
      setMatches(result.ok ? result.data.matches : []);
      setMatchesOwner(matchOwner);
      setMatchesLoading(false);
    })();
    return () => {
      matchGeneration.current++;
    };
  }, [admission, actor, auth, matchOwner, pageUrl, tabId]);

  const patchItem = useCallback(
    async (itemId: string, patch: VaultItemMetadataPatch): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await updateVaultItemMetadata(itemId, patch);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      const updated = result.data;
      const replace = (list: VaultItemSummary[]) =>
        list.map((item) => (item.id === updated.id ? updated : item));
      setMine(replace);
      setShared(replace);
      // Changing login URLs / fill flag changes what matches this page.
      matchGeneration.current++;
      const normalized = normalizeLoginUrl(pageUrl);
      if (actor && normalized && isFillablePageUrl(pageUrl)) {
        const run = matchGeneration.current;
        const fresh = await fetchBrowserLoginMatches(normalized, undefined, {
          expectedActor: actor,
        });
        if (run === matchGeneration.current && admission.current()) {
          setMatches(fresh.ok ? fresh.data.matches : []);
          setMatchesOwner(matchOwner);
        }
      }
      return null;
    },
    [admission, actor, matchOwner, pageUrl],
  );

  const createItem = useCallback(
    async (input: VaultItemCreateInput): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await createVaultItem(input);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      await reload();
      return null;
    },
    [admission, reload],
  );

  /** Swap one item for its freshly-masked server copy in whichever list has it. */
  const refreshItem = useCallback(
    async (itemId: string): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await fetchVaultItem(itemId);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      const updated = result.data;
      const replace = (list: VaultItemSummary[]) =>
        list.map((item) => (item.id === updated.id ? updated : item));
      setMine(replace);
      setShared(replace);
      return null;
    },
    [admission],
  );

  const changeFieldValue = useCallback(
    async (itemId: string, fieldId: string, value: string): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await updateVaultFieldValue(itemId, fieldId, value);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      return refreshItem(itemId);
    },
    [admission, refreshItem],
  );

  const addField = useCallback(
    async (itemId: string, field: VaultFieldInput): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await addVaultField(itemId, field);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      return refreshItem(itemId);
    },
    [admission, refreshItem],
  );

  const removeVaultField = useCallback(
    async (itemId: string, fieldId: string): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await deleteVaultField(itemId, fieldId);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      return refreshItem(itemId);
    },
    [admission, refreshItem],
  );

  const removeVaultItem = useCallback(
    async (itemId: string): Promise<string | null> => {
      if (!admission.current()) return null;
      const result = await deleteVaultItem(itemId);
      if (!admission.current()) return null;
      if (!result.ok) return describeVaultFailure(result.failure);
      const drop = (list: VaultItemSummary[]) => list.filter((item) => item.id !== itemId);
      setMine(drop);
      setShared(drop);
      setMatches((list) => list.filter((m) => m.item_id !== itemId));
      return null;
    },
    [admission],
  );

  return {
    auth,
    loading,
    error,
    mine,
    shared,
    matches: matchesOwner === matchOwner ? matches : [],
    matchesLoading,
    reload,
    patchItem,
    createItem,
    changeFieldValue,
    addField,
    removeVaultField,
    removeVaultItem,
  };
}

export interface CredentialLoginOutcome {
  status: CredentialLoginStatus;
  message: string;
}

/**
 * Static, human-facing copy for every terminal status. Never derived from page
 * content or server text — both can echo a credential back.
 */
const STATUS_COPY: Record<CredentialLoginStatus, string> = {
  inventory_ready: 'Saved logins listed.',
  discovery_ready: 'Saved login fields are ready.',
  captured: 'Login saved to your Vault.',
  cancelled: 'Capture cancelled — nothing was saved.',
  recipe_proposed: 'Login recipe proposed for review.',
  no_active_tab: 'No page is assigned to capture from.',
  sign_in_required: 'Sign in to Matrx first.',
  vault_error: 'The Vault could not complete that.',
  report_received: 'Report received.',
  spec_incomplete: 'The login plan was incomplete, so nothing was entered.',
  authenticated: 'Signed in.',
  needs_mfa: 'Signed in — finish the verification step on the page.',
  captcha_or_takeover: 'The site is showing a challenge. Finish it yourself, then try again.',
  credentials_rejected: 'The site rejected that login.',
  selection_required: 'Several logins match this page. Pick one below.',
  no_matching_login: 'No saved login is enabled for browser fill on this page.',
  unsafe_destination: 'This page cannot be filled — browser login requires https.',
  unknown: 'The login could not be confirmed. Check the page.',
};

/**
 * Run the SAME `credential_login` handler the agent runs, for one item, on the
 * focused tab.
 *
 * The panel deliberately does not re-implement resolve → materialize → fill:
 * one code path means the human button and the agent obey identical origin
 * checks, identical top-frame-only filling, identical auditing, and identical
 * "the plaintext never leaves the handler's local scope" guarantee.
 */
export function useCredentialLogin(admission: PanelActionAdmission): {
  /** False on builds where the handler's `supportedBrowsers` excludes us. */
  supported: boolean;
  running: string | null;
  outcome: CredentialLoginOutcome | null;
  useHere: (itemId: string, assignedTabId: number | null) => Promise<void>;
  dismiss: () => void;
} {
  const [running, setRunning] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CredentialLoginOutcome | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Calling `run()` directly bypasses the SW dispatcher, which is where the
  // per-browser gate normally lives. Honour the handler's own declaration here
  // so a Firefox/Safari build never offers a fill it cannot perform.
  const supported = isBrowserSupported(credential_login.supportedBrowsers);

  const useHere = useCallback(
    async (itemId: string, assignedTabId: number | null) => {
      if (assignedTabId == null) {
        setOutcome({ status: 'no_active_tab', message: STATUS_COPY.no_active_tab });
        return;
      }
      if (!supported) {
        setOutcome({
          status: 'unknown',
          message: 'Browser login is not available in this browser yet.',
        });
        return;
      }
      if (!mounted.current || !admission.current()) return;
      await admission.run(async () => {
        setRunning(itemId);
        setOutcome(null);
        try {
          if (!admission.current()) return;
          const result = await credential_login.run(
            { action: 'auto', credential_item_id: itemId },
            {
              conversationId: null,
              runId: 'vault-panel',
              callId: `vault-panel-${Date.now()}`,
              agentName: null,
              permissionMode: 'act',
              assignedTabId,
            },
          );
          if (!mounted.current || !admission.current()) return;
          const status: CredentialLoginStatus =
            result.status in STATUS_COPY ? (result.status as CredentialLoginStatus) : 'unknown';
          setOutcome({ status, message: STATUS_COPY[status] });
        } catch {
          // Never surface a thrown error: an exception raised inside a fill can
          // carry the value in its message on some engines.
          if (mounted.current && admission.current())
            setOutcome({ status: 'unknown', message: STATUS_COPY.unknown });
        } finally {
          if (mounted.current && admission.current()) setRunning(null);
        }
      });
    },
    [admission, supported],
  );

  const dismiss = useCallback(() => setOutcome(null), []);

  return { supported, running, outcome, useHere, dismiss };
}
