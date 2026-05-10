/**
 * Generic in-app confirmation modal. Replacement for `window.confirm`,
 * which is BANNED across the extension because:
 *
 *   - It blocks the renderer thread (no streaming, no animations, nothing).
 *   - Sidepanel + offscreen + service-worker contexts all interact poorly
 *     with Chrome's native confirm UI; some surfaces silently no-op.
 *   - The look is browser-chrome, not extension-chrome — visually broken.
 *
 * Usage: gate this component on a boolean state and pass `onConfirm` /
 * `onClose`. The destructive variant shows red emphasis on the confirm
 * button for delete-style operations.
 *
 * Visual style mirrors `MicPermissionDialog` / `TabCaptureDialog` so the
 * three modals feel like one consistent system.
 */

import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';

interface Props {
  /** Visible when true. */
  open: boolean;
  /** Heading. */
  title: string;
  /** Body — single string or pre-rendered JSX for richer prompts. */
  description: React.ReactNode;
  /** Confirm-button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
  /** Disable confirm button (e.g., while async work is in flight). */
  busy?: boolean;
  /** User clicked confirm. */
  onConfirm: () => void;
  /** User clicked cancel / X / outside. */
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  // Esc closes the dialog. Native `<dialog>` would handle this for free
  // but using it here would conflict with the existing modal styling
  // pattern shared with MicPermissionDialog / TabCaptureDialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {destructive && (
              <AlertTriangle className="size-4 text-red-600 dark:text-red-400" />
            )}
            <div className="text-base font-semibold leading-tight">{title}</div>
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

        <div className="space-y-2 px-4 py-3 text-sm leading-relaxed text-foreground/90">
          {typeof description === 'string'
            ? description
                .split('\n\n')
                .map((para, i) => <p key={i}>{para}</p>)
            : description}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? 'rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500'
                : 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
