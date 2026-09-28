import { describe, expect, it } from 'vitest';
import { isCloudSyncableGuidanceId, makeGuidanceId } from '@/lib/guidance/storage';

// extend.wbx_guidance.id is a uuid (access ladder T-21, 2026-09-28): the policy generator compares entity ids
// with uuid sets, so a text id could never reach the cloud. New ids must be uuids; old gd_ ids stay local.
describe('guidance ids', () => {
  it('mints uuids the cloud table accepts', () => {
    const id = makeGuidanceId();
    expect(isCloudSyncableGuidanceId(id)).toBe(true);
    expect(makeGuidanceId()).not.toBe(id);
  });
  it('recognises the pre-uuid gd_ ids as local-only', () => {
    expect(isCloudSyncableGuidanceId('gd_mg3k2x_ab12cd')).toBe(false);
  });
});
