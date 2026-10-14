/**
 * Outlook in the person's own Chrome — two tools, neither of which sends.
 *
 * `outlook_web_draft` — channel 8 of the server's `outlook` ladder (reached
 *   through Matrx 2's `browser.call`): opens a filled compose window in Outlook
 *   on the web. Outlook keeps it in Drafts; the person sends it, or not.
 *
 * `outlook_email_send` — the reviewed Outlook send, browser half, shaped like
 *   `google_email_send`: the tool has NO server executor (client bindings only),
 *   the person sees and edits the exact message in <OutlookReviewCard>, and only
 *   the message on screen when they confirm is handed to Outlook. In this
 *   surface the send itself is the person's own click on Outlook's Send button,
 *   so the result says `sent: false, opened_in_outlook: true` — this extension
 *   cannot see that click and never claims a send it cannot evidence.
 *   Never add a `user_confirmed`-style argument or a server binding.
 */

import { type OwaHost, openOwaCompose } from '@/lib/outlook/web';
import { awaitUserResponse } from '@/lib/tools/handlers/user';
import type { PendingAskUserRequest, ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const Host = z.enum(['outlook.office.com', 'outlook.live.com']).optional();

const OutlookWebDraftArgs = z.object({
  to: z.array(z.string().min(3).max(320)).min(1).max(50),
  cc: z.array(z.string().min(3).max(320)).max(50).optional(),
  subject: z.string().max(998),
  body: z.string().max(100_000),
  host: Host,
});
type OutlookWebDraftArgs = z.infer<typeof OutlookWebDraftArgs>;

export const outlook_web_draft: ToolHandler<OutlookWebDraftArgs, unknown> = {
  name: 'outlook_web_draft',
  // Opens a tab in the person's browser: an action, asked first in "Ask before acting".
  tier: 'action',
  argsSchema: OutlookWebDraftArgs,
  run: async (args) => {
    const opened = await openOwaCompose({
      to: args.to,
      cc: args.cc ?? [],
      subject: args.subject,
      body: args.body,
      host: args.host as OwaHost | undefined,
    });
    if (!opened.ok) return { ok: false, reason: opened.reason };
    return {
      ok: true,
      compose_open: true,
      tab_id: opened.tab_id,
      host: opened.host,
      sent: false,
      note: 'The message is open in Outlook on the web; Outlook keeps it in Drafts. Nothing was sent.',
    };
  },
};

/** Mirrors `tool.definition.parameters` for `outlook_email_send` (aidream outlook_tool_registry.sql). */
const OutlookEmailSendArgs = z.object({
  to: z.string().min(3).max(320),
  cc: z.array(z.string()).max(20).optional(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(100_000),
});
type OutlookEmailSendArgs = z.infer<typeof OutlookEmailSendArgs>;

export interface OutlookEmailSendResult {
  sent: false;
  opened_in_outlook?: boolean;
  declined?: boolean;
  cancelled?: boolean;
  to?: string;
  cc?: string[];
  subject?: string;
  edited?: boolean;
  note?: string;
  error?: string;
}

const REVIEW_TIMEOUT_MS = 15 * 60_000;

export const outlook_email_send: ToolHandler<OutlookEmailSendArgs, OutlookEmailSendResult> = {
  name: 'outlook_email_send',
  // The review card IS the consent; a second action-tier prompt would teach click-through.
  tier: 'ask-user',
  argsSchema: OutlookEmailSendArgs,
  run: async (args, ctx) => {
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      kind: 'outlook_review',
      context: 'Agent wrote an email — nothing sends until you send it in Outlook',
      outlook_email: {
        to: args.to.trim(),
        cc: (args.cc ?? []).map((e) => e.trim()).filter(Boolean),
        subject: args.subject,
        body: args.body,
      },
      expires_at_ms: Date.now() + REVIEW_TIMEOUT_MS,
    };
    const response = await awaitUserResponse(request, REVIEW_TIMEOUT_MS);
    if (response === 'timed_out' || response.cancelled) return { sent: false, cancelled: true };
    if (!response.confirmed) return { sent: false, declined: true };
    const handed = response.outlook_opened;
    if (!handed) {
      return { sent: false, error: 'Outlook did not open the message. Nothing was sent.' };
    }
    return {
      sent: false,
      opened_in_outlook: true,
      to: handed.to,
      cc: handed.cc,
      subject: handed.subject,
      edited: handed.edited,
      note: 'The reviewed message is open in Outlook; it sends when the person presses Send there.',
    };
  },
};

export const outlook_handlers = [outlook_web_draft, outlook_email_send];
