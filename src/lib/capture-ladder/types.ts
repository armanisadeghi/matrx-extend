/**
 * The capture ladder — vocabulary, the `media.capture_handoff` row shape, and
 * the two guards that keep this client honest.
 *
 * Contract:
 * `common-docs/projects/acquisition-frontier/extension-ladder/CONTRACT.md`
 * (§1 rungs, §2 the trail, §3 the queue row, §7 the extension's half).
 *
 * THE LADDER LAW — never silently skip a rung. A capture moves from rung *n*
 * to rung *n+1* or it STOPS with a recorded, visible reason. It never jumps.
 * On this client that law has exactly two teeth, and both live here:
 *
 *   1. `assertRungMatches()` — a result may only claim the rung its row is
 *      actually on. `POST /capture/handoffs/{id}/result` is the ONE door a
 *      captured page enters the platform through, and the server re-asserts
 *      the same thing; asserting it here too means a mis-routed capture is
 *      refused before it ever costs a round trip, and the refusal names the
 *      row.
 *   2. `assertOutcomeReported()` — a runner pass ends with a `result` post or
 *      a `needs-drive` post. Ending with neither is the silent-skip defect:
 *      the row stays `claimed`, the person's tray looks busy, and nothing
 *      anywhere says the page was dropped.
 *
 * Both THROW, deliberately. They are invariants about our own code, not
 * feature-detection of a browser API — the repo's "never throw, return
 * {ok:false}" convention covers the latter. Callers catch `LadderViolation`
 * and turn it into a sentence a person reads.
 *
 * The rung ORDER is declared once, platform-wide, in
 * `aidream/packages/matrx-scraper/matrx_scraper/ladder.py`. This module
 * mirrors the strings; it must never re-order or extend them.
 */

import { z } from 'zod';

/** §1. The four rungs, in ladder order. Never re-ordered, never extended here. */
export const RUNGS = ['http', 'browser', 'own_browser', 'human_drive'] as const;
export type Rung = (typeof RUNGS)[number];

/**
 * The two rungs a browser can be sitting on. A `media.capture_handoff` row
 * only ever exists for these — rungs 1 and 2 are the server's and never
 * produce a queue row.
 */
export const CLIENT_RUNGS = ['own_browser', 'human_drive'] as const;
export type ClientRung = (typeof CLIENT_RUNGS)[number];

/** §3. The row's lifecycle. */
export const HANDOFF_STATUSES = [
  'waiting',
  'claimed',
  'capturing',
  'needs_drive',
  'captured',
  'failed',
  'dismissed',
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

/**
 * The statuses that mean "a person's browser is the only thing that can move
 * this". Exactly what the sidepanel tray lists and what the badge counts.
 */
export const NEEDS_YOU_STATUSES = ['waiting', 'needs_drive'] as const satisfies readonly HandoffStatus[];

/**
 * §2. The machine classes a person's own browser can beat — the reasons that
 * legitimately escalate rung 2 → rung 3. Kept as data so the tray can explain
 * a reason it has never seen without pretending it understood it.
 */
export const ESCALATABLE_REASONS = [
  'login_wall',
  'bad_status',
  'cloudflare_block',
  'empty_content',
  'thin_content',
  'low_text_content',
  'wrong_resource',
  'paywall',
] as const;
export type EscalatableReason = (typeof ESCALATABLE_REASONS)[number];

/**
 * §6 default for `own_browser_scroll_passes`. The knob is org-configurable and
 * lives in aidream's media-catalog registry; this constant is only what we use
 * when the knob could not be read, and that fallback ANNOUNCES itself.
 */
export const DEFAULT_OWN_BROWSER_SCROLL_PASSES = 6;

/**
 * How much text counts as a real read. Below this the page is thin, blocked,
 * or behind a wall, and rung 3 hands it to rung 4 rather than filing a
 * near-empty Source.
 */
export const MIN_CAPTURED_CHARS = 600;

/** §2. One entry per rung attempted. */
export const rungTrailEntrySchema = z.object({
  rung: z.enum(RUNGS),
  ok: z.boolean(),
  reason: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
  chars: z.number().nullable().default(null),
  at: z.string().nullable().default(null),
});
export type RungTrailEntry = z.infer<typeof rungTrailEntrySchema>;

/**
 * §3. The handoff row, exactly as `media.capture_handoff` carries it.
 *
 * Everything the server may not have decided yet is `.nullable()` rather than
 * optional: `exactOptionalPropertyTypes` is on in this repo, and a key that is
 * sometimes absent and sometimes null is two shapes for one fact.
 */
export const handoffSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  url: z.string(),
  title: z.string().default(''),
  rung: z.enum(CLIENT_RUNGS),
  status: z.enum(HANDOFF_STATUSES),
  reason: z.string().nullable().default(null),
  reason_note: z.string().nullable().default(null),
  what_to_do: z.string().nullable().default(null),
  estimated_seconds: z.number().nullable().default(null),
  rung_trail: z.array(rungTrailEntrySchema).nullable().default(null),
  batch_id: z.string().nullable().default(null),
  library_id: z.string().nullable().default(null),
  claimed_by: z.string().nullable().default(null),
  claimed_at: z.string().nullable().default(null),
  claim_expires_at: z.string().nullable().default(null),
  attempt_count: z.number().nullable().default(null),
  captured_item_id: z.string().nullable().default(null),
  captured_chars: z.number().nullable().default(null),
  captured_at: z.string().nullable().default(null),
  captured_by_rung: z.enum(RUNGS).nullable().default(null),
  failure_note: z.string().nullable().default(null),
  created_at: z.string().nullable().default(null),
  updated_at: z.string().nullable().default(null),
  deleted_at: z.string().nullable().default(null),
});
export type Handoff = z.infer<typeof handoffSchema>;

