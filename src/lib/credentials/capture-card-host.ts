/**
 * The extension's host ports for the package's credential capture card
 * (`@ai-matrx/chat/agents/ui-first-tools/ui/CredentialCaptureCard`, D-11).
 *
 * The card owns the leak boundary and the deadline; this file owns transport:
 * `save` writes the typed values straight to the vault and answers the service
 * worker with a value-free receipt; `dismiss` answers cancelled/expired.
 */

import { respondToCapture } from '@/hooks/use-tool-inbox';
import { captureCredential } from '@/lib/api/routes/vault';
import type { CaptureCredentialRequest } from '@/lib/tools/handlers/credential-capture';
import type {
  CredentialCaptureDismissReason,
  CredentialCaptureSaveResult,
  CredentialCaptureSpec,
} from '@ai-matrx/chat/agents/ui-first-tools/ui/CredentialCaptureCard';

export function captureSpec(req: CaptureCredentialRequest): CredentialCaptureSpec {
  return {
    id: req.callId,
    host: req.host,
    displayName: req.display_name,
    branch: req.branch,
    expiresAtMs: req.expires_at_ms,
    fields: req.fields.map((f) => ({ fieldKey: f.field_key, label: f.label, secret: f.secret })),
  };
}

export async function saveCapture(
  req: CaptureCredentialRequest,
  values: Record<string, string>,
): Promise<CredentialCaptureSaveResult> {
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
    field_values: values,
  });
  if (!result.ok) return { ok: false, message: 'Could not save the credential. Please try again or cancel.' };
  const receipt = result.data;
  if (receipt.status !== 'captured') {
    return { ok: false, message: receipt.detail ?? 'The credential could not be saved.' };
  }
  // The write committed: this response owns the outcome (idempotent if the tool already timed out).
  respondToCapture(req.callId, {
    ok: true,
    credential_item_id: receipt.credential_item_id ?? null,
    branch: receipt.branch ?? null,
    propose_recipe: receipt.propose_recipe,
  });
  return { ok: true };
}

export function dismissCapture(req: CaptureCredentialRequest, reason: CredentialCaptureDismissReason): void {
  respondToCapture(req.callId, {
    cancelled: true,
    reason: reason === 'expired' ? 'expired' : 'user_cancelled',
  });
}
