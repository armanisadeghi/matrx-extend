/**
 * Renders the notice stack over the side panel.
 *
 * This is the surface half of the "nothing fails silently" rule: when a
 * database read or write is refused, `src/lib/supabase/db-failure.ts` pushes a
 * notice and the user sees a real sentence here instead of an empty list or a
 * button that quietly snapped back. Mounted once, in the side panel shell,
 * next to `PermissionPromptModal`.
 *
 * The technical tail (`detail`) is admin-only — a non-technical user never
 * needs to read `42501`, and an admin always does.
 */

import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useAuthStore } from '@/state/auth';
import { type Notice, useNoticeStore } from '@/state/notices';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';

export function NoticeHost() {
  const notices = useNoticeStore((s) => s.notices);
  const dismiss = useNoticeStore((s) => s.dismiss);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  // Refusals raised outside the side panel (service worker, offscreen,
  // content script) are relayed here — the side panel is the only surface the
  // user is actually looking at.
  useEffect(() => {
    return on<Notice, { ok: true }>(CHANNELS.DB_FAILURE_NOTICE, (notice) => {
      if (notice && typeof notice.message === 'string') {
        useNoticeStore.getState().add(notice);
      }
      return { ok: true };
    });
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 p-3">
      {notices.map((n) => (
        <div
          key={n.id}
          role="alert"
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur ${
            n.tone === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : n.tone === 'warning'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-border bg-background text-foreground'
          }`}
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{n.title}</div>
            <p className="mt-0.5 leading-relaxed text-foreground/90">{n.message}</p>
            {isAdmin && n.detail && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground break-all">
                {n.detail}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(n.id)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