/** Where a rung key sits in the ladder. `-1` for a string that is not a rung. */
export function rungIndex(rung: string): number {
  return (RUNGS as readonly string[]).indexOf(rung);
}

/**
 * A ladder invariant this client refused to break. Carries the sentence a
 * person sees, never a bare code (law 4: nothing fails silently).
 */
export class LadderViolation extends Error {
  readonly kind: 'rung_mismatch' | 'outcome_unreported';
  readonly handoffId: string;
  /** The sentence a person reads. */
  readonly userMessage: string;

  constructor(params: {
    kind: 'rung_mismatch' | 'outcome_unreported';
    handoffId: string;
    userMessage: string;
  }) {
    super(`${params.kind} on handoff ${params.handoffId}: ${params.userMessage}`);
    this.name = 'LadderViolation';
    this.kind = params.kind;
    this.handoffId = params.handoffId;
    this.userMessage = params.userMessage;
  }
}

export function isLadderViolation(err: unknown): err is LadderViolation {
  return err instanceof LadderViolation;
}

/**
 * GUARD 1 — a result may only claim the rung its row is on.
 *
 * `POST …/result` is the only create path into the platform, and
 * `captured_by_rung` is what stamps the Source's provenance sentence. A
 * mismatch is a capture filed as work somebody did not do: an unattended
 * browser read reported as "captured by the expert, driving their own
 * browser", or worse, a rung-4 page filed as rung 3 so the ladder never
 * records that a person had to step in. Refuse before the post.
 *
 * Throws `LadderViolation`; returns nothing on success.
 */
export function assertRungMatches(handoff: Pick<Handoff, 'id' | 'rung'>, capturedByRung: string): void {
  if (capturedByRung === handoff.rung) return;
  throw new LadderViolation({
    kind: 'rung_mismatch',
    handoffId: handoff.id,
    userMessage:
      `This page is waiting on the "${handoff.rung}" step, but the capture was reported as ` +
      `"${capturedByRung}". AI Matrx did not file it, because that would record work at a step ` +
      'it never reached. Nothing was lost — the page is still in your list.',
  });
}

/** What one runner pass did with one handoff. `posted` is the whole point. */
export interface RunnerOutcome {
  handoffId: string;
  /**
   * Did this pass take the claim? A claim is ownership: from that moment the
   * row reads `claimed` to every other client and to the server, and only this
   * pass can move it. A pass that never got the claim (someone else holds it,
   * the claim call was refused) left the row exactly as it found it — still
   * `waiting`, still anybody's — which is NOT a skipped rung.
   */
  claimed: boolean;
  /** Which door this pass went out of. `none` is the defect guard 2 catches. */
  posted: 'result' | 'needs_drive' | 'none';
  ok: boolean;
  chars: number;
  /** The sentence shown next to this item in the tray. Always present. */
  note: string;
}

/**
 * GUARD 2 — never silently skip. A pass that HELD THE CLAIM reported something.
 *
 * A claimed pass that ends with `posted: 'none'` leaves the row `claimed` until
 * the claim expires: the tray shows it as in flight, aidream shows it as in
 * flight, and the page is simply gone. That is precisely the silent skip the
 * ladder law exists to outlaw, so the runner refuses to call such a pass
 * finished.
 *
 * The claim is what makes the distinction real rather than a loophole. An
 * unclaimed pass changed no state anywhere; there is nothing it could report
 * that the row does not already say. A claimed pass changed state, and owes an
 * answer.
 *
 * Throws `LadderViolation`; returns nothing on success.
 */
export function assertOutcomeReported(outcome: RunnerOutcome): void {
  if (outcome.posted !== 'none') return;
  if (!outcome.claimed) return;
  throw new LadderViolation({
    kind: 'outcome_unreported',
    handoffId: outcome.handoffId,
    userMessage:
      'AI Matrx finished trying this page but never told the server what happened, so it would ' +
      'have sat in your list looking busy forever. It has been put back as needing your ' +
      'attention instead.',
  });
}
