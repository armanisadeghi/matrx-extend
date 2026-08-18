/**
 * Google Workspace routes — the ONE server contract this extension has with
 * Gmail, and it has exactly one entry:
 *
 *   POST /api/google-workspace/gmail/send-reviewed
 *
 * 🚨 **This is the Gmail authorization boundary.** The `google_email_send` tool
 * has NO server executor by design: the only way a message can leave the user's
 * mailbox is a human pressing Send on `<GmailReviewCard>` with the exact bytes
 * they can see. That means:
 *
 *   - `user_confirmed: true` is a CONSTANT written here, at the single call site
 *     reached only from that button. It is not a tool argument, is not derived
 *     from anything the model said, and must never become either — the agent has
 *     no vocabulary for consent, and adding one would let it assert its own.
 *   - Nothing in this module sends on a schedule, a retry, or a queue. One click,
 *     one request, one message.
 *
 * Rules, matching `vault.ts` / `prospects.ts`:
 *
 * 1. **A real user JWT or nothing.** `client.ts#buildHeaders` falls back to a
 *    guest fingerprint identity when no session exists; aidream requires a real
 *    `ctx.user_id` here (401 otherwise), so this short-circuits on
 *    `getAccessToken()` and reports `sign_in_required` rather than letting the
 *    request go out and come back opaque.
 * 2. **No second HTTP client** — everything goes through `apiPost`, so bearer
 *    injection, 401-refresh-retry, timeouts and the `ApiResult` envelope stay in
 *    one place.
 * 3. **The wire shape is declared here**, same convention as every other route
 *    module in this folder. It mirrors aidream's `ReviewedGmailRequest` /
 *    `ReviewedGmailResponse` (aidream/api/routers/google_workspace.py).
 */

import { type ApiResult, apiPost } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';

/** Exactly what the user approved on screen — never the agent's arguments. */
export interface ReviewedGmailDraft {
  connectionId: string;
  to: string;
  cc: string[];
  subject: string;
  body: string;
}

export interface ReviewedGmailResponse {
  message_id: string;
}

const SIGN_IN_REQUIRED: ApiResult<never> = {
  ok: false,
  status: 401,
  error: 'sign_in_required',
};

/**
 * Send the reviewed message. Called from ONE place: the Send button on
 * `<GmailReviewCard>`. Never from a tool handler, never from a retry loop.
 */
export async function sendReviewedGmail(
  draft: ReviewedGmailDraft,
): Promise<ApiResult<ReviewedGmailResponse>> {
  if ((await getAccessToken()) === null) return SIGN_IN_REQUIRED;
  return apiPost<ReviewedGmailResponse>('/api/google-workspace/gmail/send-reviewed', {
    connection_id: draft.connectionId,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    body: draft.body,
    // The human pressed Send. See the module header before touching this line.
    user_confirmed: true,
  });
}
