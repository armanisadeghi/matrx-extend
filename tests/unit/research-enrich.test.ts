/**
 * Unit tests for the research enrich planner (src/lib/research/enrich.ts) and
 * goal guards (enrich-types.ts). The executor itself drives live DOM + network,
 * so we verify the pure mapping every goal routes through. See
 * common-docs/systems/knowledge/research/EXTENSION_CAPTURE_CONTRACT.md § Enrichment.
 */

import { planEnrich } from '@/lib/research/enrich';
import { ENRICH_GOALS, type EnrichGoal, isEnrichGoal } from '@/lib/research/enrich-types';
import { describe, expect, it } from 'vitest';

const SUPPORTED: EnrichGoal[] = [
  'rendered_dom',
  'authenticated',
  'structured',
  'expand',
  'comments',
];
const UNSUPPORTED: EnrichGoal[] = ['screenshot', 'download', 'xhr_json', 'transcript'];

describe('planEnrich', () => {
  it('covers every goal in the catalog (no fall-through)', () => {
    for (const goal of ENRICH_GOALS) {
      const plan = planEnrich(goal);
      expect(plan, goal).toBeDefined();
      expect([1, 2, 3]).toContain(plan.level);
    }
  });

  it('marks capture-family goals supported and submits at the scroll level', () => {
    for (const goal of SUPPORTED) {
      const plan = planEnrich(goal);
      expect(plan.supported, goal).toBe(true);
      expect(plan.settle, goal).toBe(true);
      expect(plan.level, goal).toBe(2);
      expect(plan.needs, goal).toBeUndefined();
    }
  });

  it('clicks obstacles only for expand + comments', () => {
    expect(planEnrich('expand').clickObstacles).toBe(true);
    expect(planEnrich('comments').clickObstacles).toBe(true);
    expect(planEnrich('rendered_dom').clickObstacles).toBe(false);
    expect(planEnrich('structured').clickObstacles).toBe(false);
  });

  it('does not scroll for structured (metadata is in <head>, no lazy load needed)', () => {
    expect(planEnrich('structured').scroll).toBe(false);
    expect(planEnrich('rendered_dom').scroll).toBe(true);
  });

  it('marks artifact/specialized goals unsupported with a named server gap', () => {
    for (const goal of UNSUPPORTED) {
      const plan = planEnrich(goal);
      expect(plan.supported, goal).toBe(false);
      expect(typeof plan.needs, goal).toBe('string');
      expect((plan.needs ?? '').length, goal).toBeGreaterThan(0);
    }
  });
});

describe('isEnrichGoal', () => {
  it('accepts every catalog goal and rejects junk', () => {
    for (const goal of ENRICH_GOALS) expect(isEnrichGoal(goal)).toBe(true);
    expect(isEnrichGoal('scrape')).toBe(false);
    expect(isEnrichGoal('')).toBe(false);
    expect(isEnrichGoal(null)).toBe(false);
    expect(isEnrichGoal(42)).toBe(false);
  });
});
