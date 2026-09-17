/**
 * THE LADDER LAW, as two guards.
 *
 * CONTRACT.md §1: "A capture may only move from rung n to rung n+1. It may
 * STOP at any rung … but a stop is recorded with its reason and is visible; it
 * is never a jump." On this client that law has exactly two teeth, and this
 * file is what proves they bite.
 *
 * PROVEN FAILING-THEN-PASSING on 2026-09-17, by inverting each guard's own
 * condition in `src/lib/capture-ladder/types.ts` and re-running:
 *
 *   assertRungMatches:     `if (capturedByRung === handoff.rung) return;`
 *                       →  `if (capturedByRung !== handoff.rung) return;`
 *       RED: "ladder order — a result may only claim the rung its row is on
 *             > refuses a rung-4 row reported as an unattended rung-3 capture"
 *             expected [Function] to throw an error
 *
 *   assertOutcomeReported: `if (outcome.posted !== 'none') return;`
 *                       →  `if (outcome.posted === 'none') return;`
 *       RED: "never silently skip — a claimed pass reports something
 *             > refuses a claimed pass that posted neither a result nor a
 *             needs-drive" expected [Function] to throw an error
 *
 * Both restored; both green. The verbatim outputs are in the lane's report.
 *
 * These are NOT tests of manufactured data through their author's own happy
 * path: each one asserts that a WRONG input is refused, so deleting the guard
 * turns them red. `capture-ladder-runner.test.ts` proves the runner actually
 * reaches them.
 */

import { describe, expect, it } from 'vitest';

import {
  CLIENT_RUNGS,
  type Handoff,
  LadderViolation,
  RUNGS,
  type RunnerOutcome,
  assertOutcomeReported,
  assertRungMatches,
  handoffSchema,
  rungIndex,
} from '../../src/lib/capture-ladder/types';

function row(overrides: Partial<Handoff> = {}): Handoff {
  return handoffSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    url: 'https://example.com/article',
    title: 'An article',
    rung: 'own_browser',
    status: 'waiting',
    ...overrides,
  });
}

function outcome(overrides: Partial<RunnerOutcome> = {}): RunnerOutcome {
  return {
    handoffId: '11111111-1111-4111-8111-111111111111',
    claimed: true,
    posted: 'result',
    ok: true,
    chars: 4200,
    note: 'Read and saved.',
    ...overrides,
  };
}

describe('the rung vocabulary is the platform vocabulary', () => {
  it('declares the four rungs in ladder order', () => {
    expect([...RUNGS]).toEqual(['http', 'browser', 'own_browser', 'human_drive']);
    expect(rungIndex('own_browser')).toBe(2);
    expect(rungIndex('human_drive')).toBe(3);
    expect(rungIndex('not_a_rung')).toBe(-1);
  });

  it('only the two browser-side rungs can carry a handoff row', () => {
    expect([...CLIENT_RUNGS]).toEqual(['own_browser', 'human_drive']);
    expect(() => row({ rung: 'http' as never })).toThrow();
    expect(() => row({ rung: 'browser' as never })).toThrow();
  });
});

describe('ladder order — a result may only claim the rung its row is on', () => {
  it('refuses a rung-4 row reported as an unattended rung-3 capture', () => {
    // This is the jump the law outlaws: the page actually needed a person, and
    // filing it as `own_browser` would erase that from the record.
    expect(() => assertRungMatches(row({ rung: 'human_drive' }), 'own_browser')).toThrow(
      LadderViolation,
    );
  });

  it('refuses a rung-3 row reported as work a person drove', () => {
    expect(() => assertRungMatches(row({ rung: 'own_browser' }), 'human_drive')).toThrow(
      LadderViolation,
    );
  });

  it('refuses a rung this client cannot be on at all', () => {
    expect(() => assertRungMatches(row({ rung: 'own_browser' }), 'browser')).toThrow(
      LadderViolation,
    );
    expect(() => assertRungMatches(row({ rung: 'own_browser' }), 'http')).toThrow(LadderViolation);
  });

  it('allows the matching rung', () => {
    expect(() => assertRungMatches(row({ rung: 'own_browser' }), 'own_browser')).not.toThrow();
    expect(() => assertRungMatches(row({ rung: 'human_drive' }), 'human_drive')).not.toThrow();
  });

  it('names the row and says it in a sentence a person can read', () => {
    try {
      assertRungMatches(row({ rung: 'human_drive' }), 'own_browser');
      throw new Error('guard did not fire');
    } catch (err) {
      expect(err).toBeInstanceOf(LadderViolation);
      const violation = err as LadderViolation;
      expect(violation.kind).toBe('rung_mismatch');
      expect(violation.handoffId).toBe('11111111-1111-4111-8111-111111111111');
      // Law 4: a refusal is a sentence with a remedy, never a code alone.
      expect(violation.userMessage).toMatch(/human_drive/);
      expect(violation.userMessage).toMatch(/still in your list/);
    }
  });
});

describe('never silently skip — a claimed pass reports something', () => {
  it('refuses a claimed pass that posted neither a result nor a needs-drive', () => {
    expect(() => assertOutcomeReported(outcome({ posted: 'none', ok: false }))).toThrow(
      LadderViolation,
    );
  });

  it('accepts a pass that posted a result', () => {
    expect(() => assertOutcomeReported(outcome({ posted: 'result' }))).not.toThrow();
  });

  it('accepts a pass that handed the page to the person', () => {
    expect(() =>
      assertOutcomeReported(outcome({ posted: 'needs_drive', ok: false })),
    ).not.toThrow();
  });

  it('does not accuse a pass that never took the claim', () => {
    // Someone else holds the claim: this pass changed nothing anywhere, so the
    // row is still `waiting` for whoever does hold it. Not a skip.
    expect(() =>
      assertOutcomeReported(outcome({ posted: 'none', ok: false, claimed: false })),
    ).not.toThrow();
  });

  it('says what would have gone wrong, in plain English', () => {
    try {
      assertOutcomeReported(outcome({ posted: 'none', ok: false }));
      throw new Error('guard did not fire');
    } catch (err) {
      expect(err).toBeInstanceOf(LadderViolation);
      expect((err as LadderViolation).kind).toBe('outcome_unreported');
      expect((err as LadderViolation).userMessage).toMatch(/looking busy/);
    }
  });
});
