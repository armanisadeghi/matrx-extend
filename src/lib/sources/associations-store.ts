import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';
/**
 * The ONE `@ai-matrx/associations` store for this extension — the same package
 * and ports the web app binds (matrx-frontend
 * `features/scopes/host/associationsStore.ts`), so the filing picker lists the
 * same registered places the web app's Save panel lists.
 *
 *   dataSource — this extension's Supabase client (the demanded RPCs, under RLS)
 *   identity   — the signed-in person (LOUD when there is none) and the
 *                organization this device acts in
 *   errorSink  — the extension's log (the package also reports failures to the
 *                notifier the provider binds, so nothing is silent)
 *
 * Lazy: importing this module touches nothing.
 */
import { type AssociationsStore, createAssociationsStore } from '@ai-matrx/associations/core';

let store: AssociationsStore | null = null;

export function getAssociationsStore(): AssociationsStore {
  if (!store) {
    store = createAssociationsStore({
      // The client itself: since @ai-matrx/associations 0.14.0 the package calls through
      // @ai-matrx/data's doors (`schema('public').rpc(...)`) and pages its own edge lists.
      dataSource: getSupabase(),
      identity: {
        requireUserId: () => {
          const id = useAuthStore.getState().user?.id;
          if (!id) throw new Error('Not authenticated');
          return id;
        },
        ensureOrgId: () => requireRequestOrganizationId(),
      },
      errorSink: (event) => log.error('supabase', `associations: ${event.message}`, event),
    });
  }
  return store;
}
