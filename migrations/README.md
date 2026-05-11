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

## How to apply

**Supabase SQL Editor (recommended):**

1. Open the dashboard for the Matrx project (`txzxabzwovsujtloxrus`)
2. SQL Editor → New query → paste each file in order, run each
3. Verify in Table Editor that all three tables exist with RLS enabled

**psql:**

```bash
psql "$DATABASE_URL" -f migrations/2026_04_30_wbx_capture.sql
psql "$DATABASE_URL" -f migrations/2026_04_30_wbx_pattern.sql
psql "$DATABASE_URL" -f migrations/2026_04_30_wbx_seo_audit.sql
```

## RLS

All three tables enable RLS with a single owner-only policy: `user_id = auth.uid()`. The user's JWT (set by the extension via `supabase.auth.setSession`) is what makes this work — `auth.uid()` resolves to their Supabase user ID, so they can only read/write their own rows.

## Tables this extension only READS (not created here)

- `agx_agent` — agent definitions for the Chat tab's agent picker
- `cx_conversation`, `cx_message` — conversation history for the Chat tab
- `rs_*` — research data, accessed via FastAPI endpoints (`/research/*`), not direct Supabase queries
