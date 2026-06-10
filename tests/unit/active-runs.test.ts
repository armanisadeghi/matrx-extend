/**
 * Regression tests for the live-stream registry
 * (docs/AUDIT_2026_06_10.md P1-15) — closeStaleOffscreenOnBoot must not
 * kill the offscreen document while a recently-started run is live, and
 * crash debris must age out so a genuinely stale document can still close.
 */

import {
  hasRecentActiveStream,
  markStreamActive,
  markStreamInactive,
} from '@/lib/stream/active-runs';
import { beforeEach, describe, expect, it } from 'vitest';

describe('stream active-runs registry', () => {
  beforeEach(async () => {
    // Drain anything previous tests left behind.
    for (const id of ['r1', 'r2', 'r3']) await markStreamInactive(id);
  });

  it('reports a freshly-marked run as live', async () => {
    await markStreamActive('r1');
    expect(await hasRecentActiveStream(60_000)).toBe(true);
    await markStreamInactive('r1');
    expect(await hasRecentActiveStream(60_000)).toBe(false);
  });

  it('age-out: an old marker does not pin the offscreen alive', async () => {
    await markStreamActive('r2');
    await new Promise((r) => setTimeout(r, 10));
    // A tighter-than-elapsed window treats the marker as stale debris.
    expect(await hasRecentActiveStream(5)).toBe(false);
    // And the stale row was pruned, so a later wide check stays false.
    expect(await hasRecentActiveStream(60_000)).toBe(false);
  });

  it('inactive-mark for an unknown run is a no-op', async () => {
    await expect(markStreamInactive('r3')).resolves.toBeUndefined();
  });
});
