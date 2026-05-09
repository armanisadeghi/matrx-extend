/**
 * Modal that surfaces an optional-permission request to the user with
 * four choices: Deny / Allow / Allow Always / Allow full Autonomous.
 *
 * Mounted once at the sidepanel App level. Subscribes to
 * `usePermissionPromptsStore`; renders nothing when there's no active
 * prompt. When the user clicks a button, the store's `resolveActive`
 * settles the gate's promise and advances the queue (if more requests
 * are pending).
 *
 * See state/permission-prompts.ts and lib/permissions/gate.ts for the
 * gate design.
 */

import { Button } from '@/components/ui/button';
import {
  type PermissionVerdict,
  usePermissionPromptsStore,
} from '@/state/permission-prompts';
import { Globe, Lock, ShieldCheck, Sparkles, X } from 'lucide-react';

const VERDICT_DETAILS: Record<
  PermissionVerdict,
  { label: string; sublabel: string; tone: string; Icon: typeof Globe }
> = {
  deny: {
    label: 'Not now',
    sublabel: 'Skip this one time',
    tone:
      'border-border bg-muted text-foreground hover:bg-muted/80',
    Icon: Lock,
  },
  allow: {
    label: 'Allow this time',
    sublabel: 'Grant for now — ask me again next time',
    tone:
      'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20',
    Icon: Globe,
  },
  always: {
    label: 'Allow always',
    sublabel: "Grant and don't ask about this again",
    tone:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20',
    Icon: ShieldCheck,
  },
  autonomous: {
    label: 'Full autonomous access',
    sublabel: 'Allow every advanced capability without asking',
    tone:
      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20',
    Icon: Sparkles,
  },
};

const ORDER: PermissionVerdict[] = ['deny', 'allow', 'always', 'autonomous'];

export function PermissionPromptModal() {
  const active = usePermissionPromptsStore((s) => s.active);
  const queue = usePermissionPromptsStore((s) => s.queue);
  const resolveActive = usePermissionPromptsStore((s) => s.resolveActive);

  if (!active) return null;

  const handle = (verdict: PermissionVerdict) => resolveActive(verdict);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={`Permission needed: ${active.feature}`}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Permission needed
            </div>
            <div className="mt-0.5 text-base font-semibold leading-tight">
              {active.feature}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handle('deny')}
            aria-label="Dismiss"
            className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <p className="text-sm leading-relaxed text-foreground/90">
            {active.reason}
          </p>
          <p className="text-xs text-muted-foreground">
            Chrome will ask you to confirm before any permission is granted.
          </p>
        </div>

        <div className="grid gap-2 px-4 pb-4">
          {ORDER.map((v) => {
            const cfg = VERDICT_DETAILS[v];
            return (
              <button
                key={v}
                type="button"
                onClick={() => handle(v)}
                className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${cfg.tone}`}
              >
                <cfg.Icon className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{cfg.label}</div>
                  <div className="text-[11px] opacity-80">{cfg.sublabel}</div>
                </div>
              </button>
            );
          })}
        </div>

        {queue.length > 0 && (
          <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            {queue.length} more {queue.length === 1 ? 'prompt' : 'prompts'} queued
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Settings-tab helper: render a small footer that lets the user reset
 * the always-allow / autonomous preferences if they want to be
 * re-prompted in the future. (Optional surface — not shown in the
 * modal itself.)
 */
export function PermissionPreferencesSummary() {
  const autonomous = usePermissionPromptsStore((s) => s.autonomous);
  const alwaysAllow = usePermissionPromptsStore((s) => s.alwaysAllow);
  const setAutonomous = usePermissionPromptsStore((s) => s.setAutonomous);
  const setAlwaysAllow = usePermissionPromptsStore((s) => s.setAlwaysAllow);

  const alwaysKeys = Object.entries(alwaysAllow)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (!autonomous && alwaysKeys.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No remembered choices yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      {autonomous && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
          <span>
            <Sparkles className="mr-1 inline size-3" /> Full autonomous access
            is on
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setAutonomous(false)}
          >
            Turn off
          </Button>
        </div>
      )}
      {alwaysKeys.map((key) => (
        <div
          key={key}
          className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-700 dark:text-emerald-300"
        >
          <span>
            <ShieldCheck className="mr-1 inline size-3" />
            {' '}Always allow: {key}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setAlwaysAllow(key, false)}
          >
            Forget
          </Button>
        </div>
      ))}
    </div>
  );
}
