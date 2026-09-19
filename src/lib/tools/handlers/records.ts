/**
 * `records` — the browser agent's hands on this organization's custom records
 * (campaign lane `W6-EXT`, contract row CUT-N-11).
 *
 * ONE TOOL, ONE CONTRACT, TWO EXECUTORS. The platform already declares
 * `records` with exactly eight actions (AGT-N-3; the server half lives in
 * aidream `packages/matrx-records`). This file is the SAME tool executed in the
 * browser, so a turn that is already here — on the page the person is looking
 * at — does not have to bounce through the server to read or write a record.
 * The eight action names, their arguments and their meanings are copied from
 * that contract on purpose; a ninth action here would be a second contract.
 *
 * EVERY CALL GOES THROUGH THE STORE'S DOORS. `@ai-matrx/records/core` is the
 * only thing this file talks to, and that package talks only to the store's
 * doors — `custom.record` is never read or written directly from this repo.
 *
 * THE SWITCH IS IN FRONT OF ALL EIGHT. The store is off at platform scope and
 * opened per organization. Every action asks first (`custom.store_is_open`) and
 * a closed store answers with the store's own sentence and the remedy — never
 * an empty list, never a silent no-op (law 4).
 *
 * WHOSE AUTHORITY. AGT-N-4: the agent has exactly the authority of the person
 * operating it. There is no `organization_id` and no `user_id` argument here on
 * purpose — a model naming whose records to read is the vulnerability that rule
 * closes. Both come from this install's session and its active organization.
 */

import { openRecordStore } from '@/lib/records/store';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

/** The eight, in one place, so the tool body and the tier map count the same things. */
const RECORD_ACTIONS = [
  'table_list',
  'metadata_search',
  'record_read',
  'record_aggregate',
  'record_write',
  'record_delete',
  'field_propose',
  'table_propose',
] as const;

const READ_ACTIONS = new Set<string>([
  'table_list',
  'metadata_search',
  'record_read',
  'record_aggregate',
]);

const RecordsArgs = z
  .object({
    action: z.enum(RECORD_ACTIONS),
    /** table_list / metadata_search / record_aggregate */
    limit: z.number().int().min(1).max(500).default(50),
    /** metadata_search */
    query: z.string().optional(),
    /** record_read / record_write / record_delete */
    record_id: z.string().uuid().optional(),
    /** record_read — the id is the record's own id rather than a token. */
    id_keyed: z.boolean().default(false),
    /** record_aggregate / record_write / field_propose / table_propose */
    table_id: z.string().uuid().optional(),
    /** record_aggregate */
    measure: z.string().default('count'),
    group_by: z.string().optional(),
    field_key: z.string().optional(),
    /** record_write — the document, keyed by field key. */
    values: z.record(z.unknown()).optional(),
    /** record_write — opt-in compare-and-swap; absent is last-writer-wins. */
    expected_version: z.number().int().optional(),
    /** record_delete — restore instead of delete. */
    undo: z.boolean().default(false),
    /** field_propose / table_propose */
    name: z.string().optional(),
    label: z.string().optional(),
    description: z.string().default(''),
    field_type: z.string().default('text'),
    sensitivity: z.string().default('internal'),
    context_policy: z.string().default('include'),
    spec: z.record(z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    const need = (key: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `records.${v.action} requires \`${key}\``,
        path: [key],
      });
    if (v.action === 'metadata_search' && !v.query) need('query');
    if (v.action === 'record_read' && !v.record_id) need('record_id');
    if (v.action === 'record_aggregate' && !v.table_id) need('table_id');
    if (v.action === 'record_delete' && !v.record_id) need('record_id');
    if (v.action === 'record_write' && !v.values) need('values');
    if (v.action === 'record_write' && !v.table_id && !v.record_id) need('table_id');
    if (v.action === 'field_propose' && (!v.table_id || !v.name)) need('table_id` and `name');
    if (v.action === 'table_propose' && !v.name) need('name');
  });

type RecordsToolArgs = z.infer<typeof RecordsArgs>;

/**
 * A refusal the store made, handed on verbatim. The store's own words are the
 * remedy — the tool never paraphrases them and never turns one into an empty
 * success.
 */
