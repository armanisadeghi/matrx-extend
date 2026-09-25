/**
 * `records` — the browser agent's hands on this organization's custom records
 * (campaign lane `W6-EXT`, contract row CUT-N-11).
 *
 * ONE TOOL, ONE CONTRACT, TWO EXECUTORS. The platform already declares
 * `records` with its database-defined actions (AGT-N-3; the server half lives
 * in aidream `packages/matrx-records`). This file consumes that same contract
 * in the browser. A workflow without a browser implementation answers with an
 * explicit executor-unavailable result; it is never silently accepted.
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

/** The live `tool.definition.records` action vocabulary. */
const RECORD_ACTIONS = [
  'table_list',
  'metadata_search',
  'record_read',
  'record_aggregate',
  'record_write',
  'record_delete',
  'record_history',
  'record_restore_version',
  'field_propose',
  'table_propose',
  'form_propose',
  'booking_propose',
  'import_propose',
  'dashboard_propose',
  'pipeline_propose',
  'document_propose',
  'checklist_propose',
  'capture_propose',
  'enrich_propose',
  'portal_propose',
  'signature_request',
  'subscription_propose',
  'entity_read',
  'entity_write',
] as const;

const READ_ACTIONS = new Set<string>([
  'table_list',
  'metadata_search',
  'record_read',
  'record_aggregate',
  'record_history',
]);

/** Workflows advertised by the platform but not implemented by this executor. */
const UNSUPPORTED_BROWSER_ACTIONS = new Set<string>([
  'form_propose',
  'booking_propose',
  'import_propose',
  'dashboard_propose',
  'pipeline_propose',
  'document_propose',
  'checklist_propose',
  'capture_propose',
  'enrich_propose',
  'portal_propose',
  'signature_request',
  'subscription_propose',
  'entity_read',
  'entity_write',
]);

// `tool.definition.parameters` deliberately uses scalar JSON-schema types
// with a `null` default. Zod's `.nullable()` would publish a union type, so
// these preserve the live schema exactly while supplying the DB's omission
// default to the handler.
const nullDefault = <T extends z.ZodTypeAny>(schema: T) => schema.default(null as never);
const unknownObject = () => z.record(z.unknown());
const unknownArray = () => z.array(z.unknown());

