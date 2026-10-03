/**
 * THE record store seam for this extension (campaign lane `W6-EXT`, contract
 * row CUT-N-11).
 *
 * Every record this extension reads or writes goes through
 * `@ai-matrx/records/core` — the platform's headless client over the record
 * store's own doors. There is no second door here and no raw table access:
 * `custom.record` is never selected, inserted, updated or deleted from this
 * repo. The package holds that line (its door table is generated from the live
 * catalogue and refuses a door the store does not have); this file only binds
 * the ports: which supabase client, which organization, which actor.
 *
 * THE CAMPAIGN SWITCH. The store is switched off at platform scope and opened
 * per organization (`platform.feature_knob` `custom/system_enabled`, with an
 * admin per-user override). `recordStoreStatus()` asks the store itself —
 * `custom.store_is_open(organization_id)` — and every caller gets one of two
 * honest answers: OPEN, or CLOSED with the sentence to put on a screen. There
 * is no third state where the feature quietly does nothing (law 4).
 *
 * WHO IS ACTING. AGT-N-4: an agent carries the exact authority of the person
 * operating it. A tool turn therefore binds `actor: 'agent'` with
 * `on_behalf_of` set to the signed-in person AND rides the agent-authored
 * supabase client (DD-131), so the store and the platform's actor-tier header
 * tell the same story. A person's own click binds `actor: 'user'`.
 *
 * ⚠️ TEMPORARY DEPENDENCY REFERENCE. `@ai-matrx/records` is not on npm yet — a
 * brand-new package needs the one-time 2FA bootstrap publish. Until then it
 * resolves through a path alias to the package's source in the sibling aidream
 * checkout (`tsconfig.json` `paths`, `wxt.config.ts` and `vitest.config.ts`
 * `resolve.alias`). THE SWAP, when it publishes, is one line in package.json —
 *     "@ai-matrx/records": "latest",
 * — plus deleting those three alias entries. Nothing else in this repo changes.
 */

import { STORAGE_KEYS } from '@/config/env';
import { getActiveOrganizationId, listMemberOrganizations } from '@/lib/org/active-org';
import { getAgentAuthoredSupabase, getSupabase } from '@/lib/supabase/client';
import {
  type RecordsClient,
  type RecordsDataSource,
  createRecordsClient,
} from '@ai-matrx/records/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Who a call is for: a person's own action, or a turn the agent is driving. */
export type RecordActor = 'user' | 'agent';

/**
 * The store's answer about itself. `open: false` always carries the sentence a
 * screen or a tool result shows — never a bare boolean nobody can explain.
 */
export interface RecordStoreStatus {
  open: boolean;
  organizationId: string | null;
  /** Present whenever `open` is false. The reason, in words, with the remedy. */
  reason?: string;
}

/**
 * supabase-js answers `rpc(fn, args, {head,get,count})`; the package's port
 * answers `rpc(fn, args, {schema})` because two of its doors belong to the
 * platform's `iam` schema rather than the store's. The adapter routes that
 * option to `client.schema(...).rpc(...)` — a host that ignored it would call
 * the wrong schema and get refused by name, which is the failure the port's
 * comment says it wants.
 */
function dataSourceFor(client: SupabaseClient): RecordsDataSource {
  return {
    rpc(fn, args, options) {
      if (options?.schema) {
        // biome-ignore lint/suspicious/noExplicitAny: supabase-js types the
        // schema string against generated Database types this repo does not
        // generate for `custom`/`iam`; the door name is checked by the package.
        return (client.schema(options.schema as any) as any).rpc(fn, args);
      }
      // biome-ignore lint/suspicious/noExplicitAny: same reason — the door
      // catalogue, not a generated type, is what says this name exists.
      return (client as any).rpc(fn, args);
    },
    schema(name) {
      // biome-ignore lint/suspicious/noExplicitAny: see above.
      return (client as any).schema(name);
    },
  };
}

async function signedInUserId(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.USER_PROFILE]);
  const profile = stored[STORAGE_KEYS.USER_PROFILE] as { id?: string } | undefined;
  return typeof profile?.id === 'string' && profile.id.length > 0 ? profile.id : undefined;
}

/**
 * Build the client for one organization and one actor. Every call site goes
 * through here; nobody constructs a second one with different ports.
 */
