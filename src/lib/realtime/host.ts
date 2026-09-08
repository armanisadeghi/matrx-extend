/**
 * THE ONE realtime manager for this extension's NON-REACT contexts — the MV3
 * service worker and the offscreen document.
 *
 * `@ai-matrx/realtime` builds exactly one manager per app, and in a React app
 * `<RealtimeProvider>` builds it and PUBLISHES it (`setAmbientRealtimeManager`)
 * so non-hook owners can read it back. This extension has two kinds of context
 * and only one of them has React:
 *
 *  - The **sidepanel** is React and mounts `<RealtimeProvider>`
 *    (`src/components/RealtimeHost.tsx`). Nothing here runs there.
 *  - The **service worker** has no React at all — the frontend bridge and the
 *    scheduler host both own module-level subscriptions. This module is the
 *    provider for that context: it builds the ONE manager and publishes it
 *    through the same ambient door, so `subscribeSchedulerBroadcast` (which
 *    rides `onRealtimeManagerChange`, exactly as its matrx-frontend twin does)
 *    works here with no worker-specific branch.
 *
 * Why publishing here is not the thing the package's one-provider rule forbids:
 * a service worker is a whole JS realm of its own. This module IS that realm's
 * provider, and it is the only caller of `setAmbientRealtimeManager` outside
 * React. A SECOND manager in one realm is what costs a second write ledger —
 * which is exactly what this module exists to prevent, since before it both the
 * frontend bridge and the scheduler client were building their own channels.
 *
 * VISIBILITY IS INERT AND SAYS SO. An MV3 service worker has no `document` and
 * therefore no honest visibility signal; the offscreen document has one that is
 * permanently "hidden", which would be a lie in the other direction. So the
 * environment bridge is the package's inert one. Reconnect, backfill, and the
 * ordered handler queue all key on the socket, not on visibility, so nothing is
 * lost — and if this module is ever imported into a real document context it
 * says so out loud rather than quietly reporting a fake signal.
 */

import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import {
  type RealtimeManager,
  createInertEnvironment,
  createRealtimeManager,
  setAmbientRealtimeManager,
} from '@ai-matrx/realtime';

interface Host {
  manager: RealtimeManager;
  /** The manager's lifetime is `client` + `actorId`, per the package. */
  actorId: string | null;
}

let host: Host | null = null;
let documentWarned = false;

function warnIfDocumentContext(): void {
  if (documentWarned) return;
  if (typeof (globalThis as { document?: unknown }).document === 'undefined') return;
  documentWarned = true;
  log.warn(
    'sys',
    'realtime: worker host built inside a DOCUMENT context — its visibility bridge is inert and ' +
      'will not report tab sleep. Remedy: that context should mount <RealtimeHost> ' +
      '(src/components/RealtimeHost.tsx) instead of importing lib/realtime/host.',
  );
}

/**
 * Build (or reuse) the worker realm's manager and publish it for non-React
 * owners. Idempotent for the same `actorId`; a DIFFERENT signed-in user
 * rebuilds, because the manager's identity is part of echo suppression and a
 * stale one would classify the new user's writes wrongly.
 */
export function ensureRealtimeHost(actorId?: string | null): RealtimeManager {
  warnIfDocumentContext();
  const next = actorId ?? null;
  if (host && host.actorId === next) return host.manager;
  if (host) stopRealtimeHost();

  const manager = createRealtimeManager({
    client: getSupabase(),
    ...(next !== null && { actorId: next }),
    environment: createInertEnvironment(),
    diagnostics: (event) => {
      const line = `${event.code}: ${event.message}${event.remedy ? ` — ${event.remedy}` : ''}`;
      if (event.level === 'error' || event.level === 'warn') {
        log.warn('sys', `realtime ${line}`);
      } else {
        log.info('sys', `realtime ${line}`);
      }
    },
  });
  setAmbientRealtimeManager(manager);
  host = { manager, actorId: next };
  return manager;
}

/**
 * Drop the worker realm's manager, closing every channel it owns. Call on sign
 * out; the next `ensureRealtimeHost` builds a fresh one.
 */
export function stopRealtimeHost(): void {
  const current = host;
  host = null;
  if (!current) return;
  setAmbientRealtimeManager(null);
  current.manager.dispose();
}

/** The worker realm's manager, if one has been built. Diagnostics + tests. */
export function currentRealtimeHost(): RealtimeManager | null {
  return host?.manager ?? null;
}
