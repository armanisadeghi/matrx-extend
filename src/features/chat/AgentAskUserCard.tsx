/**
 * Inline card for the unified `user` tool. Branches on `req.kind`:
 *   confirm     → Yes/No buttons
 *   choice      → radio list + Send
 *   choice_many → checklist + Submit
 *   text        → freeform textarea + Send
 *   secret      → password input + Send (input masked + warning chip)
 *   notify      → level-styled banner + action buttons + Other (freeform)
 *
 * Cancel is always available. When the request carries an `expires_at_ms`,
 * the card shows a countdown and auto-dismisses on expiry — the SW-side
 * timer resolves the tool with `timed_out: true` independently, so we
 * just need to stop rendering.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { respondToAsk } from '@/hooks/use-tool-inbox';
import type { PendingAskUserRequest } from '@/lib/tools/types';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  HelpCircle,
  Info,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function AgentAskUserCard({ req }: { req: PendingAskUserRequest }) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [multi, setMulti] = useState<Set<string>>(() => new Set());
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherText, setOtherText] = useState('');
  const remaining = useCountdown(req.expires_at_ms);

  const cancel = () => respondToAsk(req.callId, { cancelled: true });

  const submitText = () => {
    if (!text.trim()) return;
    respondToAsk(req.callId, { answer: text });
  };
  const submitChoice = () => {
    if (!choice) return;
    respondToAsk(req.callId, { selected: [choice] });
  };
  const submitMulti = () => {
    if (multi.size === 0) return;
    respondToAsk(req.callId, { selected: Array.from(multi) });
  };
  const submitConfirm = (yes: boolean) => respondToAsk(req.callId, { confirmed: yes });
  const submitAction = (label: string) =>
    respondToAsk(req.callId, { action: label, freeform: null });
  const submitOther = () => {
    if (!otherText.trim()) return;
    respondToAsk(req.callId, { action: 'Other', freeform: otherText });
  };

  return (
    <div className={cardChrome(req)}>
      <div className="flex items-start gap-2">
        <Icon kind={req.kind} level={req.level} />
        <div className="flex-1 min-w-0">
          {req.context && (
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {req.context}
            </div>
          )}
          <div className="whitespace-pre-wrap font-medium">
            {req.kind === 'notify' ? req.message : req.question}
          </div>
        </div>
        {remaining != null && (
          <span className="ml-2 shrink-0 rounded-full bg-background/70 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {formatRemaining(remaining)}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="mt-2">
        {req.kind === 'confirm' && (
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-7" onClick={() => submitConfirm(true)}>
              Yes
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => submitConfirm(false)}>
              No
            </Button>
          </div>
        )}

        {req.kind === 'choice' && req.options && (
          <div className="space-y-1.5">
            {req.options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name={`ask-${req.callId}`}
                  value={opt}
                  checked={choice === opt}
                  onChange={() => setChoice(opt)}
                  className="size-3.5"
                />
                <span className="flex-1">{opt}</span>
              </label>
            ))}
          </div>
        )}

        {req.kind === 'choice_many' && req.options && (
          <div className="space-y-1.5">
            {req.options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={multi.has(opt)}
                  onChange={(e) => {
                    setMulti((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(opt);
                      else next.delete(opt);
                      return next;
                    });
                  }}
                  className="size-3.5"
                />
                <span className="flex-1">{opt}</span>
              </label>
            ))}
          </div>
        )}

        {req.kind === 'text' && (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your answer…"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitText();
              }
            }}
          />
        )}

        {req.kind === 'secret' && (
          <Input
            type="password"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter value (hidden)"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitText();
              }
            }}
          />
        )}

        {req.kind === 'notify' && !showOtherInput && (
          <div className="flex flex-wrap items-center gap-2">
            {(req.actions ?? []).map((label) => (
              <Button
                key={label}
                size="sm"
                className="h-7"
                onClick={() => submitAction(label)}
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setShowOtherInput(true)}
            >
              Other
            </Button>
          </div>
        )}

        {req.kind === 'notify' && showOtherInput && (
          <div className="space-y-2">
            <Textarea
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Tell the agent what happened…"
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitOther();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-7" disabled={!otherText.trim()} onClick={submitOther}>
                Send
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setShowOtherInput(false);
                  setOtherText('');
                }}
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {req.kind !== 'confirm' && req.kind !== 'notify' && (
        <div className="mt-2 flex items-center gap-2">
          {req.kind === 'choice' && (
            <Button size="sm" className="h-7" disabled={!choice} onClick={submitChoice}>
              Send
            </Button>
          )}
          {req.kind === 'choice_many' && (
            <Button size="sm" className="h-7" disabled={multi.size === 0} onClick={submitMulti}>
              Send
            </Button>
          )}
          {(req.kind === 'text' || req.kind === 'secret') && (
            <Button size="sm" className="h-7" disabled={!text.trim()} onClick={submitText}>
              Send
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={cancel}>
            Skip
          </Button>
          {req.kind === 'secret' && (
            <span className="ml-auto text-[10px] text-muted-foreground">Sent once · not stored</span>
          )}
        </div>
      )}

      {req.kind === 'confirm' && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" className="h-7" onClick={cancel}>
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

function cardChrome(req: PendingAskUserRequest): string {
  if (req.kind !== 'notify') {
    return 'rounded-xl border border-sky-300/60 bg-sky-50/70 p-3 text-sm shadow-sm dark:border-sky-700/60 dark:bg-sky-950/30';
  }
  const level = req.level ?? 'info';
  switch (level) {
    case 'success':
      return 'rounded-xl border border-emerald-300/60 bg-emerald-50/70 p-3 text-sm shadow-sm dark:border-emerald-700/60 dark:bg-emerald-950/30';
    case 'warning':
      return 'rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30';
    case 'error':
      return 'rounded-xl border border-red-300/60 bg-red-50/70 p-3 text-sm shadow-sm dark:border-red-700/60 dark:bg-red-950/30';
    default:
      return 'rounded-xl border border-sky-300/60 bg-sky-50/70 p-3 text-sm shadow-sm dark:border-sky-700/60 dark:bg-sky-950/30';
  }
}

function Icon({
  kind,
  level,
}: {
  kind: PendingAskUserRequest['kind'];
  level: PendingAskUserRequest['level'];
}) {
  if (kind === 'notify') {
    const l = level ?? 'info';
    if (l === 'success') {
      return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    }
    if (l === 'warning') {
      return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />;
    }
    if (l === 'error') {
      return <XCircle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />;
    }
    return <Bell className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />;
  }
  if (kind === 'confirm') {
    return <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />;
  }
  return <HelpCircle className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />;
}

function useCountdown(expiresAt: number | undefined): number | null {
  const initial = useMemo(() => {
    if (!expiresAt) return null;
    return Math.max(0, expiresAt - Date.now());
  }, [expiresAt]);
  const [remaining, setRemaining] = useState<number | null>(initial);
  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

function formatRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, '0')}`;
  }
  return `${s}s`;
}