const RecordsArgs = z.object({
  action: z.enum(RECORD_ACTIONS),
  availability: nullDefault(unknownObject()),
  blocks: unknownArray().optional(),
  body: z.string().optional(),
  checklist_id: nullDefault(z.string()),
  client_fields: nullDefault(unknownArray()),
  client_table: nullDefault(z.string()),
  client_table_id: nullDefault(z.string()),
  columns: unknownArray().optional(),
  config: nullDefault(unknownObject()),
  context_policy: z.string().default('include'),
  csv_text: nullDefault(z.string()),
  dashboard_id: nullDefault(z.string()),
  date_order: z.string().default('mdy'),
  dedupe_key: nullDefault(z.string()),
  description: z.string().default(''),
  enable: z.boolean().default(true),
  entity: z.string().optional(),
  expected_version: nullDefault(z.number().int()),
  expires_days: z.number().int().default(14),
  field: z.string().optional(),
  field_key: nullDefault(z.string()),
  field_type: z.string().default('text'),
  fields: nullDefault(unknownArray()),
  file_hash: nullDefault(z.string()),
  flow: z.string().default('one-at-a-time'),
  group_by: nullDefault(z.string()),
  home: nullDefault(z.string()),
  id_keyed: z.boolean().default(false),
  intro: nullDefault(z.string()),
  invite: nullDefault(unknownArray()),
  label: nullDefault(z.string()),
  letterhead: z.boolean().default(true),
  /** table_list / metadata_search / record_aggregate */
  limit: z.number().int().min(1).max(500).default(50),
  limits: nullDefault(unknownObject()),
  mapping: nullDefault(unknownObject()),
  match: nullDefault(unknownObject()),
  /** record_aggregate */
  measure: z.string().default('count'),
  name: z.string().optional(),
  notify: unknownObject().default(true as never),
  on_duplicate: z.string().default('skip'),
  on_entry: nullDefault(unknownObject()),
  open_to_crew: z.boolean().default(true),
  options_table_id: nullDefault(z.string()),
  presentation: nullDefault(unknownObject()),
  preview_only: z.boolean().default(false),
  publish: z.boolean().default(true),
  /** metadata_search */
  query: z.string().optional(),
  questions: nullDefault(unknownArray()),
  /** record_read / record_write / record_delete */
  record_id: nullDefault(z.string()),
  records: nullDefault(unknownArray()),
  relation_target: nullDefault(z.string()),
  render_id: nullDefault(z.string()),
  requires: nullDefault(unknownObject()),
  roles: nullDefault(unknownArray()),
  rows: nullDefault(unknownArray()),
  run: z.boolean().default(true),
  sensitivity: z.string().default('internal'),
  signer_email: z.string().optional(),
  signer_name: z.string().optional(),
  source_name: nullDefault(z.string()),
  spec: nullDefault(unknownObject()),
  stage_field: unknownObject().optional(),
  start_for: nullDefault(z.string()),
  steps: unknownArray().optional(),
  submission_cap: nullDefault(z.number().int()),
  submit_label: nullDefault(z.string()),
  table: nullDefault(z.string()),
  /** record_aggregate / record_write / field_propose / table_propose */
  table_id: nullDefault(z.string()),
  tables: unknownArray().optional(),
  tell: unknownArray().optional(),
  template_id: nullDefault(z.string()),
  thank_you: nullDefault(unknownObject()),
  title: z.string().optional(),
  transitions: nullDefault(unknownArray()),
  trigger: nullDefault(z.string()),
  /** record_write — the document, keyed by field key. */
  values: nullDefault(unknownObject()),
  /** record_delete — restore instead of delete. */
  undo: z.boolean().default(false),
  unit: nullDefault(z.string()),
  unmapped: z.string().default('propose'),
  version: z.number().int().optional(),
  view_id: nullDefault(z.string()),
  view_name: nullDefault(z.string()),
  watch: nullDefault(unknownObject()),
  who: nullDefault(unknownObject()),
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
    if (UNSUPPORTED_BROWSER_ACTIONS.has(args.action)) {
      return {
        ok: false,
        action: args.action,
        reason: `records.${args.action} is available on the platform but is not implemented by the Chrome extension executor. Use the AI Matrx app for this workflow.`,
        code: 'records_action_unavailable_in_chrome_extension',
      };
    }
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
        if (!args.query) {
          return {
            ok: false,
            action: 'metadata_search',
            reason: 'records.metadata_search requires `query`.',
          };
        }
        const result = await client.metadataSearch({ text: args.query as string });
        if (!result.ok) return refused('metadata_search', result.error);
        return { ok: true, action: 'metadata_search', matches: result.data };
      }
      case 'record_read': {
        if (!args.record_id) {
          return {
            ok: false,
            action: 'record_read',
            reason:
              'The Chrome extension currently reads one record at a time; provide `record_id`.',
          };
        }
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
        if (!args.table_id) {
          return {
            ok: false,
            action: 'record_aggregate',
            reason: 'records.record_aggregate requires `table_id`.',
          };
        }
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
        if (args.record_id && args.values) {
          const result = await client.recordUpdate({
            record_id: args.record_id,
            patch: args.values,
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
        if (args.table_id && args.records) {
          const result = await client.recordWriteMany({
            table_id: args.table_id,
            rows: args.records as Record<string, unknown>[],
          });
          if (!result.ok) return refused('record_write', result.error);
          return {
            ok: true,
            action: 'record_write',
            record_ids: result.data,
            wrote: 'create_many',
          };
        }
        if (!args.table_id || !args.values) {
          return {
            ok: false,
            action: 'record_write',
            reason:
              'records.record_write needs `record_id` plus `values` to update, or `table_id` plus `values` or `records` to create.',
          };
        }
        const result = await client.recordWrite({ table_id: args.table_id, data: args.values });
        if (!result.ok) return refused('record_write', result.error);
        return { ok: true, action: 'record_write', record_id: result.data, wrote: 'create' };
      }
      case 'record_delete': {
        if (!args.record_id) {
          return {
            ok: false,
            action: 'record_delete',
            reason: 'records.record_delete requires `record_id`.',
          };
        }
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
      case 'record_history': {
        if (!args.record_id) {
          return {
            ok: false,
            action: 'record_history',
            reason: 'records.record_history requires `record_id`.',
          };
        }
        const result = await client.recordHistory({ record_id: args.record_id, limit: args.limit });
        if (!result.ok) return refused('record_history', result.error);
        return { ok: true, action: 'record_history', history: result.data };
      }
      case 'record_restore_version': {
        if (!args.record_id || args.version === undefined) {
          return {
            ok: false,
            action: 'record_restore_version',
            reason: 'records.record_restore_version requires `record_id` and `version`.',
          };
        }
        const result = await client.restoreVersion({
          record_id: args.record_id,
          version: args.version,
        });
        if (!result.ok) return refused('record_restore_version', result.error);
        return { ok: true, action: 'record_restore_version', restored: result.data };
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
