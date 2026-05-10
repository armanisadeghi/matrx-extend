/**
 * In-app modal that guides the user through granting tab-video-capture
 * access. Mirrors `MicPermissionDialog` — same two-mode UX so users see a
 * consistent permission flow across mic and tab capture.
 *
 * Hard rule (no claims about prior state): the dialog NEVER tells the
 * user that tab capture was previously blocked / denied / refused.
 * Those are claims that may be wrong.
 *
 * Two render modes:
 *
 *   - mode='prompt'  — entry point for every first-time use. Body is
 *     purely informational. Primary button triggers `onConfirm()` —
 *     the caller calls `chrome.permissions.request({permissions:
 *     ['tabCapture']})` from the user-gesture click. If Chrome returns
 *     `false`, the caller flips the dialog to mode='denied'.
 *
 *   - mode='denied'  — only ever reached by transitioning from 'prompt'
 *     after a real `chrome.permissions.request` rejection. Body is
 *     neutral recovery guidance + a button that opens the extension's
 *     permission page programmatically. NEVER opened directly from a
 *     click handler based on stored state.
 *
 * Banned: `window.alert` / `window.confirm` / `window.prompt`. Banned:
 * "open chrome://extensions" written-out instructions. The only
 * chrome:// surface we ever expose to the user opens itself
 * programmatically through a button press.
 */

import { Video, VideoOff, X } from 'lucide-react';

export type TabCaptureDialogMode = 'prompt' | 'denied';

interface Props {
  mode: TabCaptureDialogMode;
  /** User clicked the primary CTA. */
  onConfirm: () => void;
  /** User dismissed (clicked X / Cancel). */
  onClose: () => void;
}

export function TabCaptureDialog({ mode, onConfirm, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'prompt'
          ? 'Allow tab video capture'
          : "Couldn't access tab capture"
      }
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {mode === 'prompt' ? (
              <Video className="size-4 text-primary" />
            ) : (
              <VideoOff className="size-4 text-amber-600 dark:text-amber-400" />
            )}
            <div className="text-base font-semibold leading-tight">
              {mode === 'prompt'
                ? 'Allow tab video capture'
                : "Couldn't access tab capture"}
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

        {mode === 'prompt' ? <PromptBody /> : <DeniedBody />}

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {mode === 'prompt' ? 'Allow' : 'Open extension permissions'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptBody() {
  return (
    <div className="space-y-2 px-4 py-3 text-sm leading-relaxed text-foreground/90">
      <p>
        Recording the active tab requires Chrome&apos;s tab capture permission.
        Click <span className="font-medium">Allow</span> below — Chrome will
        ask for permission.
      </p>
      <p className="text-xs text-muted-foreground">
        Recordings are uploaded to your private cloud storage when you stop
        the recording.
      </p>
    </div>
  );
}

function DeniedBody() {
  return (
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
  );
}
