/**
 * GmailReviewCard — the Gmail consent surface (ask kind `email_review`).
 *
 * THIS CARD IS THE AUTHORIZATION. The agent proposed a message; nothing has been
 * sent, and nothing can be until the user presses Send here. Everything that
 * will leave their mailbox is on screen and editable: sender account, recipient,
 * CC, subject, body. The send posts exactly what the fields hold at that moment
 * — never the agent's original arguments once the user has changed them.
 *
 * Deliberately absent: any "always send" affordance, any pre-checked consent,
 * any remembered-domain shortcut, and any path that sends without a click.
 * Approval here covers ONE message. (Note the contrast with action-tier tools,
 * where "allow + remember for this conversation" is offered — that is exactly
 * what must never exist for sending mail as the user.)
 *
 * A failed send leaves the card OPEN, says nothing was sent, and lets the user
 * try again or back out. It never resolves the tool as a success.
 *
 * Behavioural twin of matrx-frontend's
 * `features/google-workspace/agent/GmailReviewCard.tsx`.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { respondToAsk } from '@/hooks/use-tool-inbox';
import { sendReviewedGmail } from '@/lib/api/routes/google-workspace';
import { GOOGLE_WORKSPACE_SETTINGS_URL } from '@/lib/google/connection';
import type { PendingAskUserRequest } from '@/lib/tools/types';
import { useToolInbox } from '@/state/tool-inbox';
import { ExternalLink, Mail, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function GmailReviewCard({ req }: { req: PendingAskUserRequest }) {
  const draft = req.email;
  const [to, setTo] = useState(draft?.to ?? '');
  const [cc, setCc] = useState((draft?.cc ?? []).join(', '));
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The handler resolves the call as `cancelled` on its own timer; once that
  // happens an answer typed here would go nowhere, so stop rendering. (Same
  // rule as AgentAskUserCard — a card that stays interactive after the tool
  // gave up is a lie.)
  const expiresAt = req.expires_at_ms;
  useEffect(() => {
    if (!expiresAt) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      useToolInbox.getState().removeAsk(req.callId);
      return;
    }
    const id = setTimeout(() => useToolInbox.getState().removeAsk(req.callId), remaining);
    return () => clearTimeout(id);
  }, [expiresAt, req.callId]);

  // Defensive: an email_review ask always carries its draft.
  if (!draft) return null;

  const ccList = parseAddressList(cc);
  const edited =
    to !== draft.to ||
    ccList.join(', ') !== draft.cc.join(', ') ||
    subject !== draft.subject ||
    body !== draft.body;
  const canSend = to.trim().includes('@') && subject.trim().length > 0 && body.trim().length > 0;

  const send = async () => {
    if (sending || !canSend) return;
    setSending(true);
    setError(null);
    // The exact bytes on screen — not the agent's arguments.
    const result = await sendReviewedGmail({
      connectionId: draft.connectionId,
      to: to.trim(),
      cc: ccList,
      subject,
      body,
    });
    if (!result.ok) {
      // Card stays open. Nothing was sent, and the tool is still waiting.
      setError(
        result.status === 401
          ? 'Sign in to AI Matrx to send from your connected Google account.'
          : `Send failed (${result.status}). ${result.error}`,
      );
      setSending(false);
      return;
    }
    respondToAsk(req.callId, {
      confirmed: true,
      sent_email: {
        message_id: result.data.message_id,
        to: to.trim(),
        cc: ccList,
        subject,
        edited,
      },
    });
  };

  const decline = () => respondToAsk(req.callId, { confirmed: false });
  const dismiss = () => respondToAsk(req.callId, { cancelled: true });

  return (
    <div className="rounded-xl border border-sky-300/60 bg-sky-50/70 p-3 text-sm shadow-sm dark:border-sky-700/60 dark:bg-sky-950/30">
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Review before sending
          </div>
          <div className="truncate font-medium">{subject.trim() || 'No subject'}</div>
          <div className="truncate text-xs text-muted-foreground">
            {draft.fromEmail
              ? `From ${draft.fromEmail} — your connected Google account`
              : 'From your connected Google account'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Field label="To" id={`gmail-to-${req.callId}`}>
          <Input
            id={`gmail-to-${req.callId}`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={sending}
            className="h-8"
          />
        </Field>
        <Field label="Cc (optional)" id={`gmail-cc-${req.callId}`}>
          <Input
            id={`gmail-cc-${req.callId}`}
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="Separate addresses with commas"
            disabled={sending}
            className="h-8"
          />
        </Field>
        <Field label="Subject" id={`gmail-subject-${req.callId}`}>
          <Input
            id={`gmail-subject-${req.callId}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            className="h-8"
          />
        </Field>
        <Field label="Message" id={`gmail-body-${req.callId}`}>
          <Textarea
            id={`gmail-body-${req.callId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            disabled={sending}
          />
        </Field>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error} Nothing was sent.</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Nothing sends until you press Send.
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7" onClick={dismiss} disabled={sending}>
            Dismiss
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={decline} disabled={sending}>
            Don't send
          </Button>
          <Button size="sm" className="h-7" onClick={send} disabled={sending || !canSend}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>

      <a
        href={GOOGLE_WORKSPACE_SETTINGS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Manage or disconnect this Google account
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
