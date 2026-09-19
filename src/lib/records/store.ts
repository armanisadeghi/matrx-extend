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

import { getAgentAuthoredSupabase, getSupabase } from '@/lib/supabase/client';
import { STORAGE_KEYS } from '@/config/env';
import { getActiveOrganizationId } from '@/lib/org/active-org';
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
): Promise<RecordsClient> {
  const userId = await signedInUserId();
  const supabase = actor === 'agent' ? getAgentAuthoredSupabase() : getSupabase();
  return createRecordsClient({
    dataSource: dataSourceFor(supabase),
    organizationId,
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
