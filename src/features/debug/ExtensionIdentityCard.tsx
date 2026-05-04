/**
 * Extension identity card for the Debug tab.
 *
 * Shows the auth-critical "who am I" facts: runtime ID, redirect URI sent to
 * Supabase, OAuth client, Supabase URL, and whether the runtime ID matches
 * EXPECTED_EXTENSION_IDS. Surfaces in seconds whether sign-in has any chance
 * of working — without us having to ask the user to dig through DevTools.
 *
 * This card is the on-device companion to the v0.1.4 incident: future ID
 * drift will be visible at a glance, not after a confused user reports
 * "Authorization page could not be loaded" with no other clues.
 */

import { Button } from '@/components/ui/button';
import { isExpectedExtensionId } from '@/config/identity';
import { readExtensionIdentity } from '@/lib/auth/identity';
import { cn } from '@/lib/utils';
import { Check, Copy, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function ExtensionIdentityCard() {
  const identity = useMemo(() => readExtensionIdentity(), []);
  const ok = identity.matches_expected;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const dump = useMemo(() => JSON.stringify(identity, null, 2), [identity]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(dump);
      setCopied(true);
    } catch {
      /* clipboard rejected — silent fall-through */
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        ok
          ? 'border-emerald-300/40 bg-emerald-50/30 dark:border-emerald-700/30 dark:bg-emerald-950/15'
          : 'border-red-300/60 bg-red-50/40 dark:border-red-700/50 dark:bg-red-950/20',
      )}
    >
      <div className="flex items-start gap-2">
        {ok ? (
          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[11px] font-medium uppercase tracking-wider',
              ok
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-700 dark:text-red-400',
            )}
          >
            Extension identity {ok ? 'ok' : 'DRIFT'}
          </div>
          {!ok && (
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Runtime ID is not on the EXPECTED_EXTENSION_IDS list. Sign-in
              will fail unless{' '}
              <code className="rounded bg-secondary px-1 py-px text-[10px]">
                https://{identity.runtime_id}.chromiumapp.org/
              </code>{' '}
              is registered in Supabase's redirect-URI allowlist.
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 shrink-0 gap-1 text-[10px]"
          title="Copy diagnostics as JSON"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px]">
        <Field label="runtime id" value={identity.runtime_id} mono highlight={!ok} />
        <Field label="redirect uri" value={identity.redirect_uri} mono highlight={!ok} />
        <Field label="version" value={identity.extension_version} mono />
        <Field label="oauth client" value={identity.oauth_client_id} mono />
        <Field label="supabase" value={identity.supabase_url} mono />
        <Field
          label="expected ids"
          value={identity.expected_ids.join(', ') || '(none)'}
          mono
        />
      </dl>

      <div className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Hotfix when DRIFT: in the Matrx Supabase project → Authentication →
        URL Configuration, add the redirect URI above to the allowlist. Save.
        Sign-in works within seconds. To prevent recurrence, add the runtime
        id to{' '}
        <code className="rounded bg-secondary px-1 py-px">EXPECTED_EXTENSION_IDS</code>
        {' '}in <code className="rounded bg-secondary px-1 py-px">src/config/identity.ts</code>
        {' '}so the warning clears.
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  // Mark drift-relevant rows so the eye lands on them.
  const checkDrift =
    highlight && (label === 'runtime id' || label === 'redirect uri');
  return (
    <>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'truncate',
          mono && 'font-mono text-[10.5px]',
          checkDrift && 'text-red-700 dark:text-red-400',
        )}
        title={value}
      >
        {value}
      </dd>
    </>
  );
}
