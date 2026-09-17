/**
 * The "needs your browser" queue — the extension's read of
 * `media.capture_handoff` (CONTRACT.md §3 and §7.1).
 *
 * WHY THE CLIENT READS THE TABLE DIRECTLY. There is no outbound channel from
 * aidream to the extension — no server push, no server WebSocket
 * (`common-docs/systems/clients/extension/CHANNELS.md` §2). The durable row IS
 * the channel: the server writes it, every client watches it. Reads come
 * straight from Supabase (RLS-scoped, org-filtered); every WRITE goes back
 * through `/capture/*` (see `api.ts`).
 *
 * WHY THERE IS A POLL FLOOR. Realtime has no replay and an MV3 side panel is
 * opened and closed constantly, so anything queued while the socket was away
 * is simply never delivered. A dropped socket with no floor is the worst
 * possible failure for this surface: an EMPTY tray that looks exactly like
 * "nothing needs you". So the subscription is an accelerator on top of a poll,
 * never a replacement for one — and when the socket is not carrying,
 * `subscribeNeedsYou` SAYS SO through `health`/`note` rather than quietly
 * running slower (law 4).
 */

import { type Handoff, NEEDS_YOU_STATUSES, handoffSchema } from '@/lib/capture-ladder/types';
import { log } from '@/lib/debug/log';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { failDbCall } from '@/lib/supabase/db-failure';
import { mediaDb } from '@/lib/supabase/schemas';
import type { ChannelHandle } from '@ai-matrx/realtime';
import { defineChannelNamespace, onRealtimeManagerChange } from '@ai-matrx/realtime';

/**
 * ONE PLACE NAMES THE CHANNEL. supabase-js dedupes channels by topic, so two
 * surfaces that both picked `"capture"` would silently share one channel and
 * lose each other's bindings; `@ai-matrx/realtime` closes that off with a
 * declared namespace, which only works if the declaration lives in one module.
 */
const captureHandoffChannel = defineChannelNamespace({
  namespace: 'extend-capture-handoff',
  parts: ['organizationId'],
  description: 'media.capture_handoff rows for one organization (extension tray)',
});

/** The floor. A socket that is up only ever makes this faster, never optional. */
export const DEFAULT_POLL_FLOOR_MS = 60_000;

const SITE = {
  table: 'media.capture_handoff',
  operation: 'select',
  what: 'check which pages need your browser',
  title: 'Capture list unavailable',
} as const;

/**
 * Every handoff waiting on this browser, for the ACTIVE organization only.
 * `waiting` = rung 3 has not run yet; `needs_drive` = rung 3 ran and failed,
 * and the person is being asked.
 *
 * A database refusal is never turned into an empty list: `[]` here is a
 * sentence about the user's data ("nothing needs you") that the database never
 * said, and acting on it would hide real work. `failDbCall` announces and
 * throws instead.
 */
export async function listNeedsYou(): Promise<Handoff[]> {
  const organizationId = await getActiveOrganizationId();
  if (!organizationId) {
    failDbCall(SITE, { code: 'NO_ORGANIZATION', message: 'no organization selected' });
  }
  const { data, error } = await mediaDb()
    .from('capture_handoff')
    .select('*')
    .eq('organization_id', organizationId)
    .in('status', [...NEEDS_YOU_STATUSES])
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) failDbCall(SITE, error);

  const rows: Handoff[] = [];
  for (const raw of data ?? []) {
    const parsed = handoffSchema.safeParse(raw);
    if (parsed.success) {
      rows.push(parsed.data);
      continue;
    }
    // A row we cannot read is not a row we drop silently: it is one the server
    // wrote in a shape this build does not know, and the person should be able
    // to find out why a page never appeared.
    log.warn('scrape', 'capture handoff row did not match the contract — skipped', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return rows;
}

/** How many pages need this browser right now. Same read, same refusal rules. */
export async function countNeedsYou(): Promise<number> {
  return (await listNeedsYou()).length;
}

/** What a subscriber is handed on every update. */
export interface NeedsYouUpdate {
  items: Handoff[];
  count: number;
  /**
   * `live` — the realtime socket is carrying, so changes land in about a
   * second. `degraded` — it is not, and this tray is only as fresh as the poll
   * floor. Never silently one while claiming the other.
   */
  health: 'live' | 'degraded';
  /** A sentence for the person whenever `health` is `degraded`; else null. */
  note: string | null;
  /** Set when the read itself failed; `items` is then the last known list. */
  error: string | null;
}

export interface SubscribeOptions {
  /** The poll floor. Default 60s. Never disabled — see the module note. */
  pollMs?: number;
}

/**
 * Watch the queue. Calls back immediately with the current list, then on every
 * Postgres change and on every poll tick.
 *
 * Returns an unsubscribe function. Safe to call before an organization is
 * selected: the first read reports the refusal and the poll keeps trying, so
 * the tray recovers by itself once the person picks an organization.
 */
export function subscribeNeedsYou(
  cb: (update: NeedsYouUpdate) => void,
  options: SubscribeOptions = {},
): () => void {
  const pollMs = Math.max(1_000, options.pollMs ?? DEFAULT_POLL_FLOOR_MS);
  let stopped = false;
  let handle: ChannelHandle | null = null;
  let lastItems: Handoff[] = [];
  let socketLive = false;

  const degradedNote = (): string =>
    'Live updates are not connected right now, so this list refreshes about every ' +
    `${Math.round(pollMs / 1000)} seconds instead of instantly. Anything already here is real.`;

  const emit = (error: string | null): void => {
    if (stopped) return;
    cb({
      items: lastItems,
      count: lastItems.length,
      health: socketLive ? 'live' : 'degraded',
      note: socketLive ? null : degradedNote(),
      error,
    });
  };

  const refresh = (): void => {
    void listNeedsYou()
      .then((items) => {
        lastItems = items;
        emit(null);
      })
      .catch((err: unknown) => {
        // `failDbCall` has already announced this to the person and recorded
        // it. The tray still must stop claiming the last list is current.
        emit(err instanceof Error ? err.message : String(err));
      });
  };

  const stopManagerWatch = onRealtimeManagerChange((manager) => {
    if (handle) {
      handle.close();
      handle = null;
    }
    socketLive = false;
    if (!manager || stopped) {
      emit(null);
      return;
    }
    void getActiveOrganizationId().then((organizationId) => {
      if (stopped || !organizationId) {
        emit(null);
        return;
      }
      handle = manager.open({
        topic: captureHandoffChannel.topic({ organizationId }),
        postgresChanges: [
          {
            event: '*',
            schema: 'media',
            table: 'capture_handoff',
            filter: `organization_id=eq.${organizationId}`,
            rowId: (row) => (typeof row.id === 'string' ? row.id : undefined),
            fingerprint: (row) => `${String(row.status)}|${String(row.rung)}`,
            onChange: () => refresh(),
          },
        ],
        // Realtime has no replay. Everything queued while this panel was shut
        // or the socket was away is gone; re-read rather than trust the screen.
        onBackfill: () => refresh(),
        onStatusChange: (status) => {
          const nowLive = status === 'connected';
          if (nowLive === socketLive) return;
          socketLive = nowLive;
          log.info('scrape', `capture-handoff realtime ${status}`);
          emit(null);
        },
      });
    });
  });

  const timer = setInterval(refresh, pollMs);
  refresh();

  return () => {
    stopped = true;
    clearInterval(timer);
    stopManagerWatch();
    if (handle) {
      handle.close();
      handle = null;
    }
  };
}
