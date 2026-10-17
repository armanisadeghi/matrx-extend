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
 * Confirming it's you for a secret (`identity`) re-runs this extension's own
 * Matrx sign-in and waits for the fresh bearer (`extension-vault-identity.ts`).
 * Not offered here: approving a browser with a passkey from the vault
 * (`passkeys`) — it needs an aimatrx.com page, so the package hides it.
 */

import { useActiveOrganization } from '@/hooks/use-active-organization';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useAuth } from '@/hooks/use-auth';
import { getMatrxApi } from '@/lib/api/matrx-api';
import { hasRealUserToken } from '@/lib/api/routes/vault';
import { getSupabase } from '@/lib/supabase/client';
import { platformDb } from '@/lib/supabase/schemas';
import { Button } from '@ai-matrx/design-system/controls';
import { openOutbound } from '@ai-matrx/kit/outbound';
import {
  DEFAULT_LOCATION,
  VaultApp,
  type VaultHostCapabilities,
  type VaultLocation,
  createApiVaultPort,
  createVaultKnobs,
} from '@ai-matrx/vault';
import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createCaptureHost,
  createFillSetupHost,
  createNewPasswordFieldsHost,
} from './extension-vault-host';
import { extensionVaultIdentity } from './extension-vault-identity';
import { usePanelAdmission } from './usePanelAdmission';
import { useVaultPage } from './useVaultPage';

type Actor = { userId: string; organizationId: string };

const openUrl = (url: string) => void openOutbound(url, '_blank', 'noopener');

export function VaultView() {
  const { user } = useAuth();
  const organization = useActiveOrganization();
  const actor = useMemo<Actor | null>(
    () =>
      user && organization.active
        ? { userId: user.id, organizationId: organization.active.id }
        : null,
    [organization.active, user],
  );
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    setSignedIn(null);
    void hasRealUserToken().then((ok) => {
      if (live) setSignedIn(ok);
    });
    return () => {
      live = false;
    };
  }, [user?.id]);

  if (signedIn === null || (signedIn && !actor))
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  if (!signedIn || !actor) return <SignInPrompt />;
  // A different account or organization is a fresh workspace: nothing of the last one carries over.
  return <VaultWorkspace key={`${actor.userId}:${actor.organizationId}`} actor={actor} />;
}

function VaultWorkspace({ actor }: { actor: Actor }) {
  const tab = useActiveTab();
  const { admission } = usePanelAdmission(tab.id, tab.url, actor);
  const { page, fill } = useVaultPage(tab, actor, admission);

  const port = useMemo(() => {
    const supabase = getSupabase();
    return createApiVaultPort(getMatrxApi(), { userState: supabase, platformDoor: platformDb() });
  }, []);
  const knobs = useMemo(() => createVaultKnobs(getSupabase(), actor), [actor]);
  const fillSetup = useMemo(() => createFillSetupHost(openUrl), []);
  const capture = useMemo(() => createCaptureHost(tab.id), [tab.id]);
  const newPasswordFields = useMemo(
    () => createNewPasswordFieldsHost(tab.id, admission),
    [tab.id, admission],
  );
  useEffect(() => () => newPasswordFields.dispose(), [newPasswordFields]);

  const host = useMemo<VaultHostCapabilities>(
    () => ({
      knobs,
      openUrl,
      identity: extensionVaultIdentity,
      fillSetup,
      capture,
      newPasswordFields,
      ...(page ? { page } : {}),
      ...(fill ? { fill } : {}),
    }),
    [capture, fill, fillSetup, knobs, newPasswordFields, page],
  );

  // The side panel opens on the page beside it; everywhere else the workspace starts at All items.
  // The active tab resolves after mount, so the page view is taken once it exists, unless the
  // person has already moved somewhere.
  const [location, setLocation] = useState<VaultLocation>(DEFAULT_LOCATION);
  const [moved, setMoved] = useState(false);
  const hasPage = page !== undefined;
  useEffect(() => {
    if (hasPage && !moved) setLocation((l) => (l.view === 'page' ? l : { ...l, view: 'page' }));
  }, [hasPage, moved]);

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
