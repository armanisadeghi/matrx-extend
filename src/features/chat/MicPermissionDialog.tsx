/**
 * In-app modal that guides the user through granting microphone access.
 *
 * Hard rule (no claims about prior state): the dialog NEVER tells the
 * user that mic access was previously blocked / denied / refused. Those
 * claims may be wrong — `navigator.permissions.query` for extension
 * mic state is unreliable across contexts and we don't trust it.
 *
 * Two render modes:
 *
 *   - mode='prompt'  — the entry point for every first-time use. Body
 *     is purely informational: "click Allow microphone, Chrome will
 *     ask for permission". Primary button triggers `onConfirm()` — the
 *     caller starts the live `getUserMedia` attempt. If Chrome rejects,
 *     the caller flips the dialog to mode='denied'.
 *
 *   - mode='denied' — only ever reached by transitioning from 'prompt'
 *     after a real `getUserMedia` failure. Body is neutral recovery
 *     guidance ("we weren't able to start the microphone — to grant
 *     access:" + a button that opens the settings page programmatically).
 *     NEVER opened directly from a click handler based on stored state.
 *
 * Banned: `window.alert` / `window.confirm` / `window.prompt`. Banned:
 * "open chrome://extensions" instructions. The only chrome:// surface
 * we ever expose to the user opens itself programmatically.
 */

import { Mic, MicOff, X } from 'lucide-react';

export type MicPermissionDialogMode = 'prompt' | 'denied';

interface Props {
  mode: MicPermissionDialogMode;
  /** User clicked the primary CTA. */
  onConfirm: () => void;
  /** User dismissed (clicked X / Not now / Close). */
  onClose: () => void;
}

export function MicPermissionDialog({ mode, onConfirm, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'prompt' ? 'Allow microphone access' : "Couldn't access microphone"
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
              <Mic className="size-4 text-primary" />
            ) : (
              <MicOff className="size-4 text-amber-600 dark:text-amber-400" />
            )}
            <div className="text-base font-semibold leading-tight">
              {mode === 'prompt' ? 'Allow microphone access' : "Couldn't access microphone"}
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
            {mode === 'prompt' ? 'Cancel' : 'Close'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {mode === 'prompt' ? 'Allow microphone' : 'Open mic settings'}
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
        Voice input transcribes your speech into the chat. Click{' '}
        <span className="font-medium">Allow microphone</span> below — Chrome will
        ask for permission.
      </p>
      <p className="text-xs text-muted-foreground">
        Audio is sent to Groq Whisper for transcription and is not stored after
        the chat turn finishes.
      </p>
    </div>
  );
}

function DeniedBody() {
  return (
    <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-foreground/90">
      <p>
        We weren&apos;t able to start the microphone. To grant access:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Click <span className="font-medium">Open mic settings</span> below.</li>
        <li>
          Find this extension and set its microphone permission to{' '}
          <span className="font-medium">Allow</span>.
        </li>
        <li>Return here and click the mic icon again.</li>
      </ol>
    </div>
  );
}
