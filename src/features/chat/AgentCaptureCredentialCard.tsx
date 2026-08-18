/**
 * On-the-fly credential CAPTURE card (D-11).
 *
 * The agent hit a login it has NO stored credential for. Instead of the agent
 * asking the human to type the password where the agent would see it, THIS card
 * shows the user a username/password box (pre-labelled from the agent's field
 * map). The user types.
 *
 * 🚨 THE LEAK BOUNDARY IS THIS COMPONENT. The typed values live ONLY in this
 * component's local state and travel DIRECTLY to the vault via
 * `captureCredential` (POST /api/vault/browser-login/capture). They are never
 * put on a message, a store, chrome.storage, a log, or the response we send back
 * to the service worker — `respondToCapture` carries only the resulting
 * item_id + branch, never a value. On unmount the values are dropped.
 *
 * On submit the card writes the credential and answers the SW with the outcome;
 * the agent then receives its receipt and proceeds. Cancel answers with
 * `cancelled: true` so the agent knows the user declined.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { respondToCapture } from '@/hooks/use-tool-inbox';
import { captureCredential } from '@/lib/api/routes/vault';
import type { CaptureCredentialRequest } from '@/lib/tools/handlers/credential-capture';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export function AgentCaptureCredentialCard({ req }: { req: CaptureCredentialRequest }) {
  // The user-typed values. Local component state ONLY — never persisted, never
  // sent anywhere except straight to the vault write below.
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drop the typed values when the card unmounts (thread switch, submit, cancel).
  useEffect(() => {
    return () => setValues({});
  }, []);

  const setField = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const allFilled = req.fields.every((f) => (values[f.field_key] ?? '').length > 0);

  const onCancel = useCallback(() => {
    setValues({});
    respondToCapture(req.callId, { cancelled: true, reason: 'user_cancelled' });
  }, [req.callId]);

  const onSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Build the write payload. `field_values` is the only place the plaintext
    // lives; it goes card → server and is dropped from state immediately after.
    const fieldValues: Record<string, string> = {};
    for (const f of req.fields) fieldValues[f.field_key] = values[f.field_key] ?? '';
    const result = await captureCredential({
      display_name: req.display_name,
      login_url: req.login_url,
      ...(req.description ? { description: req.description } : {}),
      ...(req.provider_key ? { provider_key: req.provider_key } : {}),
      fields: req.fields.map((f) => ({
        field_key: f.field_key,
        selector: f.selector,
        label: f.label,
        secret: f.secret,
        step: f.step,
      })),
      ...(req.submit_selector ? { submit_selector: req.submit_selector } : {}),
      uri_match_mode: req.uri_match_mode,
      field_values: fieldValues,
    });
    // Drop the plaintext the instant the request returns, success or failure.
    setValues({});
    if (!result.ok) {
      setBusy(false);
      setError('Could not save the credential. Please try again or cancel.');
      return;
    }
    const receipt = result.data;
    if (receipt.status !== 'captured') {
      setBusy(false);
      setError(receipt.detail ?? 'The credential could not be saved.');
      return;
    }
    respondToCapture(req.callId, {
      ok: true,
      credential_item_id: receipt.credential_item_id ?? null,
      branch: receipt.branch ?? null,
      propose_recipe: receipt.propose_recipe,
    });
  }, [busy, req, values]);

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="size-4 text-primary" />
        <span className="font-medium">Save a login for {req.host}</span>
        {req.branch === 'known' ? (
          <Badge variant="secondary" className="ml-auto gap-1">
            <ShieldCheck className="size-3" /> Known site
          </Badge>
        ) : null}
      </div>
      <p className="mb-3 text-muted-foreground">
        The agent needs to sign in to <span className="font-medium">{req.display_name}</span> but
        has no saved credential. Enter it below — it is stored in your vault and{' '}
        <span className="font-medium">the agent never sees it</span>.
      </p>

      <div className="space-y-2">
        {req.fields.map((f) => (
          <label key={f.field_key} className="block">
            <span className="mb-1 block text-xs text-muted-foreground">{f.label}</span>
            <Input
              type={f.secret ? 'password' : 'text'}
              autoComplete={f.secret ? 'new-password' : 'off'}
              value={values[f.field_key] ?? ''}
              disabled={busy}
              onChange={(e) => setField(f.field_key, e.target.value)}
              // 16px+ so iOS does not zoom; also the app-wide rule.
              className="text-base"
            />
          </label>
        ))}
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy || !allFilled}>
          {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
          Save &amp; continue
        </Button>
      </div>
    </div>
  );
}
