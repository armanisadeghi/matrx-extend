/**
 * Vault — the extension's password-manager tab.
 *
 * Every screen is the shared `@ai-matrx/vault` workspace (`VaultApp`), the same
 * one the web app and the desktop app render, over the ONE vault client
 * (`createApiVaultPort` on this extension's own `Api`). This file only supplies
 * what only the extension can do — the tab beside the panel, Fill, "Sign in
 * for me", the save-this-login prompt, this browser's fill key and the page's
 * new-password boxes (`useVaultPage.ts`, `extension-vault-host.ts`) — and opens
 * on the page view when a tab is there.
 *
 * Confirming it's you for a secret (`identity`) happens inside the shared
 * password/email-code dialog over an isolated proof client. The host exchanges
 * that proof for a session-bound grant without replacing extension OAuth.
 * Not offered here: approving a browser with a passkey from the vault
 * (`passkeys`) — it needs an aimatrx.com page, so the package hides it.
 */

import { ENV } from '@/config/env';
import { useActiveOrganization } from '@/hooks/use-active-organization';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useAuth } from '@/hooks/use-auth';
import { getSupabase } from '@/lib/supabase/client';
import { platformDb } from '@/lib/supabase/schemas';
import { Button } from '@ai-matrx/design-system/controls';
import { openOutbound } from '@ai-matrx/kit/outbound';
import {
  DEFAULT_LOCATION,
  VaultApp,
  type VaultHostCapabilities,
  type VaultLocation,
  type VaultUserStateDoor,
  createApiVaultPort,
  createVaultKnobs,
  useDisposable,
} from '@ai-matrx/vault';
import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createCaptureHost,
  createFillSetupHost,
  createNewPasswordFieldsHost,
} from './extension-vault-host';
import { usePanelAdmission } from './usePanelAdmission';
import { useVaultPage } from './useVaultPage';
import type { ConfirmationParent } from './vault-confirmation';
import {
  createVaultConfirmationHost,
  listenForVaultAuthSessionChanges,
  readVaultParentMetadata,
} from './vault-confirmation-host';

const openUrl = (url: string) => void openOutbound(url, '_blank', 'noopener');
/** The vault menu's "Open on the web": the full workspace on the website. */
const openWebVault = () => openUrl(`${ENV.FRONTEND_URL}/vault`);