export async function recordsClientFor(
  organizationId: string,
  actor: RecordActor,
  /** EVERY organization the person belongs to: with it the package's reads span them all. */
  organizationIds?: readonly string[],
): Promise<RecordsClient> {
  const userId = await signedInUserId();
  const supabase = actor === 'agent' ? getAgentAuthoredSupabase() : getSupabase();
  return createRecordsClient({
    dataSource: dataSourceFor(supabase),
    organizationId,
    ...(organizationIds ? { organizationIds } : {}),
    actor: {
      actor,
      ...(userId ? { user_id: userId } : {}),
      // Only an agent acts on behalf of a person; the store refuses it otherwise.
      ...(actor === 'agent' && userId ? { on_behalf_of: userId } : {}),
    },
  });
}

/**
 * Is the record store open for the organization this install is acting in?
 * Asked of the store, every time — never cached into a stale "it was on when
 * the sidepanel loaded".
 */
export async function recordStoreStatus(actor: RecordActor = 'user'): Promise<RecordStoreStatus> {
  const organizationId = await getActiveOrganizationId();
  if (!organizationId) {
    return {
      open: false,
      organizationId: null,
      reason:
        'No organization is selected, and records belong to an organization. Choose one in Settings and try again.',
    };
  }
  const client = await recordsClientFor(organizationId, actor);
  const result = await client.storeIsOpen();
  if (!result.ok) {
    return {
      open: false,
      organizationId,
      reason: `${result.error.message}${result.error.hint ? ` ${result.error.hint}` : ''}`,
    };
  }
  if (!result.data) {
    return {
      open: false,
      organizationId,
      reason:
        'The custom data store is switched off for this organization. An administrator turns it on for the organization; until then this organization keeps its existing datasets.',
    };
  }
  return { open: true, organizationId };
}

/**
 * The store, ready to use, or the reason it is not — in one call, so no caller
 * can forget the switch. A refusal here is a sentence, not a null.
 */
export async function openRecordStore(
  actor: RecordActor = 'user',
): Promise<
  { open: true; client: RecordsClient; organizationId: string } | { open: false; reason: string }
> {
  const status = await recordStoreStatus(actor);
  if (!status.open || !status.organizationId) {
    return { open: false, reason: status.reason ?? 'The custom data store is not available.' };
  }
  return {
    open: true,
    client: await recordsClientFor(status.organizationId, actor),
    organizationId: status.organizationId,
  };
}

/**
 * The package's across-organizations doors this extension uses, typed locally because the
 * currently published `@ai-matrx/records` (0.58.117) predates them: `organizationsOpen`,
 * `ownerOrganization`, and the spanning `metadataSearch` / `recordAggregate` (source:
 * aidream `apps/shared/records`, commit "metadata search, aggregate and owner lookup span
 * every organization"). THE SWAP, once that version is published: make `SpanningClient` plain
 * `RecordsClient` and delete `withSpanningDoors` — nothing else changes.
 */
export interface SpanningDoors {
  organizationsOpen(args?: { organization_id?: string | null }): Promise<
    | {
        ok: true;
        data: { open: string[]; unavailable: { organization_id: string; reason: string }[] };
      }
    | { ok: false; error: RecordsErrorLike }
  >;
  ownerOrganization(args: {
    table_id?: string | null;
    record_id?: string | null;
    organization_id?: string | null;
  }): Promise<{ ok: true; data: string | null } | { ok: false; error: RecordsErrorLike }>;
  metadataSearch(args: { text: string; organization_id?: string | null }): Promise<
    | {
        ok: true;
        data: {
          matches: Record<string, unknown>[];
          organizations_covered: string[];
          unavailable: { organization_id: string; reason: string }[];
        };
      }
    | { ok: false; error: RecordsErrorLike }
  >;
  recordAggregate: RecordsClient['recordAggregate'];
}
type RecordsErrorLike = { code: string; message: string; hint?: string };
export type SpanningClient = Omit<RecordsClient, 'metadataSearch' | 'recordAggregate'> &
  SpanningDoors;

const reasonOf = (e: RecordsErrorLike) => `${e.message}${e.hint ? ` ${e.hint}` : ''}`;

/**
 * Until the published package carries the doors above, answer them from the ones it has, one
 * organization's own client at a time (same semantics as the package: unavailable
 * organizations named with their reason, the owner found among the person's own). When the
 * client already has them this returns it untouched.
 */
