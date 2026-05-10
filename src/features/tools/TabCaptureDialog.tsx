/**
 * In-app recovery modal shown ONLY after Chrome itself has rejected a
 * `chrome.permissions.request({permissions: ['tabCapture']})` call.
 * Recovery UI only, never pre-attempt UI.
 *
 * Chrome's own permission infrastructure handles the "asking" UI for
 * optional permission requests. Our extension never competes with it.
 * Flow:
 *
 *   1. User clicks Record.
 *   2. We immediately call `chrome.permissions.request(...)` from the
 *      user-gesture handler.
 *   3. Chrome handles the prompt UI itself — native dialog on first
 *      ask, silent success when granted, silent rejection when denied.
 *   4. Only on a real rejection does THIS modal appear, with one-click
 *      access to the extension's permission page.
 *
 * Hard rule: we NEVER show a "we need permission" modal before Chrome
 * has had a chance to prompt. Pre-emptive modals make false claims
 * about state and confuse users who have never been asked.
 *
 * Banned: `window.alert` / `window.confirm` / `window.prompt`. Banned:
 * "open chrome://extensions" written-out instructions. The only
 * chrome:// surface we expose opens itself programmatically through a
 * button press.
 */

import { VideoOff, X } from 'lucide-react';

interface Props {
  /** User clicked "Open extension permissions". */
  onConfirm: () => void;
  /** User dismissed (clicked X / Close). */
  onClose: () => void;
}

export function TabCaptureDialog({ onConfirm, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Couldn't access tab capture"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <VideoOff className="size-4 text-amber-600 dark:text-amber-400" />
            <div className="text-base font-semibold leading-tight">
              Couldn&apos;t access tab capture
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
            We weren&apos;t able to start tab capture. To grant access:
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              Click <span className="font-medium">Open extension permissions</span>{' '}
              below.
            </li>
            <li>
              Toggle <span className="font-medium">Tab capture</span> on.
            </li>
            <li>Return here and click Record again.</li>
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
            Open extension permissions
          </button>
        </div>
      </div>
    </div>
  );
}
