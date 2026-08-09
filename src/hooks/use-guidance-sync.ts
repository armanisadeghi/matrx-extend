/**
 * Guidance cloud sync — hydrate on sign-in (TASK-004).
 *
 * When a user is signed in, pull their guidance metadata from the cloud
 * (`wbx_guidance`) into the local chrome.storage.local cache so guidance
 * created on another machine shows up here. Runs once per signed-in user per
 * sidepanel lifetime. Writes flow the other way automatically — every
 * saveGuidanceItem / deleteGuidanceItem best-effort mirrors to the cloud (see
 * src/lib/guidance/storage.ts).
 *
 * Demo BODIES hydrate in the same pass (`extend.wbx_demo`). They ride along
 * deliberately: a guidance `demo_ref` is a pointer, so hydrating the ref
 * without the body is exactly the failure this pairing exists to prevent —
 * a listed workflow that cannot replay. Both must succeed before the
 * once-per-user latch closes.
 *
 * Mounted once at the App root, alongside the other ambient effect hooks.
 */

import { useAuthStore } from '@/state/auth';
import { useGuidanceStore } from '@/state/guidance';
import { useEffect, useRef } from 'react';

export function useGuidanceSync(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setItems = useGuidanceStore((s) => s.setItems);
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    if (syncedFor.current === userId) return;

    let cancelled = false;
    void (async () => {
      const [{ hydrateGuidanceFromCloud }, { hydrateDemosFromCloud }, { listAllGuidance }] =
        await Promise.all([
          import('@/lib/guidance/cloud-sync'),
          import('@/lib/demos/cloud-sync'),
          import('@/lib/guidance/storage'),
        ]);
      // Demos first: a demo_ref that lands before its body is the exact
      // "listed but un-replayable" state this sync exists to eliminate.
      const demos = await hydrateDemosFromCloud();
      const { merged, ok } = await hydrateGuidanceFromCloud();
      // Latch only on SUCCESS — marking the sync done before/despite a
      // failed fetch meant guidance from other machines never appeared for
      // the rest of the session even after connectivity returned.
      if (ok && demos.ok && !cancelled) syncedFor.current = userId;
      if (cancelled || merged === 0) return;
      // Refresh any open Guidance tab from the now-updated cache.
      const list = await listAllGuidance();
      if (!cancelled) setItems(list);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, setItems]);
}
