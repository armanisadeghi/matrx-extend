/**
 * DEBUG MODE — the one door to every admin surface in the side panel.
 *
 * An admin sees exactly what a normal user sees, plus one "Debug" item in the
 * avatar menu. Turning it on shows the admin tabs (Debug, Pilot, Showcase,
 * Token broker…) and every admin-only option; turning it off hides them all
 * again (Arman, 2026-10-24). Remembered across panel reopens and restarts.
 *
 * This is display only. Execution-time admin gates read the verified role
 * (`lib/auth/is-admin.ts`), never this switch.
 */

import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { useAuthStore } from '@/state/auth';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface DebugModeState {
  on: boolean;
  toggle: () => void;
}

export const useDebugModeStore = create<DebugModeState>()(
  persist(
    (set) => ({
      on: false,
      toggle: () => set((s) => ({ on: !s.on })),
    }),
    { name: 'matrx.store.debug-mode', storage: createJSONStorage(() => chromeLocalStorage) },
  ),
);

/** Admin surfaces show only for a verified admin who turned Debug on. */
export function useShowAdmin(): boolean {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const on = useDebugModeStore((s) => s.on);
  return isAdmin && on;
}

/** The same answer outside React (request builders read it at send time). */
export function showAdminNow(): boolean {
  return useAuthStore.getState().isAdmin && useDebugModeStore.getState().on;
}
