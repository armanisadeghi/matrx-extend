/**
 * Reads the organization's choice for privileged and ask-user tools called by a desktop app
 * (`DesktopPrivilegedPolicy`, ./tier-policy.ts). Organization knob
 * `extension.desktop_callers.privileged_tools`; absent, unreadable or unknown → `ask`.
 */

import { resolvePlatformKnobInWorker } from '@/lib/settings/platform-knob-snapshot';
import { DEFAULT_DESKTOP_PRIVILEGED_POLICY, type DesktopPrivilegedPolicy } from './tier-policy';

export const DESKTOP_PRIVILEGED_KNOB = 'extension.desktop_callers.privileged_tools';

export async function readDesktopPrivilegedPolicy(): Promise<DesktopPrivilegedPolicy> {
  const value = await resolvePlatformKnobInWorker(DESKTOP_PRIVILEGED_KNOB);
  if (value === 'ask' || value === 'follow_act_without_asking') return value;
  if (value !== undefined) {
    console.error(
      `[matrx-settings] ${DESKTOP_PRIVILEGED_KNOB} has an unknown value (${JSON.stringify(value)}) — asking the person first.`,
    );
  }
  return DEFAULT_DESKTOP_PRIVILEGED_POLICY;
}
