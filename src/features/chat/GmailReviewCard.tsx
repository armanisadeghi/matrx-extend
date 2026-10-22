/**
 * MOVED to @ai-matrx/chat — the Gmail review card body (fields, Send / Don't send / Dismiss,
 * failure handling, 401 text, manage-account link) now lives in
 * `@ai-matrx/chat/agents/ui-first-tools/ui/GmailReviewCardView`. This file is only the door:
 * it maps the extension's pending ask (`PendingAskUserRequest`, kind `email_review`) onto the
 * package card and maps the package resolution back to EXACTLY the payload the extension's
 * `google_email_send` handler reads:
 *
 *   send     -> { confirmed: true, sent_email: { message_id, to, cc, subject, edited } }
 *   decline  -> { confirmed: false }
 *   dismiss  -> { cancelled: true }
 *
 * THE CARD IS THE AUTHORIZATION: `sendReviewedGmail` is reached only through the package card's
 * Send button. Nothing here sends, resolves, or "remembers" on its own.
 */

import { respondToAsk } from '@/hooks/use-tool-inbox';
import { sendReviewedGmail } from '@/lib/api/routes/google-workspace';
import type { PendingAskUserRequest } from '@/lib/tools/types';
import { useToolInbox } from '@/state/tool-inbox';
import {
  GmailReviewCardView,
  type GmailReview,
} from '@ai-matrx/chat/agents/ui-first-tools/ui/GmailReviewCardView';
import type { GmailReviewResolution } from '@ai-matrx/chat/agents/ui-first-tools/tools/gmail-review-resolution';

type ExtensionReply = Parameters<typeof respondToAsk>[1];

/** The package resolution -> exactly the reply the extension's server path expects. */
export function toExtensionReply(result: GmailReviewResolution): ExtensionReply {
  if (result.outcome === 'sent') {
    return {
      confirmed: true,
      sent_email: {
        message_id: result.messageId ?? '',
        to: result.to ?? '',
        cc: result.cc ?? [],
        subject: result.subject ?? '',
        edited: result.edited === true,
      },
    };
  }
  if (result.outcome === 'declined') return { confirmed: false };
  // 'cancelled' (Dismiss). 'error' cannot occur (no mailbox lookup here) and fails closed to a dismissal.
  return { cancelled: true };
}

/** Same send as before: the shared route, reached only from the card's Send. */
export async function sendFromCard(
  draft: Parameters<typeof sendReviewedGmail>[0],
): Promise<string> {
  const result = await sendReviewedGmail(draft);
  if (!result.ok) {
    // The package card turns status 401 into the sign-in text and shows anything else as-is.
    throw Object.assign(new Error(`Send failed (${result.status}). ${result.error}`), {
      status: result.status,
    });
  }
  return result.data.message_id;
}

export function GmailReviewCard({ req }: { req: PendingAskUserRequest }) {
  const draft = req.email;
  // Defensive: an email_review ask always carries its draft.
  if (!draft) return null;
  const review: GmailReview = {
    callId: req.callId,
    to: draft.to,
    cc: draft.cc,
    subject: draft.subject,
    body: draft.body,
    connectionId: draft.connectionId,
    fromEmail: draft.fromEmail,
    expiresAt: req.expires_at_ms ?? null,
  };
  return (
    <GmailReviewCardView
      review={review}
      sendReviewed={sendFromCard}
      onResolve={(reply: ExtensionReply) => respondToAsk(req.callId, reply)}
      toResolvePayload={toExtensionReply}
      // The handler resolves the call as `cancelled` on its own timer; stop rendering then.
      onExpire={() => useToolInbox.getState().removeAsk(req.callId)}
    />
  );
}
