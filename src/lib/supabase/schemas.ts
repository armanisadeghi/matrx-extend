/**
 * Schema-scoped Supabase accessors — the ONE place that knows which Postgres
 * schema each table lives in.
 *
 * ## Why this file exists
 *
 * The platform DB was reorganized: the single `public` schema was split into
 * ~48 domain schemas. Every table this extension touches moved. PostgREST only
 * resolves `.from('x')` against `public` unless you say otherwise, so an
 * unqualified call now fails at RUNTIME with:
 *
 *     PGRST205  Could not find the table 'public.wbx_pattern' in the schema cache
 *
 * That is invisible to `tsc` and invisible to the build — it only shows up in a
 * user's browser. The first migration pass updated the COLUMNS but missed the
 * schema qualification on 51 call sites, which is precisely the drift a pile of
 * inline `.schema('extend')` string literals invites. So: one map, one export
 * per schema, and nobody writes the string by hand again.
 *
 * ## Usage
 *
 *     import { extendDb } from '@/lib/supabase/schemas';
 *     const { data } = await extendDb().from('wbx_pattern').select('*');
 *
 * ## Ownership columns — read this before writing a query
 *
 * The moved tables adopted a common base-entity template. Two consequences:
 *
 * 1. `extend.*` and `workbench.notes` / `workbench.note_folders` have NO
 *    `user_id` column anymore — ownership is `created_by`. Filter on that.
 *    (`scheduler.sch_task` / `sch_run` / `sch_trigger`, `admin.admins`,
 *    `users.user_form_profile`, and `workbench.udt_*` DID keep `user_id` —
 *    this is NOT a blanket rename. Check the table before you filter.)
 *
 *    Two tables have neither, and both are load-bearing exceptions:
 *      - `extend.wbx_recipe`      — a SHARED read-only catalog. No ownership
 *                                   column at all; RLS is a plain `SELECT true`.
 *      - `scheduler.sch_agent_task` — the 1:1 agent extension of `sch_task`.
 *                                   Ownership lives on the parent; never filter
 *                                   this table by a user column directly.
 *
 * 2. NEVER send `created_by` or `organization_id` on an INSERT. Two BEFORE-INSERT
 *    triggers stamp them: `platform._stamp_actor()` sets `created_by = auth.uid()`,
 *    and `_stamp_org_default()` resolves the actor's personal org via
 *    `ensure_personal_organization()`. `organization_id` is NOT NULL with no
 *    default, so sending your own value is how you get a constraint violation or
 *    a mis-attributed row. Let the DB stamp it; RLS `WITH CHECK` (which runs
 *    AFTER the triggers) then validates the result.
 */

import { getSupabase } from '@/lib/supabase/client';

/**
 * Where each table the extension uses actually lives. Verified against the live
 * DB (project txzxabzwovsujtloxrus). Keep this in sync when a table moves —
 * a wrong entry here is a runtime PGRST205, not a compile error.
 */
export const TABLE_SCHEMA = {
  // extend — this extension's own tables
  wbx_pattern: 'extend',
  wbx_recipe: 'extend',
  wbx_capture: 'extend',
  wbx_guidance: 'extend',
  wbx_screenshot: 'extend',
  wbx_seo_audit: 'extend',
  wbx_highlight: 'extend',
  // scheduler — the sch_* scheduling spine behind the Agenda tab
  sch_task: 'scheduler',
  sch_run: 'scheduler',
  sch_trigger: 'scheduler',
  sch_agent_task: 'scheduler',
  // workbench — notes + user-defined tables
  notes: 'workbench',
  note_folders: 'workbench',
  udt_datasets: 'workbench',
  udt_dataset_fields: 'workbench',
  // chat — conversation history hydration
  conversation: 'chat',
  message: 'chat',
  tool_call: 'chat',
  // misc
  user_form_profile: 'users',
  admins: 'admin',
  definition: 'tool',
  model_definition: 'ai',
} as const;

export type ExtensionTable = keyof typeof TABLE_SCHEMA;

/** `extend` — wbx_* (this extension's own tables). Ownership: `created_by`. */
export const extendDb = () => getSupabase().schema('extend');

/** `scheduler` — sch_* scheduling spine. Ownership: `user_id` (kept). */
export const schedulerDb = () => getSupabase().schema('scheduler');

/** `workbench` — notes (`created_by`) + udt_* (`user_id`). Mind the difference. */
export const workbenchDb = () => getSupabase().schema('workbench');

/** `chat` — conversation / message / tool_call. Ownership: `created_by`. */
export const chatDb = () => getSupabase().schema('chat');

/** `users` — user_form_profile. Ownership: `user_id` (kept). */
export const usersDb = () => getSupabase().schema('users');

/** `admin` — admins. Ownership: `user_id` (kept). */
export const adminDb = () => getSupabase().schema('admin');

/** `tool` — tool `definition` rows (tool descriptions, read live). */
export const toolDb = () => getSupabase().schema('tool');

/** `ai` — model registry. NOTE: `ai.model` was split; use `model_definition`. */
export const aiDb = () => getSupabase().schema('ai');
