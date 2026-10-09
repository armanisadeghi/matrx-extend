/**
 * The extension's settings register for `@ai-matrx/chat` (`prefs.knobs`): the SAME
 * `platform.knob_snapshot` ladder the web reads (organization → user), through the extension's one
 * platform-settings reader (`lib/settings/platform-knobs`).
 *
 * Without this port every knob is "not answered" and the composer's quick-start chips stay
 * skeletons forever. Writes are refused honestly: settings are edited on the web, never here.
 */

import {
  peekPlatformKnob,
  platformKnobsVersion,
  resolvePlatformKnob,
  subscribePlatformKnobs,
  warmPlatformKnobs,
} from '@/lib/settings/platform-knobs';
import type { ChatKnobRef, ChatKnobsPort } from '@ai-matrx/chat/host';
import { useEffect, useSyncExternalStore } from 'react';

function fullKeyOf(ref: ChatKnobRef): string {
  return typeof ref === 'string' ? ref : `${ref.feature}.${ref.key}`;
}

function useSessionKnob(ref: ChatKnobRef): unknown {
  const fullKey = fullKeyOf(ref);
  const value = useSyncExternalStore(
    subscribePlatformKnobs,
    () => peekPlatformKnob(fullKey),
    () => undefined,
  );
  const version = useSyncExternalStore(subscribePlatformKnobs, platformKnobsVersion, () => 0);
  useEffect(() => {
    if (value === undefined) void warmPlatformKnobs();
  }, [value, version]);
  return value;
}

export const extensionKnobs: ChatKnobsPort = {
  // The side panel has one principal (the signed-in person in the active organization).
  useEffective: (_organizationId, _userId, ref) => useSessionKnob(ref),
  useSession: useSessionKnob,
  peekSession(ref) {
    const fullKey = fullKeyOf(ref);
    const value = peekPlatformKnob(fullKey);
    if (value === undefined) void warmPlatformKnobs();
    return value;
  },
  ensure: (_organizationId, _userId, ref) => resolvePlatformKnob(fullKeyOf(ref)),
  async setOverride() {
    return {
      ok: false,
      reason: 'Settings are changed on the web',
      detail: 'the extension reads the platform settings but does not edit them',
    };
  },
};
