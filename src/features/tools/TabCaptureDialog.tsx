/**
 * In-app modal that guides the user through granting tab-video-capture
 * access. Mirrors `MicPermissionDialog` — same two-mode UX so users see a
 * consistent permission flow across mic and tab capture.
 *
 * Two render modes:
 *
 *   - mode='prompt'  — never asked, or last `chrome.permissions.request`
 *     was implicitly dismissed. Explains what tab capture does, primary
 *     button triggers `onConfirm()` (caller calls
 *     `chrome.permissions.request({permissions:['tabCapture']})`). If
 *     Chrome returns `false`, the caller flips the dialog to
 *     mode='denied'.
 *
 *   - mode='denied'  — Chrome's permissions API returned false because
 *     the user dismissed the prompt. Chrome optional permissions don't
 *     expose a programmatic re-prompt path, so we open the extension's
 *     own permission page in a new tab via `chrome.tabs.create` —
 *     the user clicks one button, we navigate for them, no manual
 *     URL-bar work required.
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
          ? 'Enable tab video capture'
          : 'Tab video capture blocked'
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
                ? 'Enable tab video capture?'
                : 'Tab video capture blocked'}
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
            {mode === 'prompt' ? 'Enable' : 'Open extension permissions'}
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
        Matrx Extend needs permission to capture this tab&apos;s video so it
        can record what&apos;s on screen.
      </p>
      <p className="text-xs text-muted-foreground">
        Click <span className="font-medium">Enable</span> below — Chrome will
        prompt you to grant access. Recordings are uploaded to your private
        cloud storage when you stop the recording.
      </p>
    </div>
  );
}

function DeniedBody() {
  return (
    <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-foreground/90">
      <p>
        Tab video capture was blocked. To enable it:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          Click <span className="font-medium">Open extension permissions</span>{' '}
          below — we&apos;ll open the right page in a new tab.
        </li>
        <li>
          Toggle <span className="font-medium">Tab capture</span> on.
        </li>
        <li>Return here and click Record again.</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        Chrome doesn&apos;t allow extensions to re-prompt for an optional
        permission once it&apos;s been dismissed — this is the shortest path.
      </p>
    </div>
  );
}
