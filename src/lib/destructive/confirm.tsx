/**
 * THE ONE WAY a destructive click is confirmed in this extension.
 *
 * Arman's destructive-and-expensive-actions law (2026-08-29,
 * `common-docs/policies/destructive-and-expensive-actions.md`) says a control
 * that destroys work must STOP, NAME THE CONSEQUENCE, and make the person
 * confirm — "Are you sure?" is not a confirmation.
 *
 * A 2026-09-08 sweep applied that law to exactly one surface (AgendaView,
 * commit 9b451c4) and stopped; ten more surfaces were still deleting on a
 * single unguarded click when this landed on 2026-09-12. The reason the sweep
 * could stop half-done is that there was no primitive to adopt: every call
 * site had to hand-roll dialog state, so each one was its own decision and a
 * new surface inherited nothing.
 *
 * This is that primitive. The destructive work goes INSIDE `run`, so the
 * action cannot physically happen without the confirmation having resolved
 * true — and `tests/unit/destructive-confirm-guard.test.ts` can prove it by
 * walking the AST: a registered destructive operation called from a `.tsx`
 * outside a confirmed callback fails the suite.
 *
 * It wraps the shared `confirm()` opener from `@ai-matrx/kit/confirm-opener`,
 * whose host (`<ConfirmDialogHost />` from `@ai-matrx/design-system`) is
 * mounted once in the sidepanel. We do NOT own a dialog here — the package
 * owns the chrome; this owns the CONTRACT of what must be said.
 */

import { confirm } from '@ai-matrx/kit/confirm-opener';

export interface DestructiveConfirmOptions {
  /** Names the thing, e.g. `Delete "Weekly digest"?`. */
  title: string;
  /**
   * THE CONSEQUENCE, in plain English and in the declarative: what is
   * destroyed, how much of it, and whether it can be undone. Never a question
   * — a question states nothing, and the law names that exact shape as the
   * failure. Enforced at runtime below and statically by the guard.
   */
  consequence: string;
  /**
   * The adjacent-refresh rule: the keep-what-I-have path, when one exists
   * ("To stop it running without losing its history, cancel and use Pause").
   * Omit only when there genuinely is no safer alternative.
   */
  alternative?: string;
  /** The verb, never "OK": "Delete", "Clear 4 tasks", "Forget pair code". */
  confirmLabel: string;
  /** The destructive work. Runs ONLY after the person confirms. */
  run: () => void | Promise<void>;
}

/** A consequence that only asks states nothing. The law's failing shape. */
export function statesNoConsequence(text: string): boolean {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return true;
  return sentences.every((s) => s.endsWith('?'));
}

/**
 * Stop, name the consequence, and run the work only on a yes.
 *
 * @returns `true` when the person confirmed and `run` completed, `false` when
 * they cancelled. `run`'s own rejection propagates — the caller reports the
 * failure the way it always did.
 */
export async function confirmDestructive(opts: DestructiveConfirmOptions): Promise<boolean> {
  if (statesNoConsequence(opts.consequence)) {
    // Loud, not silent: a confirmation that names nothing is the defect this
    // primitive exists to prevent, so it must never ship quietly.
    throw new Error(
      `confirmDestructive: consequence must STATE what is destroyed, not ask. Got: "${opts.consequence}"`,
    );
  }
  const ok = await confirm({
    title: opts.title,
    description: (
      <>
        <span className="block">{opts.consequence}</span>
        {opts.alternative ? <span className="mt-2 block">{opts.alternative}</span> : null}
      </>
    ),
    confirmLabel: opts.confirmLabel,
    variant: 'destructive',
  });
  if (!ok) return false;
  await opts.run();
  return true;
}
