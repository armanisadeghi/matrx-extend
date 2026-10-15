import { getCurrentUser } from '@/lib/auth/flow';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { countConfigEvent } from './index';
import { resolveKnob } from './knob-resolve';

/** `app_instances.platform` values that are installs, not computers: stored as a platform knob, never listed in code. */
export async function nonComputerPlatforms(): Promise<string[] | null> {
  const [organizationId, user] = await Promise.all([getActiveOrganizationId(), getCurrentUser()]);
  if (!organizationId || !user?.id) {
    countConfigEvent('config.non_computer_platforms_unavailable', {
      why: 'not signed in or no organization',
    });
    return null;
  }
  const r = await resolveKnob({
    feature: 'platform.app_instances',
    key: 'non_computer_platforms',
    organizationId,
    userId: user.id,
  });
  if (
    r.error ||
    !Array.isArray(r.data) ||
    !r.data.every((p) => typeof p === 'string' && /^[a-z0-9_-]+$/.test(p))
  ) {
    countConfigEvent(
      'config.non_computer_platforms_unavailable',
      { error: r.error?.message ?? 'not a list of platform names' },
      'error',
    );
    return null;
  }
  return r.data as string[];
}

/** The PostgREST `or` filter that keeps only computers (a NULL platform is a legacy computer). */
export function computersOnlyFilter(excluded: readonly string[]): string {
  return excluded.length === 0
    ? 'platform.is.null,platform.not.is.null'
    : `platform.is.null,platform.not.in.(${excluded.join(',')})`;
}

export function isComputerPlatform(platform: string | null, excluded: readonly string[]): boolean {
  return platform === null || !excluded.includes(platform);
}
