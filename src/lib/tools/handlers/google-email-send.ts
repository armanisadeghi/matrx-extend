/**
 * `google_email_send` — the Gmail boundary, browser half.
 *
 * The agent composes a message; this handler renders it to the USER and waits.
 * It sends nothing itself. `<GmailReviewCard>` shows the sender, recipient, CC,
 * subject and body — every one of them editable — and only its Send button calls
 * the reviewed-send endpoint, with the bytes that were on screen at that moment.
 *
 * Why this lives on the client at all: the tool has NO server executor. Its only
 * bindings are to CLIENT runtimes (`matrx-user` for the web app, `chrome-extension`
 * for this one), so there is no server path an agent could take to send mail, and
 * no argument it can set that stands in for the user's consent. That absence IS
 * the authorization boundary — never add a server binding, and never add a
 * `user_confirmed`-style argument here.
 *
 * Outcomes, all of them honest:
 *   - user pressed Send, server accepted     → `{sent: true, message_id, edited}`
 *   - user pressed "Don't send"              → `{sent: false, declined: true}`  (normal, not an error)
 *   - user dismissed the card / it timed out → `{sent: false, cancelled: true}`
 *   - the send failed                        → `{sent: false, error}` and the card
 *     STAYS OPEN saying nothing was sent. A failure is never reported as success.
 *
 * Behavioural parity with matrx-frontend's
 * `features/agents/ui-first-tools/handlers/google-email-send.handler.ts` — same
 * tool name, same result shape, same refusals. Two surfaces, one contract.
 */

import { resolveGmailSendConnection } from '@/lib/google/connection';
import { awaitUserResponse } from '@/lib/tools/handlers/user';
import type { PendingAskUserRequest, ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

/**
 * Mirrors `tool.definition.parameters` exactly (drift-checked). There is
 * deliberately no confirmation flag, no "send anyway", and no scheduling.
 */
const GoogleEmailSendArgs = z.object({
  to: z.string().min(3).max(320),
  cc: z.array(z.string()).max(20).optional(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(100_000),
});
type GoogleEmailSendArgs = z.infer<typeof GoogleEmailSendArgs>;

export interface GoogleEmailSendResult {
  sent: boolean;
  declined?: boolean;
  cancelled?: boolean;
  message_id?: string;
  to?: string;
  cc?: string[];
  subject?: string;
  /** True when the user changed any field before sending. */
  edited?: boolean;
  from_email?: string | null;
  error?: string;
}

/**
 * How long the card waits before the run gives up. Reviewing an email is a
 * considered act — this is generous on purpose, and expiring is reported as
 * `cancelled`, never as a send.
 */
const REVIEW_TIMEOUT_MS = 15 * 60_000;

export const google_email_send: ToolHandler<GoogleEmailSendArgs, GoogleEmailSendResult> = {
  name: 'google_email_send',
  // ask-user: the dispatcher runs us directly and we raise our own card. An
  // action-tier approval on top would be a SECOND, contentless consent prompt —
  // the review card is the consent, and two prompts teach click-through.
  tier: 'ask-user',
  argsSchema: GoogleEmailSendArgs,
  run: async (args, ctx) => {
    const mailbox = await resolveGmailSendConnection();
    if (!mailbox) {
      // A refusal the user can act on — never a silent failure, and never a send.
      return {
        sent: false,
        error:
          'No Google account with sending access is connected. Connect one in AI Matrx at ' +
          'Settings → Integrations → Google Workspace, then ask again.',
      };
    }

    const cc = (args.cc ?? []).map((entry) => entry.trim()).filter(Boolean);
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      kind: 'email_review',
      context: 'Agent wrote an email — nothing sends until you press Send',
      email: {
        connectionId: mailbox.connectionId,
        fromEmail: mailbox.accountEmail,
        to: args.to.trim(),
        cc,
        subject: args.subject,
        body: args.body,
      },
      expires_at_ms: Date.now() + REVIEW_TIMEOUT_MS,
    };

    // Same broadcast-and-wait every ask-user card uses — one channel, one
    // awaiter, so cancel/expiry/conversation routing behave identically here.
    const response = await awaitUserResponse(request, REVIEW_TIMEOUT_MS);
    // Expiry and dismissal are the same thing to the model: no message left.
    if (response === 'timed_out' || response.cancelled) {
      return { sent: false, cancelled: true };
    }
    if (!response.confirmed) {
      return { sent: false, declined: true };
    }

    // Everything below comes from the card AFTER a successful send — it reports
    // what actually left, which is why `to` / `cc` / `subject` are echoed from
    // the card's fields and not from `args`.
    const receipt = response.sent_email;
    if (!receipt) {
      // `confirmed` without a receipt can only mean the send didn't complete.
      // Reporting a send we cannot evidence is the one lie this tool must never
      // tell, so it comes back as a failure.
      return { sent: false, error: 'The send did not complete. Nothing was sent.' };
    }
    return {
      sent: true,
      message_id: receipt.message_id,
      to: receipt.to,
      cc: receipt.cc,
      subject: receipt.subject,
      edited: receipt.edited,
      from_email: mailbox.accountEmail,
    };
  },
};

export const google_handlers = [google_email_send];
