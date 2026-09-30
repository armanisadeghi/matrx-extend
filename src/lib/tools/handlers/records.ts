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
 * operating it. There is no `user_id` argument: the person comes from this install's session.
 * `organization_id` is an optional NARROWING only (default: every organization the person can
 * reach — the active organization never narrows what the agent sees, law 2026-09-30); the store
 * still answers by the person's own access. Only NEW work (table_propose) defaults to the
 * active organization.
 */

import {
  type SpanningClient,
  openRecordStore,
  openSpanningClient,
  recordsClientFor,
} from '@/lib/records/store';
import canonicalGuide from '@/lib/tools/generated/records-guide.json';
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
  'guide',
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

// The DB contract has scalar JSON-schema types with a `null` default. The
// runtime must accept that default too: Zod validates a `.default()` value
// against its inner schema, so a scalar `.default(null)` rejects every
// ordinary omitted-field call. The catalog serializer preserves the DB's
// scalar presentation for these nullable runtime fields.
const nullDefault = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().default(null);
const unknownObject = () => z.record(z.unknown());
const unknownArray = () => z.array(z.unknown());
const trueDefaultObject = () =>
  z
    .preprocess((value) => (value === true || value === undefined ? {} : value), unknownObject())
    .transform(() => true)
    .default(true as never);

