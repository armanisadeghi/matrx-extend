# Database migrations

These SQL files create the new tables matrx-extend writes to. Two prefixes are in play:

- **`wbx_`** — extension-owned, browser-captured artifacts (pages, patterns, SEO audits, screenshots). Written only by this client.
- **`sch_`** — scheduling system. Platform-shared spine for scheduled work (today: agent tasks; future: workflows, scrapes, webhooks, user-actions). Designed to be written and claimed by any surface — extension, desktop, web, mobile, server. See `2026_05_10_sch_v0.sql` for the design notes locked in by the v0 schema.

Parallel platform prefixes (NOT owned by this repo): `cx_` (chat), `agx_` (agent definitions), `rs_` (research).

## Files (apply in order)

| Order | File | What it creates |
|---|---|---|
| 1 | `2026_04_30_wbx_capture.sql` | `public.wbx_capture` — page captures from the Scrape tab |
| 2 | `2026_04_30_wbx_pattern.sql` | `public.wbx_pattern` + FK on `wbx_capture.pattern_id` |
| 3 | `2026_04_30_wbx_seo_audit.sql` | `public.wbx_seo_audit` — SEO audits from the SEO tab |
| 4 | `2026_04_30_wbx_pattern_modes.sql` | Adds `kind`, `config`, `target_user_table_id`, and rolling health columns to `wbx_pattern` for multi-mode extraction |
| 5 | `2026_05_03_agenda_v0.sql` | `public.agenda_task` + `public.agenda_run` — scheduled agent runs (**superseded by `sch_*`; dropped in step 7**) |
| 6 | `2026_05_08_wbx_screenshot.sql` | `public.wbx_screenshot` — captured screenshots from the agent / pilot surfaces |
| 7 | `2026_05_10_sch_v0.sql` | `public.sch_task` + `public.sch_agent_task` + `public.sch_trigger` + `public.sch_run` — kind-agnostic scheduling spine. Migrates legacy `agenda_*` rows in and drops the old tables. |
| 8 | `2026_05_20_wbx_highlight.sql` | `public.wbx_highlight` — on-page highlights captured by the highlighter overlay |
| 9 | `2026_06_10_wbx_guidance.sql` | `public.wbx_guidance` — cloud-synced guidance metadata (notes / screenshots / GIFs / demo refs) keyed by client guidance id; pointers only, bytes stay in `cld_files` |
| 10 | `2026_08_09_wbx_demo.sql` | `extend.wbx_demo` — cloud-synced recorded demo BODIES (a guidance `demo_ref` is only a pointer). Also **repairs `extend.wbx_guidance`**: the schema move attached `platform._version_capture` / `_gc_entity_associations` to it, and both coerce the row `id` to uuid, so every insert into that TEXT-PK table was aborting — guidance sync had been silently dead. |

## How to apply (and why the ledger matters)

The DB is the source of truth — a file here changes **nothing** until applied. All
applied migrations are tracked in the shared ledger `public._schema_migrations`
(`source='matrx-extend'`), so a forgotten one gets caught loudly.

**Verify state at any time:**

```bash
pnpm check:migrations          # red box if any migration was never applied; non-blocking
pnpm check:migrations:strict   # exits non-zero for CI
```
This also runs as a non-blocking step in `release.sh`.

**Apply + record (canonical):** from the **aidream** repo — the one box with DB write
creds (this extension can't run DDL). It applies pending files, records them in the
ledger, and regenerates models:

```bash
python db/apply_migrations.py --source matrx-extend
```

**One-off (Supabase SQL Editor):** open the dashboard for the Matrx project
(`txzxabzwovsujtloxrus`) → SQL Editor → paste & run the file. Then re-run aidream's
applier (or `python db/detect_applied.py`) so the ledger records it — otherwise
`pnpm check:migrations` keeps flagging it as unapplied.

A migration that must never apply gets `-- migrate: skip: <reason>` in its first 25
lines (e.g. `2026_05_03_agenda_v0.sql`, superseded by `sch_*`).

## RLS

> **Text primary keys and the platform entity triggers.** `wbx_guidance`, `wbx_recipe`, and
> `wbx_demo` use a client-generated TEXT id, not a uuid. Do NOT attach
> `platform._version_capture` or `platform._gc_entity_associations` to them — both coerce the
> row's `id` to `uuid`, so every insert (and every hard delete) aborts with `invalid input
> syntax for type uuid`. The client swallows the error, so the failure mode is a table that
> silently stays empty. Only `_100_touch_row`, `_110_stamp_actor`, and `_stamp_org_default` are
> safe on a text-PK table. Note that `_100_touch_row` overwrites `updated_at` with `now()`, so
> that column is server clock — carry the client's own timestamp inside the row's jsonb if you
> need it for last-write-wins.

Every `wbx_*` table enables RLS with owner-only policies keyed on `user_id = auth.uid()`. The user's JWT (set by the extension via `supabase.auth.setSession`) is what makes this work — `auth.uid()` resolves to their Supabase user ID, so they can only read/write their own rows. Most tables expose select/insert/delete; `wbx_guidance` adds an **update** policy because guidance items are mutable (its sync path uses `INSERT … ON CONFLICT DO UPDATE`).

## Tables this extension only READS (not created here)

- `agx_agent` — agent definitions for the Chat tab's agent picker
- `cx_conversation`, `cx_message` — conversation history for the Chat tab
- `rs_*` — research data, accessed via FastAPI endpoints (`/research/*`), not direct Supabase queries

> **2026-06-10 audit notes:** the live DB carries a partial unique index
> `sch_run_unique_active_per_task` (one active run per task) that was
> applied out-of-band and is NOT in `2026_05_10_sch_v0.sql` — tracked with
> the aidream team in docs/AIDREAM_ISSUES.md so a DB rebuild doesn't lose
> double-run protection.
