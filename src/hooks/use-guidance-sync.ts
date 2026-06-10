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
 * Mounted once at the App root, alongside the other ambient effect hooks.
 */

import { useGuidanceStore } from '@/state/guidance';
import { useAuthStore } from '@/state/auth';
import { useEffect, useRef } from 'react';

export function useGuidanceSync(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setItems = useGuidanceStore((s) => s.setItems);
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    if (syncedFor.current === userId) return;
    syncedFor.current = userId;

    let cancelled = false;
    void (async () => {
      const [{ hydrateGuidanceFromCloud }, { listAllGuidance }] = await Promise.all([
        import('@/lib/guidance/cloud-sync'),
        import('@/lib/guidance/storage'),
      ]);
      const { merged } = await hydrateGuidanceFromCloud();
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
