/**
 * THE ONE agent catalog for this extension.
 *
 * There is ONE agent picker on this platform and it lives in
 * `@ai-matrx/agents/catalog` — the row set, the tabs, the sort, the filters,
 * the favourites, the search and the mandate-resolved default row are all the
 * package's. This module is nothing but the host wiring the package's ports
 * demand: WHO is asking (identity), WHAT client answers the RPCs, WHICH
 * transport reaches the aidream mandate door, and WHERE failures are announced.
 *
 * Never add list, filter or sort logic here. A behaviour this extension needs
 * and the package does not have is a package change (THE SAME-SESSION LAW),
 * never a fork in host code.
 *
 * Storage: the package's `storage` port is SYNCHRONOUS (`getItem`/`setItem`
 * returning a string), and `chrome.storage.local` is async-only, so there is no
 * adapter to write. The package default (`localStorage` in every extension
 * page, an in-memory map in the service worker) is what runs — the default-row
 * first-paint cache is per-extension-origin and survives reloads exactly the
 * same way. Announced here rather than left to be rediscovered.
 */

import { buildHeaders, getApiBaseUrl } from '@/lib/api/client';
import { log } from '@/lib/debug/log';
import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';
import {
  type AgentCatalog,
  type AgentCatalogClient,
  type AgentCatalogTransport,
  createAgentCatalog,
} from '@ai-matrx/agents/catalog';

/**
 * The Mandate door, reached through the extension's ONE header path
 * (`buildHeaders` in lib/api/client.ts) so this request carries the same
 * bearer token, guest fingerprint and `X-Organization-Id` as every other
 * backend call. 🚨 Clients never walk the mandate ladder themselves (D-R1) —
 * the package asks the server and the server answers.
 */
const catalogTransport: AgentCatalogTransport = {
  async fetch(path, init) {
    const baseUrl = await getApiBaseUrl();
    const headers = await buildHeaders(init.headers);
    return fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined && { body: init.body }),
      ...(init.signal !== undefined && { signal: init.signal }),
    });
  },
};

let catalog: AgentCatalog | null = null;

/**
 * The catalog singleton. Built lazily: `getSupabase()` reads env at first
 * call, and a module-load client would break the catalog scripts that import
 * every module under `tsx` with no `chrome.*` and no env.
 */
export function getAgentCatalog(): AgentCatalog {
  if (catalog) return catalog;
  catalog = createAgentCatalog({
    client: getSupabase() as unknown as AgentCatalogClient,
    identity: {
      /**
       * Throws when signed out — and that is correct. The package catches this
       * in exactly one place (the "which tab do we open on" heuristic, where a
       * guest legitimately lands on the public catalogue) and reports it once.
       * The extension deliberately serves guests: `agx_agent_builtin_read` lets
       * the anon role read active builtin agents, so a signed-out panel still
       * shows a real list. No host-side branch on sign-in state.
       */
      requireUserId: () => {
        const id = useAuthStore.getState().user?.id;
        if (!id) throw new Error('matrx-extend: no signed-in user');
        return id;
      },
    },
    transport: catalogTransport,
    errorSink: (event) => {
      log.error('sys', `[agent-catalog] ${event.code}: ${event.message}`, event.context);
    },
    notifier: (event) => {
      // The extension has no toast system; the Debug tab's event stream IS its
      // notification surface. The package's persistent in-picker banner stays
      // the primary scream either way — this is the second channel, not the
      // only one.
      const line = `[agent-catalog] ${event.title}: ${event.message}`;
      if (event.level === 'error') log.error('sys', line);
      else log.warn('sys', line);
    },
  });
  return catalog;
}
