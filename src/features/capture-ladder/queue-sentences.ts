/**
 * THE LYING ZERO, IN WORDS.
 *
 * The capture tray used to answer an empty queue with a bare "Nothing needs
 * your browser". That sentence is false whenever the person's waiting pages
 * sit in a DIFFERENT one of their own organizations — which is the normal
 * case, because the web app's tray and this extension resolve their active
 * organization independently. The owner was told "2 pages are waiting for your
 * browser", opened the extension, saw a calm nothing, and concluded the system
 * was broken.
 *
 * So the empty state is computed, never hardcoded: it NAMES the workspace it
 * looked in, and when other memberships hold work it says so in ONE sentence
 * with a real control. Pure functions, because the rule that matters ("an
 * empty queue with work elsewhere never renders as a plain nothing") is a rule
 * about the sentence, and a rule about a sentence can be proven by a test
 * instead of by a screenshot.
 *
 * ONE LINE OF EXPLANATION. Not a paragraph, not a repetition of the tab's own
 * name — the thing that delivers zero value does not get to write a novel.
 */

import type { ElsewhereWaiting } from '@/lib/capture-ladder/queue';

export interface QueueSentencesInput {
  /** Rows actually in the active organization's queue. */
  itemCount: number;
  /** The organization this browser is acting in. */
  organizationName: string | null;
  /** The person's other memberships that hold waiting rows. */
  elsewhere: ElsewhereWaiting[];
  /** Set when the "and where else?" read failed. */
  elsewhereError?: string | null;
}

export interface QueueSentences {
  /** The header line. */
  headline: string;
  /**
   * The one-sentence body shown when the active queue is empty — always names
   * the workspace. Null when there are rows to show instead.
   */
  emptyLine: string | null;
  /** "4 pages are waiting in AI Matrx" — null when nothing waits elsewhere. */
  elsewhereLine: string | null;
  /** The organization the switch button should offer, or null. */
  switchTo: ElsewhereWaiting | null;
  /** Label for that button, or null. */
  switchLabel: string | null;
  /** Shown when we could not check the other workspaces at all. */
  elsewhereProblem: string | null;
}

function pages(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}

/** The workspace's name, or an honest stand-in — never a blank. */
function where(organizationName: string | null): string {
  return organizationName ?? 'the workspace this browser is signed in to';
}

export function queueSentences(input: QueueSentencesInput): QueueSentences {
  const { itemCount, organizationName, elsewhere } = input;
  const elsewhereTotal = elsewhere.reduce((sum, row) => sum + row.count, 0);
  const top = [...elsewhere].sort((a, b) => b.count - a.count)[0] ?? null;

  const headline =
    itemCount === 0
      ? `Nothing needs your browser in ${where(organizationName)}`
      : `${pages(itemCount)} need your browser`;

  return {
    headline,
    emptyLine:
      itemCount === 0
        ? `Nothing needs your browser in ${where(organizationName)}. When a page will not open for our servers, it shows up here.`
        : null,
    elsewhereLine:
      elsewhereTotal > 0
        ? elsewhere.length === 1 && top
          ? `${pages(top.count)} ${top.count === 1 ? 'is' : 'are'} waiting in ${top.organizationName}.`
          : `${pages(elsewhereTotal)} are waiting in ${elsewhere.length} of your other workspaces.`
        : null,
    switchTo: top,
    switchLabel: top ? `Switch to ${top.organizationName}` : null,
    elsewhereProblem: input.elsewhereError
      ? `AI Matrx could not check your other workspaces just now, so pages may be waiting in one of them: ${input.elsewhereError}`
      : null,
  };
}

/**
 * The capture tab's accessible name and tooltip.
 *
 * The BADGE NUMBER stays the actionable count — the rows this browser can act
 * on right now — because a badge that added other workspaces' rows would send
 * the person clicking into a list that does not contain them. The NAME is
 * where the elsewhere count goes, so the tab never announces a flat "nothing"
 * while the person has work one switch away.
 */
export function captureTabLabel(count: number, elsewhereTotal: number): string {
  if (count > 0) {
    return elsewhereTotal > 0
      ? `${pages(count)} need your browser — ${elsewhereTotal} more waiting in another workspace`
      : `${pages(count)} need your browser`;
  }
  if (elsewhereTotal > 0) {
    return `Nothing needs your browser here — ${elsewhereTotal} waiting in another workspace`;
  }
  return 'Pages that need your browser';
}

/** The short text the trigger shows beside its icon while there is work. Empty when there is none. */
export function captureTabShortLabel(count: number, elsewhereTotal: number): string {
  if (count > 0) return 'Needs you';
  if (elsewhereTotal > 0) return 'Elsewhere';
  return '';
}
