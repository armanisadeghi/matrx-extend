/**
 * The sidepanel's ONE realtime provider.
 *
 * `@ai-matrx/realtime` builds exactly one manager per app realm, and that
 * manager owns the write ledger that makes an optimistic write's own echo
 * recognizable. A second provider anywhere in the tree is a second ledger, so
 * one manager's own writes look REMOTE to the other and every one costs a
 * refetch — which is why this sits once, at the sidepanel root, above every
 * feature that opens a channel.
 *
 * Mounting it also PUBLISHES the manager through the package's ambient door, so
 * module-level owners in this same realm (the scheduler client's
 * `subscribeSchedulerBroadcast`) ride it instead of building their own.
 *
 * The service worker has no React and gets the equivalent from
 * `src/lib/realtime/host.ts`.
 *
 * `client` is the extension's ONE Supabase client. `actorId` is read straight
 * from the auth store rather than through `useAuth()` so this wrapper never
 * triggers the auth boot sequence — it only follows it.
 */

import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';
import { RealtimeProvider } from '@ai-matrx/realtime/react';
import type { ReactNode } from 'react';

export function RealtimeHost({ children }: { children: ReactNode }): React.JSX.Element {
  const userId = useAuthStore((s) => s.user?.id);

  return (
    <RealtimeProvider
      client={getSupabase()}
      actorId={userId}
      diagnostics={(event) => {
        const line = `${event.code}: ${event.message}${event.remedy ? ` — ${event.remedy}` : ''}`;
        if (event.level === 'error' || event.level === 'warn') {
          log.warn('sys', `realtime ${line}`);
        } else {
          log.info('sys', `realtime ${line}`);
        }
      }}
    >
      {children}
    </RealtimeProvider>
  );
}
