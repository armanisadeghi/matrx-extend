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
import { useCallback, useEffect, useRef, useState } from 'react';

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
  removeField: (itemId: string, fieldId: string) => Promise<string | null>;
  removeItem: (itemId: string) => Promise<string | null>;
}

/**
 * Load the actor's own items, the items shared with them, and the safe match
 * candidates for `pageUrl` — all gated behind a real user JWT.
 */
export function useVault(pageUrl: string | null): VaultData {
  const [auth, setAuth] = useState<VaultAuthState>('checking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<VaultItemSummary[]>([]);
  const [shared, setShared] = useState<VaultItemSummary[]>([]);
  const [matches, setMatches] = useState<BrowserLoginMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const generation = useRef(0);
  const matchGeneration = useRef(0);

  const reload = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    setError(null);
    if (!(await hasRealUserToken())) {
      if (run !== generation.current) return;
      setAuth('signed-out');
      setMine([]);
      setShared([]);
      setMatches([]);
      setLoading(false);
      return;
    }
    const [mineResult, sharedResult] = await Promise.all([
      fetchMyVaultItems(),
      fetchVaultItemsSharedWithMe(),
    ]);
    if (run !== generation.current) return;
    setAuth(
      mineResult.ok === false && mineResult.failure.kind === 'sign_in_required'
        ? 'signed-out'
        : 'ready',
    );
    if (mineResult.ok) setMine(mineResult.data);
    if (sharedResult.ok) setShared(sharedResult.data);
    // One list failing must not blank the other — report the first failure and
    // keep whatever did load.
    const failure = !mineResult.ok
      ? mineResult.failure
      : !sharedResult.ok
        ? sharedResult.failure
        : null;
    setError(failure ? describeVaultFailure(failure) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Match candidates re-resolve whenever the tab's URL changes — the whole
  // point of the panel is that it answers for the page you are looking at.
  useEffect(() => {
    const run = ++matchGeneration.current;
    const normalized = normalizeLoginUrl(pageUrl);
    if (auth !== 'ready' || !normalized || !isFillablePageUrl(pageUrl)) {
      setMatches([]);
      setMatchesLoading(false);
      return;
    }
    setMatchesLoading(true);
    void (async () => {
      const result = await fetchBrowserLoginMatches(normalized);
      if (run !== matchGeneration.current) return;
      setMatches(result.ok ? result.data.matches : []);
      setMatchesLoading(false);
    })();
  }, [auth, pageUrl]);

  const patchItem = useCallback(
    async (itemId: string, patch: VaultItemMetadataPatch): Promise<string | null> => {
      const result = await updateVaultItemMetadata(itemId, patch);
      if (!result.ok) return describeVaultFailure(result.failure);
      const updated = result.data;
      const replace = (list: VaultItemSummary[]) =>
        list.map((item) => (item.id === updated.id ? updated : item));
      setMine(replace);
      setShared(replace);
      // Changing login URLs / fill flag changes what matches this page.
      matchGeneration.current++;
      const normalized = normalizeLoginUrl(pageUrl);
      if (normalized && isFillablePageUrl(pageUrl)) {
        const run = matchGeneration.current;
        const fresh = await fetchBrowserLoginMatches(normalized);
        if (run === matchGeneration.current) setMatches(fresh.ok ? fresh.data.matches : []);
      }
      return null;
    },
    [pageUrl],
  );

  const createItem = useCallback(
    async (input: VaultItemCreateInput): Promise<string | null> => {
      const result = await createVaultItem(input);
      if (!result.ok) return describeVaultFailure(result.failure);
      await reload();
      return null;
    },
    [reload],
  );

  /** Swap one item for its freshly-masked server copy in whichever list has it. */
  const refreshItem = useCallback(async (itemId: string): Promise<string | null> => {
    const result = await fetchVaultItem(itemId);
    if (!result.ok) return describeVaultFailure(result.failure);
    const updated = result.data;
    const replace = (list: VaultItemSummary[]) =>
      list.map((item) => (item.id === updated.id ? updated : item));
    setMine(replace);
    setShared(replace);
    return null;
  }, []);

  const changeFieldValue = useCallback(
    async (itemId: string, fieldId: string, value: string): Promise<string | null> => {
      const result = await updateVaultFieldValue(itemId, fieldId, value);
      if (!result.ok) return describeVaultFailure(result.failure);
      return refreshItem(itemId);
    },
    [refreshItem],
  );

  const addField = useCallback(
    async (itemId: string, field: VaultFieldInput): Promise<string | null> => {
      const result = await addVaultField(itemId, field);
      if (!result.ok) return describeVaultFailure(result.failure);
      return refreshItem(itemId);
    },
    [refreshItem],
  );

  const removeField = useCallback(
    async (itemId: string, fieldId: string): Promise<string | null> => {
      const result = await deleteVaultField(itemId, fieldId);
      if (!result.ok) return describeVaultFailure(result.failure);
      return refreshItem(itemId);
    },
    [refreshItem],
  );

  const removeItem = useCallback(async (itemId: string): Promise<string | null> => {
    const result = await deleteVaultItem(itemId);
    if (!result.ok) return describeVaultFailure(result.failure);
    const drop = (list: VaultItemSummary[]) => list.filter((item) => item.id !== itemId);
    setMine(drop);
    setShared(drop);
    setMatches((list) => list.filter((m) => m.item_id !== itemId));
    return null;
  }, []);

  return {
    auth,
    loading,
    error,
    mine,
    shared,
    matches,
    matchesLoading,
    reload,
    patchItem,
    createItem,
    changeFieldValue,
    addField,
    removeField,
    removeItem,
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
export function useCredentialLogin(): {
  /** False on builds where the handler's `supportedBrowsers` excludes us. */
  supported: boolean;
  running: string | null;
  outcome: CredentialLoginOutcome | null;
  useHere: (itemId: string) => Promise<void>;
  dismiss: () => void;
} {
  const [running, setRunning] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CredentialLoginOutcome | null>(null);

  // Calling `run()` directly bypasses the SW dispatcher, which is where the
  // per-browser gate normally lives. Honour the handler's own declaration here
  // so a Firefox/Safari build never offers a fill it cannot perform.
  const supported = isBrowserSupported(credential_login.supportedBrowsers);

  const useHere = useCallback(
    async (itemId: string) => {
      if (!supported) {
        setOutcome({
          status: 'unknown',
          message: 'Browser login is not available in this browser yet.',
        });
        return;
      }
      setRunning(itemId);
      setOutcome(null);
      try {
        const result = await credential_login.run(
          { action: 'auto', credential_item_id: itemId },
          {
            conversationId: null,
            runId: 'vault-panel',
            callId: `vault-panel-${Date.now()}`,
            agentName: null,
            permissionMode: 'act',
            // The user clicked this in the panel while looking at a tab — there
            // is no agent assignment to honour, so the handler resolves the
            // focused tab itself.
            assignedTabId: null,
          },
        );
        const status: CredentialLoginStatus =
          result.status in STATUS_COPY ? (result.status as CredentialLoginStatus) : 'unknown';
        setOutcome({ status, message: STATUS_COPY[status] });
      } catch {
        // Never surface a thrown error: an exception raised inside a fill can
        // carry the value in its message on some engines.
        setOutcome({ status: 'unknown', message: STATUS_COPY.unknown });
      } finally {
        setRunning(null);
      }
    },
    [supported],
  );

  const dismiss = useCallback(() => setOutcome(null), []);

  return { supported, running, outcome, useHere, dismiss };
}
