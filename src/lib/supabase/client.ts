/**
 * Supabase client singleton.
 *
 * The extension owns OAuth token persistence and refresh through
 * chrome.storage.local + chrome.alarms (see src/lib/auth/flow.ts). Supabase JS
 * therefore receives the current access token through its custom accessToken
 * hook instead of maintaining a second, in-memory GoTrue session. This is
 * especially important for MV3: each service-worker wake creates a new JS
 * realm, while chrome.storage.local remains the canonical session state.
 */

import { ENV, STORAGE_KEYS } from '@/config/env';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * DD-131 — the client-channel actor declaration.
 *
 * A supabase-js client cannot set a Postgres session GUC, so the actor tier
 * travels as an HTTP REQUEST HEADER. PostgREST exposes request headers to SQL
 * as `current_setting('request.headers', true)::json`; the database-side
 * carrier reads this header and stamps the row's actor tier from it, but ONLY
 * when the `app.actor_tier` GUC is unset and the session role is
 * `authenticated` (i.e. exactly the client channel this extension writes on).
 *
 * AN ABSENT HEADER MEANS A PERSON. That is the whole point, so this header must
 * NEVER be attached to the shared client — a person's own click or keystroke
 * sends nothing and is stamped `human` by the database.
 */
export const ACTOR_TIER_HEADER = 'x-matrx-actor-tier';
/** A model's turn caused this write. */
export const ACTOR_TIER_AI = 'ai';
/** This extension's OWN machinery caused this write — a scheduler claim, a
 *  background scanner, a rolling-health bookkeeping bump — not a model's turn
 *  and not a person's gesture. (DD-131, B-44.) */
export const ACTOR_TIER_CODE = 'code';

/**
 * Who caused a write.
 *
 *  - `'person'` — a human's own click or typing in the side panel. Sends NO
 *    actor header; the database stamps `human`.
 *  - `'agent'`  — a write a MODEL'S TURN caused (a tool handler running inside
 *    the browser-agent dispatcher). Sends `x-matrx-actor-tier: ai`.
 *
 * Pass this explicitly at the call site. There is deliberately no default and
 * no ambient "current actor" — the two channels are two different clients, and
 * which one a write rides is meant to be readable in the calling line.
 */
export type WriteActor = 'person' | 'agent';

let client: SupabaseClient | null = null;
let agentAuthoredClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
      const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
      return typeof token === 'string' && token.length > 0 ? token : null;
    },
    global: {
      headers: {
        'X-Client-Info': 'matrx-extend',
      },
    },
  });
  return client;
}

/**
 * The AGENT-AUTHORED client (DD-131). Same URL, same publishable key, same
 * access token as `getSupabase()` — the only difference is that every request
 * it makes carries `x-matrx-actor-tier: ai`.
 *
 * It is a SEPARATE instance on purpose: there is no way to "forget to unset"
 * the header, and no way for a person's write to pick it up. Reach for it only
 * on a path a model's turn drives.
 *
 * Throws rather than degrading: silently handing back the person's client would
 * record the agent's write as the human's, which is the exact lie this ruling
 * exists to prevent.
 */
export function getAgentAuthoredSupabase(): SupabaseClient {
  if (agentAuthoredClient) return agentAuthoredClient;
  try {
    agentAuthoredClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
      accessToken: async () => {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
        const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
        return typeof token === 'string' && token.length > 0 ? token : null;
      },
      global: {
        headers: {
          'X-Client-Info': 'matrx-extend',
          [ACTOR_TIER_HEADER]: ACTOR_TIER_AI,
        },
      },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      'The agent tried to save something, but this extension could not open the ' +
        'connection that marks a save as agent-made. Nothing was saved — saving it ' +
        'as if you had typed it yourself would be worse. Reload the extension from ' +
        `chrome://extensions and try again; if it keeps happening, sign out and back in. (${detail})`,
    );
  }
  return agentAuthoredClient;
}

let machineryAuthoredClient: SupabaseClient | null = null;

/**
 * The MACHINERY-AUTHORED client (DD-131, B-44). Same URL, same publishable
 * key, same access token as `getSupabase()` — the only difference is that
 * every request it makes carries `x-matrx-actor-tier: code`.
 *
 * Reach for it from a path the extension's OWN infrastructure drives with no
 * model's turn and no person's gesture behind it: the scheduler claiming a
 * `sch_run`, the agenda scanner firing a due task, a rolling-health bookkeeping
 * bump after a run finishes. A job is not a person and not an agent turn — it
 * is code, and the database needs to be able to tell the three apart.
 *
 * A SEPARATE instance for the same reason `getAgentAuthoredSupabase` is: there
 * is no way to "forget to unset" the header, and no way for a person's write
 * to pick it up by accident.
 *
 * Throws rather than degrading: silently handing back the person's client
 * would record the job's write as the human's.
 */
export function getMachineryAuthoredSupabase(): SupabaseClient {
  if (machineryAuthoredClient) return machineryAuthoredClient;
  try {
    machineryAuthoredClient = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
      accessToken: async () => {
        const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
        const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
        return typeof token === 'string' && token.length > 0 ? token : null;
      },
      global: {
        headers: {
          'X-Client-Info': 'matrx-extend',
          [ACTOR_TIER_HEADER]: ACTOR_TIER_CODE,
        },
      },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      'The extension\'s background machinery tried to write something, but could not ' +
        'open the connection that marks a write as machine-made. Nothing was written — ' +
        'recording it as a person\'s action would be worse. Reload the extension from ' +
        `chrome://extensions and try again; if it keeps happening, sign out and back in. (${detail})`,
    );
  }
  return machineryAuthoredClient;
}

/**
 * Pick the write channel for an explicitly-declared actor. `'person'` returns
 * the ordinary client (no actor header — absent means human).
 */
export function supabaseForActor(actor: WriteActor): SupabaseClient {
  return actor === 'agent' ? getAgentAuthoredSupabase() : getSupabase();
}

/**
 * Push a freshly acquired token into Realtime immediately. PostgREST, Storage,
 * and Functions read the canonical token from chrome.storage.local on every
 * request through the accessToken hook above.
 */
export async function setSupabaseSession(
  accessToken: string,
  _refreshToken: string,
): Promise<void> {
  const c = getSupabase();
  c.realtime.setAuth(accessToken);
}

export async function clearSupabaseSession(): Promise<void> {
  const c = getSupabase();
  c.realtime.setAuth();
}