function refused(where: string, error: { code: string; message: string; hint?: string }) {
  return {
    ok: false as const,
    action: where,
    reason: error.message,
    ...(error.hint ? { hint: error.hint } : {}),
    code: error.code,
  };
}

const records: ToolHandler<RecordsToolArgs, unknown> = {
  name: 'records',
  tier: 'action',
  tierFor: (args): ToolTier => (READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  argsSchema: RecordsArgs,
  run: async (args) => {
    const opened = await openRecordStore('agent');
    if (!opened.open) return { ok: false, action: args.action, reason: opened.reason };
    const { client } = opened;

    switch (args.action) {
      case 'table_list': {
        const result = await client.tableList();
        if (!result.ok) return refused('table_list', result.error);
        const tables = result.data.slice(0, args.limit).map((table) => ({
          id: table.id,
          slug: table.slug,
          name: table.name,
          type: table.type,
          agent_writable: table.agent_writable,
        }));
        return { ok: true, action: 'table_list', tables, count: tables.length };
      }
      case 'metadata_search': {
        const result = await client.metadataSearch({ text: args.query as string });
        if (!result.ok) return refused('metadata_search', result.error);
        return { ok: true, action: 'metadata_search', matches: result.data };
      }
      case 'record_read': {
        const result = await client.recordRead({ record_id: args.record_id as string });
        if (!result.ok) return refused('record_read', result.error);
        return {
          ok: true,
          action: 'record_read',
          record_id: args.record_id,
          values: result.data.document,
          hidden: result.data.hidden,
        };
      }
      case 'record_aggregate': {
        const result = await client.recordAggregate({
          table_id: args.table_id as string,
          ...(args.group_by ? { groupBy: [args.group_by] } : {}),
          ...(args.measure !== 'count'
            ? { measures: [{ operation: args.measure, key: args.field_key ?? null }] as never }
            : {}),
          limit: args.limit,
        });
        if (!result.ok) return refused('record_aggregate', result.error);
        return { ok: true, action: 'record_aggregate', rows: result.data };
      }
      case 'record_write': {
        // One verb, two doors, decided by whether the record already exists —
        // the same split the server half makes, so a model writes the same way
        // wherever the turn happens to be running.
        if (args.record_id) {
          const result = await client.recordUpdate({
            record_id: args.record_id,
            patch: args.values as Record<string, unknown>,
            ...(args.expected_version !== undefined
              ? { expectedVersion: args.expected_version }
              : {}),
          });
          if (!result.ok) return refused('record_write', result.error);
          return {
            ok: true,
            action: 'record_write',
            record_id: args.record_id,
            version: result.data,
            wrote: 'update',
          };
        }
        const result = await client.recordWrite({
          table_id: args.table_id as string,
          data: args.values as Record<string, unknown>,
        });
        if (!result.ok) return refused('record_write', result.error);
        return { ok: true, action: 'record_write', record_id: result.data, wrote: 'create' };
      }
      case 'record_delete': {
        if (args.undo) {
          const result = await client.recordRestore({ record_id: args.record_id as string });
          if (!result.ok) return refused('record_delete', result.error);
          return { ok: true, action: 'record_delete', record_id: args.record_id, restored: true };
        }
        const result = await client.recordDelete({ record_id: args.record_id as string });
        if (!result.ok) return refused('record_delete', result.error);
        return {
          ok: true,
          action: 'record_delete',
          record_id: args.record_id,
          deleted_at: result.data,
        };
      }
      case 'field_propose': {
        const result = await client.fieldPropose({
          table_id: args.table_id as string,
          name: args.name as string,
          field_type: args.field_type,
          label: args.label ?? null,
          description: args.description,
          sensitivity: args.sensitivity,
          context_policy: args.context_policy,
        } as never);
        if (!result.ok) return refused('field_propose', result.error);
        return { ok: true, action: 'field_propose' };
      }
      case 'table_propose': {
        const result = await client.tablePropose({
          name: args.name as string,
          description: args.description,
          spec: args.spec ?? null,
        } as never);
        if (!result.ok) return refused('table_propose', result.error);
        return { ok: true, action: 'table_propose' };
      }
      default:
        return { ok: false, reason: `Unknown records action: ${args.action as string}` };
    }
  },
};

export const records_handlers = [records];
