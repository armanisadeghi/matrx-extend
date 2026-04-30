/**
 * Inline card for an agent → human question. Three flavors based on the
 * incoming PendingAskUserRequest:
 *   - choices.length > 0  → radio buttons (ask_user_choice)
 *   - secret === true     → masked input  (ask_user_secret)
 *   - default             → freeform textarea (ask_user, request_user_takeover)
 *
 * Submitting fires TOOL_ASK_USER_RESPONSE with the answer; canceling sends
 * { answer: null, cancelled: true }.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { respondToAsk } from '@/hooks/use-tool-inbox';
import type { PendingAskUserRequest } from '@/lib/tools/types';
import { HelpCircle } from 'lucide-react';
import { useState } from 'react';

export function AgentAskUserCard({ req }: { req: PendingAskUserRequest }) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);

  const submit = () => {
    if (req.choices?.length) {
      if (!choice) return;
      respondToAsk(req.callId, choice);
      return;
    }
    if (!text.trim()) return;
    respondToAsk(req.callId, text);
  };

  return (
    <div className="rounded-xl border border-sky-300/60 bg-sky-50/70 p-3 text-sm shadow-sm dark:border-sky-700/60 dark:bg-sky-950/30">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
        <div className="flex-1 min-w-0">
          {req.why && (
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {req.why}
            </div>
          )}
          <div className="whitespace-pre-wrap font-medium">{req.question}</div>
        </div>
      </div>

      <div className="mt-2">
        {req.choices?.length ? (
          <div className="space-y-1.5">
            {req.choices.map((opt) => (
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
        ) : req.secret ? (
          <Input
            type="password"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter value (hidden)"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        ) : (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your answer…"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          className="h-7"
          disabled={req.choices?.length ? !choice : !text.trim()}
          onClick={submit}
        >
          Send
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => respondToAsk(req.callId, null, true)}
        >
          Skip
        </Button>
        {req.secret && (
          <span className="ml-auto text-[10px] text-muted-foreground">Sent once · not stored</span>
        )}
      </div>
    </div>
  );
}
