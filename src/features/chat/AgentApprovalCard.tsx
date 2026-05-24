/**
 * Inline card asking the user to approve a tool call.
 *
 * The agent has paused mid-stream waiting for our reply. Two buttons:
 *   - Allow      → TOOL_CONFIRM_RESPONSE { decision: 'allow' }
 *   - Deny       → TOOL_CONFIRM_RESPONSE { decision: 'deny' }
 * A checkbox toggles "remember for this conversation" when the args carry a
 * URL (the dispatcher's domain-trust shortcut). Off by default.
 */

import { Button } from '@/components/ui/button';
import { respondToConfirm } from '@/hooks/use-tool-inbox';
import type { PendingConfirmRequest } from '@/lib/tools/types';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';

export function AgentApprovalCard({ req }: { req: PendingConfirmRequest }) {
  const [remember, setRemember] = useState(false);

  const host = useMemo(() => {
    const url = (req.args as { url?: unknown })?.url;
    if (typeof url !== 'string') return null;
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }, [req.args]);

  const argsPreview = useMemo(() => prettyArgs(req.args), [req.args]);

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm shadow-sm dark:border-amber-700/60 dark:bg-amber-950/30">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            Approve <span className="font-mono text-[12px]">{req.toolName}</span>
            {req.tier === 'privileged' && (
              <span className="ml-2 rounded-full bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
                privileged
              </span>
            )}
          </div>
          {req.description && (
            <div className="mt-0.5 text-xs text-muted-foreground">{req.description}</div>
          )}
        </div>
      </div>

      {argsPreview && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-background/60 p-2 text-[11px] leading-snug">
          {argsPreview}
        </pre>
      )}

      {host && req.tier !== 'privileged' && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="size-3.5"
          />
          Allow this tool on <span className="font-mono">{host}</span> for the rest of this chat
        </label>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 gap-1"
          onClick={() =>
            respondToConfirm(req.callId, 'allow', remember ? 'conversation' : undefined)
          }
        >
          <Check className="size-3.5" />
          Allow
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1"
          onClick={() => respondToConfirm(req.callId, 'deny')}
        >
          <X className="size-3.5" />
          Deny
        </Button>
      </div>
    </div>
  );
}

function prettyArgs(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === 'string') return args;
  try {
    const json = JSON.stringify(args, null, 2);
    if (!json || json === '{}' || json === 'null') return null;
    return json;
  } catch {
    return String(args);
  }
}