function withSpanningDoors(
  client: RecordsClient,
  organizationIds: string[],
  actor: RecordActor,
): SpanningClient {
  if (typeof (client as unknown as Partial<SpanningDoors>).organizationsOpen === 'function') {
    return client as unknown as SpanningClient;
  }
  const scope = (filter?: string | null) => (filter ? [filter] : organizationIds);
  const organizationsOpen: SpanningDoors['organizationsOpen'] = async (args) => {
    const orgs = scope(args?.organization_id);
    const answers = await Promise.all(
      orgs.map(async (id) => ({
        id,
        status: await (await recordsClientFor(id, actor)).storeIsOpen(),
      })),
    );
    const open: string[] = [];
    const unavailable: { organization_id: string; reason: string }[] = [];
    for (const { id, status } of answers) {
      if (!status.ok) unavailable.push({ organization_id: id, reason: reasonOf(status.error) });
      else if (!status.data)
        unavailable.push({
          organization_id: id,
          reason: 'The custom data store is switched off for this organization.',
        });
      else open.push(id);
    }
    return { ok: true, data: { open, unavailable } };
  };
  const ownerOrganization: SpanningDoors['ownerOrganization'] = async (args) => {
    if (args.table_id) {
      const read = await client.tableRead({
        table_id: args.table_id,
        ...(args.organization_id ? { organization_id: args.organization_id } : {}),
      });
      return read.ok ? { ok: true, data: read.data?.organization_id ?? null } : read;
    }
    if (args.record_id) {
      for (const id of scope(args.organization_id)) {
        const read = await (await recordsClientFor(id, actor)).recordRead({
          record_id: args.record_id,
        });
        if (read.ok) return { ok: true, data: id };
      }
    }
    return { ok: true, data: null };
  };
  const metadataSearch: SpanningDoors['metadataSearch'] = async ({ text, organization_id }) => {
    const state = await organizationsOpen(organization_id ? { organization_id } : undefined);
    if (!state.ok) return state;
    const { open, unavailable } = state.data;
    const matches: Record<string, unknown>[] = [];
    const covered: string[] = [];
    let first: RecordsErrorLike | null = null;
    for (const id of open) {
      const found = await (await recordsClientFor(id, actor)).metadataSearch({ text });
      if (!found.ok) {
        first ??= found.error;
        unavailable.push({ organization_id: id, reason: reasonOf(found.error) });
        continue;
      }
      covered.push(id);
      for (const m of found.data as unknown as Record<string, unknown>[]) {
        matches.push({ ...m, organization_id: id });
      }
    }
    if (covered.length === 0 && first) return { ok: false, error: first };
    return { ok: true, data: { matches, organizations_covered: covered, unavailable } };
  };
  const recordAggregate: SpanningDoors['recordAggregate'] = async ({
    organization_id,
    ...rest
  }) => {
    const owner = await ownerOrganization({
      table_id: rest.table_id,
      ...(organization_id ? { organization_id } : {}),
    });
    const target = owner.ok && owner.data ? owner.data : (organization_id ?? null);
    const home = target ? await recordsClientFor(target, actor) : client;
    const result = await home.recordAggregate(rest);
    return result.ok
      ? {
          ok: true,
          data: result.data.map((r) => ({
            ...r,
            organization_id: target,
          })),
        }
      : result;
  };
  return Object.assign(Object.create(client), {
    organizationsOpen,
    ownerOrganization,
    metadataSearch,
    recordAggregate,
  }) as SpanningClient;
}

/**
 * THE PACKAGE'S OWN ACROSS-ORGANIZATIONS CLIENT (`@ai-matrx/records` `config.organizationIds`):
 * every read answers for every organization the person belongs to (membership from
 * `mbr_for_user`, never the active org alone); a table or record opens in its own organization;
 * `organizationsOpen` names each organization that cannot answer WITH its reason.
 * `organizationId` stays the write destination (the active one, else the first).
 */
export async function openSpanningClient(
  actor: RecordActor = 'user',
): Promise<{ client: SpanningClient; organizationIds: string[] }> {
  const organizationIds = (await listMemberOrganizations('active')).map((o) => o.id);
  const organizationId = (await getActiveOrganizationId()) ?? organizationIds[0];
  if (!organizationId) throw new Error('You do not belong to an organization yet.');
  const client = await recordsClientFor(organizationId, actor, organizationIds);
  return { client: withSpanningDoors(client, organizationIds, actor), organizationIds };
}
