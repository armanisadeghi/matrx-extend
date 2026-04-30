# Database migrations

These SQL files create the new tables matrx-extend writes to. All extension-owned tables use the **`wbx_`** prefix (web/browser-captured data), parallel to `cx_` (chat) and `agx_` (agent).

## Files (apply in order)

| Order | File | What it creates |
|---|---|---|
| 1 | `2026_04_30_wbx_capture.sql` | `public.wbx_capture` — page captures from the Scrape tab |
| 2 | `2026_04_30_wbx_pattern.sql` | `public.wbx_pattern` + FK on `wbx_capture.pattern_id` |
| 3 | `2026_04_30_wbx_seo_audit.sql` | `public.wbx_seo_audit` — SEO audits from the SEO tab |

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
