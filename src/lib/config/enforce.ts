/**
 * Stored app config that changes what the person sees (side panel): the `notice` is shown, the
 * `min_supported_app_version` floor is enforced loudly. (`flags` gate behaviour at their call sites via appFlag.)
 * Every read goes through the counted door in ./index.
 */
import { pushNotice } from '@/state/notices';
import pkg from '../../../package.json';
import {
  appConfigNotice,
  appConfigVersionFloor,
  countConfigEvent,
  onAppConfigChange,
} from './index';

export function versionLess(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

const shown = new Set<string>();

export function applyStoredAppConfig(): void {
  const notice = appConfigNotice();
  if (notice) {
    const id = `${notice.level}|${notice.title}|${notice.body}`;
    if (!shown.has(id)) {
      shown.add(id);
      pushNotice({
        tone:
          notice.level === 'critical' ? 'error' : notice.level === 'warning' ? 'warning' : 'info',
        title: notice.title,
        message: notice.body,
      });
    }
  }
  const floor = appConfigVersionFloor();
  if (floor && versionLess(pkg.version, floor)) {
    const id = `floor|${floor}`;
    if (!shown.has(id)) {
      shown.add(id);
      countConfigEvent(
        'config.build_below_min_supported_version',
        { version: pkg.version, floor },
        'error',
      );
      pushNotice({
        tone: 'error',
        title: 'This version of Matrx Extend is out of date',
        message: `Your version (${pkg.version}) is older than the minimum supported (${floor}). Update the extension from the Chrome Web Store; some features may not work until you do.`,
      });
    }
  }
}

/** Side panel boot: apply now, and again whenever a live read changes the row. */
export function startAppConfigEnforcement(): () => void {
  applyStoredAppConfig();
  return onAppConfigChange(applyStoredAppConfig);
}