export function VaultView() {
  const { user } = useAuth();
  const organization = useActiveOrganization();
  const [revision, setRevision] = useState(0);
  const [parentState, setParentState] = useState<
    | { kind: 'loading' }
    | { kind: 'signed-out' }
    | { kind: 'ready'; parent: ConfirmationParent }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  // Token replacement, sign-out and refresh all change this one canonical storage row.
  // Same-session refresh rereads metadata but retains the existing workspace object.
  useEffect(() => {
    return listenForVaultAuthSessionChanges(() => setRevision((value) => value + 1));
  }, []);

  useEffect(() => {
    // These external signals deliberately rerun the verified metadata read.
    void organization.active?.id;
    void revision;
    void user?.id;
    let live = true;
    void readVaultParentMetadata().then(
      (parent) => {
        if (!live) return;
        if (!parent) {
          setParentState({ kind: 'signed-out' });
          return;
        }
        setParentState((current) =>
          current.kind === 'ready' &&
          current.parent.userId === parent.userId &&
          current.parent.sessionId === parent.sessionId &&
          current.parent.organizationId === parent.organizationId
            ? current
            : { kind: 'ready', parent },
        );
      },
      (error: unknown) => {
        if (!live) return;
        setParentState({
          kind: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The Vault session could not be checked. Try again.',
        });
      },
    );
    return () => {
      live = false;
    };
  }, [organization.active?.id, revision, user?.id]);

  if (parentState.kind === 'loading')
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  if (parentState.kind === 'signed-out') return <SignInPrompt />;
  if (parentState.kind === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-foreground">{parentState.message}</p>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  const actor = parentState.parent;
  // Account, OAuth session or organization changes get a fresh workspace. A bearer refresh in
  // the same verified session retains this exact actor object and its controller/cache hydration.
  return (
    <VaultWorkspace
      key={`${actor.userId}:${actor.sessionId}:${actor.organizationId}`}
      actor={actor}
    />
  );
}

/**
 * The generator's "Fill page" host, made and disposed in the same effect:
 * StrictMode's mount → cleanup → mount (and a tab change) leaves a live port,
 * never the disposed first one. null until the first effect.
 */
export function useNewPasswordFieldsHost(
  tabId: number | null,
  admission: Parameters<typeof createNewPasswordFieldsHost>[1],
) {
  return useDisposable(() => createNewPasswordFieldsHost(tabId, admission), [tabId, admission]);
}

/** One confirmation controller/API pair per verified actor/session/organization workspace. */
export function useVaultConfirmationHost(actor: ConfirmationParent) {
  return useDisposable(() => createVaultConfirmationHost(actor), [actor]);
}

function VaultWorkspace({ actor }: { actor: ConfirmationParent }) {
  const tab = useActiveTab();
  const { admission } = usePanelAdmission(tab.id, tab.url, actor);
  const { page, fill } = useVaultPage(tab, actor, admission);

  const confirmation = useVaultConfirmationHost(actor);
  const port = useMemo(() => {
    if (!confirmation) return null;
    const supabase = getSupabase();
    // The full generic query builders exceed TypeScript's comparison depth
    // against VaultUserStateDoor. Pass both existing clients through intact:
    // userState provides rpc and schema(...).from(...).select(...).in(...),
    // while the platform-scoped client supplies the door's rpc.
    const userState = supabase as unknown as VaultUserStateDoor;
    const platformDoor = platformDb() as unknown as VaultUserStateDoor;
    return createApiVaultPort(confirmation.api, {
      userState,
      platformDoor,
    });
  }, [confirmation]);
  const knobs = useMemo(() => createVaultKnobs(getSupabase(), actor), [actor]);
  const fillSetup = useMemo(() => createFillSetupHost(openUrl), []);
  const capture = useMemo(() => createCaptureHost(tab.id), [tab.id]);
  const newPasswordFields = useNewPasswordFieldsHost(tab.id, admission);

  const host = useMemo<VaultHostCapabilities | null>(() => {
    if (!confirmation) return null;
    return {
      knobs,
      openUrl,
      openWebVault,
      identity: confirmation.identity,
      fillSetup,
      capture,
      ...(newPasswordFields ? { newPasswordFields } : {}),
      ...(page ? { page } : {}),
      ...(fill ? { fill } : {}),
    };
  }, [capture, confirmation, fill, fillSetup, knobs, newPasswordFields, page]);

  // The side panel opens on the page beside it; everywhere else the workspace starts at All items.
  // The active tab resolves after mount, so the page view is taken once it exists, unless the
  // person has already moved somewhere.
  const [location, setLocation] = useState<VaultLocation>(DEFAULT_LOCATION);
  const [moved, setMoved] = useState(false);
  const hasPage = page !== undefined;
  useEffect(() => {
    if (hasPage && !moved) setLocation((l) => (l.view === 'page' ? l : { ...l, view: 'page' }));
  }, [hasPage, moved]);

  if (!confirmation || !port || !host) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <VaultApp
      port={port}
      host={host}
      location={location}
      onLocationChange={(next, how) => {
        if (how === 'push') setMoved(true);
        setLocation(next);
      }}
    />
  );
}

/**
 * The extension's guest identity is a fingerprint, and the Vault rejects it by
 * design. Say that plainly instead of showing an empty list.
 */
function SignInPrompt() {
  const { signIn, status } = useAuth();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldCheck className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Sign in to open your Vault</p>
      <p className="text-xs text-muted-foreground">Guest sessions cannot reach saved logins.</p>
      <Button
        variant="primary"
        onClick={() => void signIn()}
        disabled={status === 'signing-in'}
        icon={status === 'signing-in' ? <Loader2 className="animate-spin" /> : <LogIn />}
      >
        Sign in
      </Button>
    </div>
  );
}
