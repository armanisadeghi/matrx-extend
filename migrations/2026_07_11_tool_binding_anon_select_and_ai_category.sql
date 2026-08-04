-- Two fixes the release drift-gate surfaced, both applied 2026-07-11 via the
-- Supabase MCP (project txzxabzwovsujtloxrus). Tracked copies for the shared
-- `_schema_migrations` ledger. Supabase migration names:
--   `tool_binding_anon_select_inherits_definition_visibility`
--   `fix_ai_tool_category`
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. tool.binding was invisible to the anon key — a BLIND SPOT IN A GUARD
-- ═══════════════════════════════════════════════════════════════════════════
-- In the `tool` schema, SELECT for anon+authenticated is granted on definition
-- (visibility-gated), bundle, executor, surface_defaults, mcp_server, mcp_config.
-- But `tool.binding` got a `j_select` policy scoped to `authenticated` ONLY,
-- gated on iam.has_access('tool', tool_id, 'viewer') — modelled as a user-owned
-- join rather than as the routing-reference table it actually is.
--
-- `binding` is (tool_id, executor_name, is_active): no user content, no secrets.
-- It is strictly LESS sensitive than tool.definition, which already exposes every
-- public tool's full description and parameter schema to anon.
--
-- What it broke: `scripts/check-tool-db-drift.ts` (and CI, and release.sh)
-- authenticate with the publishable/anon key. Reading tool.binding returned ZERO
-- rows — not an error, silently empty — so the gate concluded that all 81
-- advertised tools were MISSING from the DB and hard-failed the release. Ground
-- truth (superuser): 81 active chrome-extension bindings, exactly matching the 81
-- local tools. Zero real drift.
--
-- A guard that fails loudly about the wrong thing is worse than no guard: it
-- trains everyone to reach for MATRX_ALLOW_DRIFT=1, and then it will not stop the
-- real drift when it comes.
--
-- The fix: a binding is only meaningful alongside its definition, so it inherits
-- that definition's visibility — you may see the binding iff you may see the tool.
-- This can leak nothing tool.definition does not already leak. The existing
-- `j_select` ACL policy stays (policies OR together), so authenticated users keep
-- has_access to bindings of non-public tools they own.

CREATE POLICY cfg_select_via_definition ON tool.binding
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM tool.definition d
      WHERE d.id = binding.tool_id
        AND (
          d.visibility = 'public'::platform.visibility
          OR d.created_by = (SELECT auth.uid())
          OR (
            d.organization_id IS NOT NULL
            AND d.visibility >= 'internal'::platform.visibility
            AND iam.has_org_access(d.organization_id)
          )
        )
    )
  );

COMMENT ON POLICY cfg_select_via_definition ON tool.binding IS
  'A binding inherits its tool definition''s visibility — you can see the binding iff you can see the tool. Added 2026-07-11: binding was authenticated-only while tool.definition (strictly more sensitive) was already anon-readable, which silently returned 0 rows to the anon-key drift check and hard-failed releases.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The `ai` tool was in the `chrome` category
-- ═══════════════════════════════════════════════════════════════════════════
-- The `ai` tool (on-device Gemini Nano / Chrome built-in AI) was categorised as
-- `chrome`, which in this taxonomy means "the user's PERSONAL Chrome data —
-- cookies / bookmarks / history, admin-restricted". It sat next to chrome_cookies
-- and chrome_bookmarks, with which it has nothing in common, while the `ai`
-- category sat empty.
--
-- Categories are UX-only (TOOL_ROUTING_RULES §16 — they never affect routing), but
-- they DO drive `load_browser_tools({category})`, which is how the agent discovers
-- tools mid-turn. So:
--   load_browser_tools({category: 'ai'})     -> returned NOTHING
--   load_browser_tools({category: 'chrome'}) -> handed back the AI tool by mistake
--
-- The client taxonomy (src/lib/tools/categories.ts) always had `ai` as its own
-- category; the DB row was the outlier. Only visible once fix #1 let the drift gate
-- actually read the DB.
UPDATE tool.definition
SET category = 'ai'
WHERE name = 'ai'
  AND category = 'chrome';
