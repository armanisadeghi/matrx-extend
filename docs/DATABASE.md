# Database rules — one connection, multi-schema routing, ownership, migrations

> Canonical repo doc for how this extension reaches the platform database.
> Moved here from CLAUDE.md in the 2026-08-20 charter rewrite; CLAUDE.md keeps
> only the headline hazards + a pointer here. Cross-repo law:
> `/Users/armanisadeghi/code/common-docs/policies/package-vs-implementation.md`.

### 🚨 ONE connection, ONE variable name

Read before touching any DB/config/env resolution:
`/Users/armanisadeghi/code/common-docs/policies/package-vs-implementation.md`.
Every `matrx-*` package must stay fully independent — owns its schemas, ships its
migrations, runs installed alone; never delete that capability to "simplify".
Our implementation is one company, one server, ONE database — every instance points
at Matrx Main (`brsgrqvjdzwihsvnfqkf`), a deployment CHOICE, not a package limit.
The banned thing is a **second candidate for the same connection**: `WXT_SUPABASE_URL`
/ `WXT_SUPABASE_PUBLISHABLE_KEY` are the only names, required, throw if absent — no
`?? process.env.SUPABASE_URL` chain anywhere (runtime *or* scripts), no bare
`SUPABASE_URL` in a `.env`. Pointing this at another database is a change of VALUES,
never a new variable name.

### 🗄️ The DB is multi-schema now — `public` is NOT where our tables live

The platform database was reorganized: the single `public` schema was split into
**~48 domain schemas**. Every table this extension touches moved. This is the
highest-risk thing in the repo, because **nothing in the build can see it**:

```
supabase.from('wbx_pattern')          // compiles. builds. passes every test.
                                      // 404s in the user's browser:
                                      //   PGRST205  Could not find the table
                                      //   'public.wbx_pattern' in the schema cache
```

`tsc`, Biome, vitest and `wxt build` are all blind to it — the table name is just
a string. So there is a dedicated gate: **`pnpm check:schema-routing`** (strict
variant runs in CI and blocks `release.sh`).

**Never hand-write `.schema('x')`.** Route through the single source of truth,
[src/lib/supabase/schemas.ts](../src/lib/supabase/schemas.ts):

```ts
import { extendDb, schedulerDb, workbenchDb } from '@/lib/supabase/schemas';
const { data } = await extendDb().from('wbx_pattern').select('*');
```

| Tables | Schema | Accessor |
|---|---|---|
| `wbx_*` (pattern, recipe, capture, guidance, screenshot, seo_audit, highlight) | `extend` | `extendDb()` |
| `sch_task` · `sch_run` · `sch_trigger` · `sch_agent_task` | `scheduler` | `schedulerDb()` |
| `notes` · `note_folders` · `udt_datasets` · `udt_dataset_fields` | `workbench` | `workbenchDb()` |
| `conversation` · `message` · `tool_call` | `chat` | `chatDb()` |
| `user_form_profile` | `users` | `usersDb()` |
| `admins` | `admin` | `adminDb()` |
| `definition` (tool defs) | `tool` | `toolDb()` |
| `model_definition` | `ai` | `aiDb()` |

**RPCs did NOT move — they are all still in `public`.** A schema-scoped client
would route them to the wrong schema. Always call `.rpc()` on the plain
`getSupabase()` client.

#### Ownership columns — there is no blanket rule, and guessing corrupts data

The moved tables adopted a common base-entity template (`organization_id`,
`created_by`, `updated_by`, `version`, `deleted_at`, `visibility`). **But only
some tables dropped `user_id`:**

- **`extend.*` and `workbench.notes` / `note_folders` have NO `user_id` anymore** —
  ownership is **`created_by`**. Filter on that.
- **`scheduler.sch_task`/`sch_run`/`sch_trigger`, `admin.admins`,
  `users.user_form_profile`, and `workbench.udt_*` KEPT `user_id`.** Do not
  "helpfully" rename it.
- **Two tables have NEITHER:** `extend.wbx_recipe` is a shared read-only catalog
  (no ownership column; RLS is plain `SELECT true`), and `scheduler.sch_agent_task`
  is the 1:1 extension of `sch_task` whose ownership lives on the parent. Never
  filter either by a user column directly.

**On INSERT, never send `created_by`; always send `organization_id`.**
`platform._stamp_actor()` owns actor attribution. Organization identity comes
from the initiating request or an authoritatively loaded parent and is present
before Supabase is called. A missing organization refuses client-side; a
personal/system/active/default resolver and every database assignment trigger
are defects. Emergency register:
`/Users/armanisadeghi/code/common-docs/projects/no-db-assigned-org/PLAN.md`.

### Database migrations — the DB is the source of truth, NOT the files

A `.sql` file in [migrations/](../migrations/) has changed **nothing** until it is
applied to Supabase (`brsgrqvjdzwihsvnfqkf`). This repo ships only the
publishable/anon key and **cannot apply DDL**. All three repos (aidream,
matrx-frontend, matrx-extend) share one DB and one ledger, `public._schema_migrations`.

- **Verify (loud):** `pnpm check:migrations` diffs `migrations/*.sql` against the
  ledger (rows where `source='matrx-extend'`) and screams in a red box about anything
  never applied. The ledger stays private to browser roles: the checker first tries
  the browser-safe read, then uses the authenticated Supabase CLI Management API with
  `MATRX_SUPABASE_PROJECT_REF` when RLS correctly refuses it. No service key enters the
  extension. `release.sh` runs `pnpm check:migrations:strict` and blocks when the ledger
  is unreachable or differs from disk.
- **Apply + record:** from the **aidream** repo (the one box with DB write creds),
  run `python db/apply_migrations.py --source matrx-extend`. For a one-off, apply via
  the Supabase MCP, then re-run aidream's applier so the ledger records it.
- A migration that must never apply (superseded / destructive / already live) gets
  `-- migrate: skip: <reason>` in its first 25 lines — e.g. `2026_05_03_agenda_v0.sql`
  is skip-marked (superseded by `sch_*`).