const RecordsArgs = z.object({
  action: z.enum(RECORD_ACTIONS),
  /**
   * Optional explicit organization. Absent = every organization the person can reach (the
   * active organization never narrows what the agent sees — active-org law 2026-09-30); it is
   * only where NEW things (table_propose) are saved.
   */
  organization_id: nullDefault(z.string()),
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
  notify: trueDefaultObject(),
  on_duplicate: z.string().default('skip'),
  on_entry: nullDefault(unknownObject()),
  open_to_crew: z.boolean().default(true),
  options: nullDefault(z.array(z.string())),
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
  /** guide — the action whose server-authored guidance is requested. */
  topic: nullDefault(z.string()),
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

function pythonStringRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  return `${quote}${value
    .replaceAll('\\', '\\\\')
    .replaceAll(quote, `\\${quote}`)
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}${quote}`;
}

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

/** One organization that could not answer, and why (the package's own shape). */
type Unavailable = { organization_id: string; reason: string };

/**
 * The client for the organization that OWNS the thing an action names. A table or record opens
 * in its own organization, never the active one (active-org law): the package looks the owner up
 * across the person's organizations (`ownerOrganization`). One whose store is off is refused with
 * its reason rather than reported as "not found".
 */
async function ownerClient(
  spanning: SpanningClient,
  args: RecordsToolArgs,
  orgArg: string | null,
  unavailable: Unavailable[],
): Promise<
  { ok: true; client: Awaited<ReturnType<typeof recordsClientFor>> } | { ok: false; reason: string }
> {
  if (!args.table_id && !args.record_id) {
    const active = await openRecordStore('agent');
    return active.open ? { ok: true, client: active.client } : { ok: false, reason: active.reason };
  }
  const owner = await spanning.ownerOrganization({
    table_id: args.table_id ?? null,
    record_id: args.table_id ? null : (args.record_id ?? null),
    ...(orgArg ? { organization_id: orgArg } : {}),
  });
  if (!owner.ok) return { ok: false, reason: owner.error.message };
  if (!owner.data) {
    return {
      ok: false,
      reason: args.table_id
        ? `Table ${args.table_id} was not found in any organization you can reach. Check the id, or pass organization_id.`
        : `Record ${args.record_id} was not found in any organization you can reach. Check the id, or pass organization_id.`,
    };
  }
  const closed = unavailable.find((u) => u.organization_id === owner.data);
  if (closed) return { ok: false, reason: closed.reason };
  return { ok: true, client: await recordsClientFor(owner.data, 'agent') };
}

const records: ToolHandler<RecordsToolArgs, unknown> = {
  name: 'records',
  tier: 'action',
  tierFor: (args): ToolTier => (READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  argsSchema: RecordsArgs,
  run: async (args) => {
    if (args.action === 'guide') {
      const topic = args.topic?.trim() ?? '';
      const guide = canonicalGuide.topics[topic as keyof typeof canonicalGuide.topics];
      if (!guide) {
        const fallback = topic
          ? {
              ...canonicalGuide.unknown,
              note: canonicalGuide.unknown.note.replace(
                canonicalGuide.unknown_topic_quoted,
                pythonStringRepr(topic),
              ),
            }
          : canonicalGuide.empty;
        return {
          ok: true,
          action: 'guide',
          ...fallback,
        };
      }
      return { ok: true, action: 'guide', ...guide };
    }
    if (UNSUPPORTED_BROWSER_ACTIONS.has(args.action)) {
      return {
        ok: false,
        action: args.action,
        reason: `records.${args.action} is available on the platform but is not implemented by the Chrome extension executor. Use the AI Matrx app for this workflow.`,
        code: 'records_action_unavailable_in_chrome_extension',
      };
    }
    const orgArg = args.organization_id?.trim() || null;

    // Creating a NEW table is new work: it goes to the explicit organization, else the active one.
    if (args.action === 'table_propose') {
      let opened:
        | {
            open: true;
            client: Awaited<ReturnType<typeof recordsClientFor>>;
            organizationId: string;
          }
        | { open: false; reason: string };
      if (orgArg) {
        const { client: spanning } = await openSpanningClient('agent');
        const state = await spanning.organizationsOpen({ organization_id: orgArg });
        opened = !state.ok
          ? { open: false, reason: state.error.message }
          : state.data.open.length === 0
            ? { open: false, reason: state.data.unavailable[0]?.reason ?? 'Store unavailable.' }
            : {
                open: true,
                client: await recordsClientFor(orgArg, 'agent'),
                organizationId: orgArg,
              };
      } else {
        opened = await openRecordStore('agent');
      }
      if (!opened.open) return { ok: false, action: args.action, reason: opened.reason };
      const result = await opened.client.tablePropose({
        name: args.name as string,
        description: args.description,
        spec: args.spec ?? null,
      } as never);
      if (!result.ok) return refused('table_propose', result.error);
      return { ok: true, action: 'table_propose', organization_id: opened.organizationId };
    }

    // Everything else sees every organization's store (or the one named).
    const { client: spanning } = await openSpanningClient('agent');
    const availability = await spanning.organizationsOpen(
      orgArg ? { organization_id: orgArg } : undefined,
    );
    if (!availability.ok) return refused(args.action, availability.error);
    const { open, unavailable } = availability.data;
    if (open.length === 0) {
      return {
        ok: false,
        action: args.action,
        reason:
          unavailable[0]?.reason ??
          'No organization is available, and records belong to an organization. Choose one in Settings and try again.',
        ...(unavailable.length > 1 ? { unavailable } : {}),
      };
    }
    const notes = unavailable.length > 0 ? { organizations_unavailable: unavailable } : {};

    switch (args.action) {
      case 'table_list': {
        // The package spans every organization itself; the optional filter narrows it.
        const result = await spanning.tableList(orgArg ? { organization_id: orgArg } : undefined);
        if (!result.ok) return refused('table_list', result.error);
        const tables = result.data.map((table) => ({
          id: table.id,
          slug: table.slug,
          name: table.name,
          type: table.type,
          agent_writable: table.agent_writable,
          organization_id: table.organization_id,
        }));
        const limited = tables.slice(0, args.limit);
        return { ok: true, action: 'table_list', tables: limited, count: limited.length, ...notes };
      }
      case 'metadata_search': {
        if (!args.query) {
          return {
            ok: false,
            action: 'metadata_search',
            reason: 'records.metadata_search requires `query`.',
          };
        }
        const result = await spanning.metadataSearch({
          text: args.query as string,
          ...(orgArg ? { organization_id: orgArg } : {}),
        });
        if (!result.ok) return refused('metadata_search', result.error);
        return {
          ok: true,
          action: 'metadata_search',
          matches: result.data.matches,
          ...(result.data.unavailable.length > 0
            ? { organizations_unavailable: result.data.unavailable }
            : {}),
        };
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
        // The package opens a record in ITS OWN organization.
        const result = await spanning.recordRead({
          record_id: args.record_id as string,
          ...(orgArg ? { organization_id: orgArg } : {}),
        });
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
        // The package runs it in the organization that owns the table; each row names it.
        const result = await spanning.recordAggregate({
          table_id: args.table_id as string,
          ...(orgArg ? { organization_id: orgArg } : {}),
          ...(args.group_by ? { groupBy: [args.group_by] } : {}),
          ...(args.measure !== 'count'
            ? { measures: [{ operation: args.measure, key: args.field_key ?? null }] }
            : {}),
          limit: args.limit,
        });
        if (!result.ok) return refused('record_aggregate', result.error);
        return { ok: true, action: 'record_aggregate', rows: result.data, ...notes };
      }
      case 'record_write': {
        const owner = await ownerClient(spanning, args, orgArg, unavailable);
        if (!owner.ok) return { ok: false, action: args.action, reason: owner.reason };
        const { client } = owner;
        // One verb, two doors, decided by whether the record already exists —
        // the same split the server half makes, so a model writes the same way
        // wherever the turn happens to be running.
        if (args.record_id && args.values) {
          const result = await client.recordUpdate({
            record_id: args.record_id,
            patch: args.values,
            ...(args.expected_version !== null ? { expectedVersion: args.expected_version } : {}),
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
        const owner = await ownerClient(spanning, args, orgArg, unavailable);
        if (!owner.ok) return { ok: false, action: args.action, reason: owner.reason };
        const { client } = owner;
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
        const owner = await ownerClient(spanning, args, orgArg, unavailable);
        if (!owner.ok) return { ok: false, action: args.action, reason: owner.reason };
        const { client } = owner;
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
        const owner = await ownerClient(spanning, args, orgArg, unavailable);
        if (!owner.ok) return { ok: false, action: args.action, reason: owner.reason };
        const { client } = owner;
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
        const owner = await ownerClient(spanning, args, orgArg, unavailable);
        if (!owner.ok) return { ok: false, action: args.action, reason: owner.reason };
        const { client } = owner;
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
      default:
        return { ok: false, reason: `Unknown records action: ${args.action as string}` };
    }
  },
};

export const records_handlers = [records];
