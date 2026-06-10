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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { respondToAsk } from '@/hooks/use-tool-inbox';
import type { AskUserResponse, PendingAskUserRequest, UserAskOption } from '@/lib/tools/types';
import { AlertTriangle, Bell, CheckCircle2, HelpCircle, Info, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const OTHER_SENTINEL = '__matrx_other__';

export function AgentAskUserCard({ req }: { req: PendingAskUserRequest }) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [multi, setMulti] = useState<Set<string>>(() => new Set());
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [writeMode, setWriteMode] = useState(false);
  const [writeText, setWriteText] = useState('');
  const remaining = useCountdown(req.expires_at_ms);

  // Normalize options for legacy + new shapes
  const options: UserAskOption[] = useMemo(
    () => (req.options ?? []).map((o) => (typeof o === 'string' ? { label: o } : o)),
    [req.options],
  );
  // Side-by-side preview layout when ANY single-select option has a preview.
  const sideBySide = req.kind === 'choice' && options.some((o) => o.preview);
  const focusedOption = options[focusedIdx];

  const cancel = () => respondToAsk(req.callId, { cancelled: true });

  // Batched questions render one card at a time; "Next" advances, "Send" finishes.
  const isLast =
    req.batch_total == null ||
    req.batch_total <= 1 ||
    (req.batch_index !== undefined && req.batch_index === req.batch_total - 1);
  // "Write message instead" escape applies to the `user` ask tool only, and not
  // to notify (which carries its own freeform Other).
  const showExtras = !!req.allow_extras && req.kind !== 'notify';
  // The freeform "Anything else?" note ALWAYS rides on the FINAL card (single or
  // last batched), regardless of kind or which ask tool produced it. Every
  // question the agent asks must give the user a freeform channel back to the
  // model — see the two invariants enforced in this card.
  const showNote = isLast;
  // Invariant 1: every non-freeform question offers an "Other" escape. confirm and
  // notify render it inline below; choice/choice_many render an extra option. text
  // and secret are already freeform, so they're exempt.
  const showOther = req.kind === 'choice' || req.kind === 'choice_many';

  // Merge the optional additional-instructions note into every structured answer.
  const respond = (reply: Omit<AskUserResponse, 'callId'>) => {
    const note = additionalInstructions.trim();
    respondToAsk(req.callId, note ? { ...reply, additional_instructions: note } : reply);
  };

  const sendWriteInstead = () => {
    const msg = writeText.trim();
    if (!msg) return;
    // Bypass the structured Q&A entirely; signal the model to re-ask if needed.
    respondToAsk(req.callId, { wrote_instead: true, freeform: msg });
  };

  const submitText = () => {
    if (!text.trim()) return;
    respond({ answer: text });
  };
  const submitChoice = () => {
    if (!choice) return;
    if (choice === OTHER_SENTINEL) {
      if (!otherText.trim()) return;
      respond({ selected: ['Other'], freeform: otherText });
      return;
    }
    respond({ selected: [choice] });
  };
  const submitMulti = () => {
    if (multi.size === 0) return;
    const selected = Array.from(multi);
    const hasOther = selected.includes(OTHER_SENTINEL);
    const labels = selected.filter((s) => s !== OTHER_SENTINEL);
    if (hasOther) {
      if (!otherText.trim()) return;
      labels.push('Other');
      respond({ selected: labels, freeform: otherText });
    } else {
      respond({ selected: labels });
    }
  };
  const submitConfirm = (yes: boolean) => respond({ confirmed: yes });
  const submitConfirmOther = () => {
    if (!otherText.trim()) return;
    // confirmed omitted → handler maps it to null; freeform carries the typed answer.
    respond({ freeform: otherText });
  };
  const submitAction = (label: string) => respond({ action: label, freeform: null });
  const submitOther = () => {
    if (!otherText.trim()) return;
    respond({ action: 'Other', freeform: otherText });
  };

  return (
    <div className={cardChrome(req)}>
      <div className="flex items-start gap-2">
        <Icon kind={req.kind} level={req.level} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {req.header ? (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] uppercase tracking-wide">
                {req.header}
              </Badge>
            ) : null}
            {req.context && (
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {req.context}
              </div>
            )}
            {req.batch_total && req.batch_total > 1 && req.batch_index !== undefined ? (
              <span className="text-[10px] text-muted-foreground">
                {req.batch_index + 1} of {req.batch_total}
              </span>
            ) : null}
          </div>
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

      {writeMode ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Write a message instead
          </div>
          <Textarea
            value={writeText}
            onChange={(e) => setWriteText(e.target.value)}
            placeholder="Type your reply to the agent…"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendWriteInstead();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7"
              disabled={!writeText.trim()}
              onClick={sendWriteInstead}
            >
              Send
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setWriteMode(false);
                setWriteText('');
              }}
            >
              Back to questions
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Body */}
          <div className="mt-2">
            {req.kind === 'confirm' && !showOtherInput && (
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-7" onClick={() => submitConfirm(true)}>
                  Yes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => submitConfirm(false)}
                >
                  No
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setShowOtherInput(true)}
                >
                  Other…
                </Button>
              </div>
            )}

            {req.kind === 'confirm' && showOtherInput && (
              <div className="space-y-2">
                <Textarea
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  placeholder="Type your answer…"
                  rows={2}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submitConfirmOther();
                    }
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={!otherText.trim()}
                    onClick={submitConfirmOther}
                  >
                    {isLast ? 'Send' : 'Next'}
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

            {req.kind === 'choice' && options.length > 0 && (
              <div className={sideBySide ? 'grid grid-cols-[1fr_1.2fr] gap-3' : ''}>
                <div className="space-y-1.5">
                  {options.map((opt, i) => (
                    <label
                      key={opt.label}
                      className="flex cursor-pointer items-start gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-sm hover:bg-accent"
                      onMouseEnter={() => setFocusedIdx(i)}
                    >
                      <input
                        type="radio"
                        name={`ask-${req.callId}`}
                        value={opt.label}
                        checked={choice === opt.label}
                        onChange={() => {
                          setChoice(opt.label);
                          setFocusedIdx(i);
                        }}
                        className="mt-0.5 size-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div>{opt.label}</div>
                        {opt.description ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {opt.description}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  ))}
                  {showOther ? (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-dashed bg-background/40 px-2 py-1.5 text-sm hover:bg-accent">
                      <input
                        type="radio"
                        name={`ask-${req.callId}`}
                        value={OTHER_SENTINEL}
                        checked={choice === OTHER_SENTINEL}
                        onChange={() => setChoice(OTHER_SENTINEL)}
                        className="mt-0.5 size-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div>Other</div>
                        {choice === OTHER_SENTINEL ? (
                          <Textarea
                            value={otherText}
                            onChange={(e) => setOtherText(e.target.value)}
                            placeholder="Type your answer…"
                            rows={2}
                            className="mt-1"
                            autoFocus
                          />
                        ) : (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Type a different answer
                          </div>
                        )}
                      </div>
                    </label>
                  ) : null}
                </div>
                {sideBySide && focusedOption?.preview ? (
                  <pre className="overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {focusedOption.preview}
                  </pre>
                ) : null}
              </div>
            )}

            {req.kind === 'choice_many' && options.length > 0 && (
              <div className="space-y-1.5">
                {options.map((opt) => (
                  <label
                    key={opt.label}
                    className="flex cursor-pointer items-start gap-2 rounded-md border bg-background/60 px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={multi.has(opt.label)}
                      onChange={(e) => {
                        setMulti((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(opt.label);
                          else next.delete(opt.label);
                          return next;
                        });
                      }}
                      className="mt-0.5 size-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div>{opt.label}</div>
                      {opt.description ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {opt.description}
                        </div>
                      ) : null}
                    </div>
                  </label>
                ))}
                {showOther ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-dashed bg-background/40 px-2 py-1.5 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={multi.has(OTHER_SENTINEL)}
                      onChange={(e) => {
                        setMulti((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(OTHER_SENTINEL);
                          else next.delete(OTHER_SENTINEL);
                          return next;
                        });
                      }}
                      className="mt-0.5 size-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div>Other</div>
                      {multi.has(OTHER_SENTINEL) ? (
                        <Textarea
                          value={otherText}
                          onChange={(e) => setOtherText(e.target.value)}
                          placeholder="Type your answer…"
                          rows={2}
                          className="mt-1"
                          autoFocus
                        />
                      ) : (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Type a different answer
                        </div>
                      )}
                    </div>
                  </label>
                ) : null}
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
                  <Button key={label} size="sm" className="h-7" onClick={() => submitAction(label)}>
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
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={!otherText.trim()}
                    onClick={submitOther}
                  >
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

          {showNote && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Anything else? (optional)
              </div>
              <Textarea
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                placeholder="Add a note for the agent…"
                rows={2}
              />
            </div>
          )}

          {/* Footer */}
          {req.kind !== 'confirm' && req.kind !== 'notify' && (
            <div className="mt-2 flex items-center gap-2">
              {req.kind === 'choice' && (
                <Button size="sm" className="h-7" disabled={!choice} onClick={submitChoice}>
                  {isLast ? 'Send' : 'Next'}
                </Button>
              )}
              {req.kind === 'choice_many' && (
                <Button size="sm" className="h-7" disabled={multi.size === 0} onClick={submitMulti}>
                  {isLast ? 'Send' : 'Next'}
                </Button>
              )}
              {(req.kind === 'text' || req.kind === 'secret') && (
                <Button size="sm" className="h-7" disabled={!text.trim()} onClick={submitText}>
                  {isLast ? 'Send' : 'Next'}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7" onClick={cancel}>
                Skip
              </Button>
              {req.kind === 'secret' && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Sent once · not stored
                </span>
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

          {showExtras && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setWriteMode(true)}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Write message instead
              </button>
            </div>
          )}
        </>
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
      return (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      );
    }
    if (l === 'warning') {
      return (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      );
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
