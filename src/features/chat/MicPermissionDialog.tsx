/**
 * In-app recovery modal shown ONLY after Chrome itself has rejected a
 * microphone request. This is the recovery UI, never the pre-attempt UI.
 *
 * Chrome's own permission infrastructure handles the "asking" UI for
 * `getUserMedia`. Our extension never competes with it. Flow:
 *
 *   1. User clicks the mic button.
 *   2. We immediately call `getUserMedia` (in the offscreen document).
 *   3. Chrome handles the prompt UI itself — native prompt on first ask,
 *      silent success when granted, silent rejection when denied.
 *   4. Only on a real `NotAllowedError` rejection does THIS modal appear,
 *      with one-click access to `chrome://settings/content/microphone`.
 *
 * Hard rule: we NEVER show a "we need permission" modal before Chrome
 * has had a chance to prompt. Pre-emptive modals make false claims about
 * state and confuse users who have never been asked.
 *
 * Banned: `window.alert` / `window.confirm` / `window.prompt`. Banned:
 * "open chrome://extensions" written-out instructions. The only chrome://
 * surface we expose opens itself programmatically.
 */

import { MicOff, X } from 'lucide-react';

interface Props {
  /** User clicked "Open mic settings". */
  onConfirm: () => void;
  /** User dismissed (clicked X / Close). */
  onClose: () => void;
}

export function MicPermissionDialog({ onConfirm, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Couldn't access microphone"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <MicOff className="size-4 text-amber-600 dark:text-amber-400" />
            <div className="text-base font-semibold leading-tight">
              Couldn&apos;t access microphone
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-foreground/90">
          <p>
            We weren&apos;t able to start the microphone. To grant access:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              Click <span className="font-medium">Open mic settings</span> below.
            </li>
            <li>
              Find this extension and set its microphone permission to{' '}
              <span className="font-medium">Allow</span>.
            </li>
            <li>Return here and click the mic icon again.</li>
          </ol>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Open mic settings
          </button>
        </div>
      </div>
    </div>
  );
}
