-- Tombstones for cross-machine guidance deletes (matrx-extend bug-hunt
-- 2026-06-10). APPLIED LIVE via the Supabase MCP (recorded in Supabase's own
-- migration history as `wbx_guidance_soft_delete`); this file is the tracked
-- copy for the shared ledger — re-run aidream's applier to record it
-- (IF NOT EXISTS makes re-application a no-op).
--
-- Why: hard deletes never propagated — machine B's purely-additive hydrate
-- kept the item forever, and an edit there re-upserted (resurrected) it on
-- every machine. Deletes are now soft (is_deleted + updated_at bump) and the
-- hydrate applies tombstones with last-write-wins.
ALTER TABLE public.wbx_guidance
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
