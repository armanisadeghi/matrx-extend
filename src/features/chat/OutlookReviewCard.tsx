/**
 * The reviewed Outlook send's consent surface (`outlook_email_send`).
 *
 * Every field is editable. Only "Open in Outlook to send" acts, and it hands
 * Outlook on the web exactly the message on screen at that moment; the send is
 * the person's own click on Outlook's Send button. Nothing here sends mail.
 */

import { respondToAsk } from '@/hooks/use-tool-inbox';
import { type OwaHost, openOwaCompose } from '@/lib/outlook/web';
import type { PendingAskUserRequest } from '@/lib/tools/types';
import { useToolInbox } from '@/state/tool-inbox';
import { Button, BasicInput as Input } from '@ai-matrx/design-system';
import { BasicTextarea as Textarea } from '@ai-matrx/design-system';
import { Mail, Send } from 'lucide-react';
import { useEffect, useState } from 'react';

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function OutlookReviewCard({ req }: { req: PendingAskUserRequest }) {
  const draft = req.outlook_email;
  const [to, setTo] = useState(draft?.to ?? '');
  const [cc, setCc] = useState((draft?.cc ?? []).join(', '));
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [personal, setPersonal] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!draft) return null;

  const ccList = parseAddressList(cc);
  const edited =
    to !== draft.to ||
    ccList.join(', ') !== draft.cc.join(', ') ||
    subject !== draft.subject ||
    body !== draft.body;
  const canOpen = to.trim().includes('@') && subject.trim().length > 0 && body.trim().length > 0;

  const open = async () => {
    if (opening || !canOpen) return;
    setOpening(true);
    setError(null);
    const host: OwaHost = personal ? 'outlook.live.com' : 'outlook.office.com';
    // The exact bytes on screen — not the agent's arguments.
    const result = await openOwaCompose({ to: [to.trim()], cc: ccList, subject, body, host });
    if (!result.ok) {
      setError(result.reason);
      setOpening(false);
      return;
    }
    respondToAsk(req.callId, {
      confirmed: true,
      outlook_opened: { to: to.trim(), cc: ccList, subject, edited, tab_id: result.tab_id },
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
          <div className="truncate text-xs text-muted-foreground">From your Outlook</div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Field label="To" id={`outlook-to-${req.callId}`}>
          <Input
            id={`outlook-to-${req.callId}`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={opening}
            className="h-8"
          />
        </Field>
        <Field label="Cc (optional)" id={`outlook-cc-${req.callId}`}>
          <Input
            id={`outlook-cc-${req.callId}`}
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="Separate addresses with commas"
            disabled={opening}
            className="h-8"
          />
        </Field>
        <Field label="Subject" id={`outlook-subject-${req.callId}`}>
          <Input
            id={`outlook-subject-${req.callId}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={opening}
            className="h-8"
          />
        </Field>
        <Field label="Message" id={`outlook-body-${req.callId}`}>
          <Textarea
            id={`outlook-body-${req.callId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            disabled={opening}
          />
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
            disabled={opening}
          />
          Personal Outlook.com account
        </label>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}. Nothing was sent.</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">You press Send in Outlook.</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7" onClick={dismiss} disabled={opening}>
            Dismiss
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={decline} disabled={opening}>
            Don't send
          </Button>
          <Button size="sm" className="h-7" onClick={open} disabled={opening || !canOpen}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {opening ? 'Opening…' : 'Open in Outlook'}
          </Button>
        </div>
      </div>
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
