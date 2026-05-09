/**
 * In-app modal that guides the user through granting microphone access.
 *
 * Two render modes:
 *
 *   - mode='prompt'  — first-time use. Explains what mic access does,
 *     primary button triggers `onConfirm()` (caller starts the actual
 *     `getUserMedia` flow in the offscreen doc). If Chrome's native
 *     prompt comes back denied, the caller calls back with mode='denied'.
 *
 *   - mode='denied' — the user (or Chrome's site-permission UI) has
 *     previously blocked mic access. Chrome refuses to re-prompt
 *     programmatically from this state. We deep-link the user to the
 *     exact chrome://settings page where the fix lives, opened in a
 *     new tab via chrome.tabs.create — the user doesn't have to type
 *     anything or hunt through menus.
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
        mode === 'prompt' ? 'Enable microphone access' : 'Microphone access blocked'
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
              {mode === 'prompt' ? 'Enable voice input?' : 'Microphone access blocked'}
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
            {mode === 'prompt' ? 'Not now' : 'Close'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {mode === 'prompt' ? 'Enable microphone' : 'Open mic settings'}
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
        Matrx Extend needs microphone access to transcribe your speech into the
        chat input.
      </p>
      <p className="text-xs text-muted-foreground">
        Click <span className="font-medium">Enable microphone</span> below — Chrome will
        ask you to confirm. Audio is sent to Groq Whisper for transcription and is
        not stored after the chat turn finishes.
      </p>
    </div>
  );
}

function DeniedBody() {
  return (
    <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-foreground/90">
      <p>
        Voice input was previously blocked for this extension. To re-enable it:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Click <span className="font-medium">Open mic settings</span> below.</li>
        <li>
          Find this extension in the blocked list (or click{' '}
          <span className="font-medium">Add</span> under Allowed).
        </li>
        <li>
          Switch the choice from <span className="font-medium">Block</span> to{' '}
          <span className="font-medium">Allow</span>.
        </li>
        <li>Reopen this side panel and click the mic again.</li>
      </ol>
      <p className="text-xs text-muted-foreground">
        Chrome doesn&apos;t let extensions un-block themselves automatically — this is
        the shortest path.
      </p>
    </div>
  );
}
