# 2026-05-05 — Pre-release status report

> Purpose: pre-flight before rebuilding and resubmitting the Chrome
> extension to Google. Records what was done in this session, what was
> handed off to the server team, and what's deferred.

---

## ✅ Done — extension side

1. **Wire-format namespace handling** (`src/lib/tools/aliases.ts`,
   `src/lib/tools/dispatch.ts`) — strips `matrx-extend__` and bundle
   prefixes; prefers `canonical_name` field when aidream supplies it.
2. **120 local tool handlers** — full parity with DB rows (134 with
   the dynamically generated `list_<cat>_tools`).
3. **8 mega-tool routers** (`computer`, `form_input`, `navigate`,
   `tabs`, `downloads`, `memory`, `clipboard`, plus the unified
   `ask_user`) layered over existing specific handlers via the new
   `tierFor` field on `ToolHandler`.
4. **Cloud-files plumbing** — `src/lib/api/routes/files.ts` and
   `src/lib/api/routes/pdf.ts` route helpers; `upload_file` /
   `drop_file` / `read_pdf` / `computer.action=screenshot` all flow
   bytes through `cld_files` via MediaRef IDs.
5. **Bug fix from prior session audit** — removed stale
   `upload_file → file_upload` alias (was causing silent handler
   split between canonical-name and wire-parsing dispatch paths).
6. **PR 3 cleanup** — deleted `types/server-handoff/`,
   removed `buildServerCapabilityHandoff` and supporting symbols,
   updated CLAUDE.md and the obsolete research doc.
7. **Final build** — `pnpm wxt build` succeeds, `pnpm tsc --noEmit`
   clean, `.output/chrome-mv3/` ready to package.

---

## ✅ Done — database side (Matrx Main, project `txzxabzwovsujtloxrus`)

Performed via Supabase MCP in this session:

1. **Fixed two broken triggers** — `trg_tools_create_v1` and
   `trg_tools_snapshot_version` both pointed at the renamed table
   `public.tool_versions` (now `public.tl_def_version`). Updated to
   the new name. **This was blocking every new tool insert.**
2. **Added 16 missing tool rows** to `public.tl_def`:
   - Canonical mega-routers: `computer`, `form_input`, `navigate`,
     `tabs`, `downloads`, `memory`, `clipboard`
   - File ops: `upload_file`, `drop_file`, `read_pdf`
   - New tools: `get_element_details`, `read_network_requests`,
     `get_request_body`, `resize_window`
   - Previously-missing: `remember_for_domain`, `sleep`
3. **Schema updates on 8 existing rows** to advertise canonical fields
   added this session — `read_page` (tabId, filter, ref_id,
   trigger_lazy_load, max_chars), `find` (tabId), `get_page_text`
   (tabId), `find_text_on_page` (tabId), `wait_for` (full canonical
   condition shape; tier flipped from action → read), `ask_user`
   (type/options/context/secret), `update_plan` (approach/domains),
   `read_console_messages` (canonical args), `request_user_takeover`
   (tabId/expected_action).
4. **Marked dedupe-exempt** — read tools that legitimately return
   different results on every call: `get_active_tab`, `read_page`,
   `take_screenshot`, `read_active_page`, `get_page_selection`,
   `find`, `find_text_on_page`, `get_page_text`, `get_element_details`,
   `read_console_messages`, `read_network_requests`, `wait_for`,
   `list_open_tabs`, `get_tab_info`, `get_tab_groups`. Server-side
   dedupe should honor this column (issue S2 from
   2026-05-03-pending-fixes.md).
5. **Surface assignments** — all 16 new tools on
   `chrome-extension/pilot`; the read-tier ones (`memory`, `wait_for`,
   `read_pdf`, `get_element_details`) also on
   `chrome-extension/assistant`.
6. **Final state** — 134 tools (`source_app='matrx-extend'`), zero
   handler/row drift.

---

## 📋 Server-team handoff

These cannot be fixed from the extension side. Pass to whoever owns
the aidream backend / matrx-ai runtime.

### S1 — Confirm `tool_started` emits `canonical_name`

**Context:** The migration guide §2 (Step 2) says the `tool_started`
event should carry `canonical_name` (e.g. `"matrx-extend:fill_form"`)
alongside `tool_name` (the wire-form name the model emitted, possibly
bundle-aliased). Our dispatcher now reads `data.canonical_name` /
`data.canonicalName` if present and falls back to wire-name parsing
when not.

**Where to look:** `packages/matrx-ai/matrx_ai/tools/streaming.py`
`ToolStreamEvent` and `packages/matrx-connect/matrx_connect/context/
tool_event_data.py` `ToolStartedData`. Today both define only
`tool_name`. Per the migration guide, add a `canonical_name: str |
None` field on `ToolStartedData` and populate it in `started()` from
the resolved `tool_def.name`.

**Why this matters:** Without it, our dispatcher works fine for the
plain-namespace case (`matrx-extend__take_screenshot`) but bundle
aliases (`forms__fill_form` for canonical `matrx-extend:fill_form`)
fall back to a heuristic that won't always resolve. Canonical name is
the bulletproof path.

### S2 — Surface name resolution

**Context:** The extension sends
`client.state["browser-dom"].surface = "assistant" | "pilot"`
(bare). The DB has `chrome-extension/assistant` and
`chrome-extension/pilot` (qualified). The discovery handler /
`load_browser_tools` needs to map bare → qualified.

**Question:** does the server already do this lookup (e.g. via the
capability registration knowing its client is `chrome-extension`),
or does the extension need to send the client name explicitly? If
explicit, we should pass `"client_name": "chrome-extension"` in the
envelope alongside `capabilities`.

### S3 — Honor `dedupe_exempt` in the call deduper

**Context:** Issue from the live trace 2026-05-03 — the agent's
`get_active_tab` and `read_page` calls were dropped with
`"Exact duplicate call ... was already made."`. We've now flagged
15 mutable-state read tools with `dedupe_exempt=true` in `tl_def`.
The server's tool-call deduper needs to read that column and skip
those tools (or fold the URL/tab_id into the dedupe key as a
fallback).

### S4 — Cross-turn tool persistence

**Context:** The agent re-discovers categories on every user turn
because `ctx.queue_tool_changes()` mutations are per-request only.
Every new message restarts with `[load_browser_tools]`, even when
the prior turn already loaded `page` and `interact`. The extension
already tracks `loaded_categories` in
`client.state["browser-dom"].loaded_categories` — the server can
use that as a hint, or persist tool sets per conversation_id.

### S5 — Dropped/orphan triggers from the rename

**Context:** I patched `trg_tools_create_v1` and
`trg_tools_snapshot_version` because they referenced the pre-rename
`public.tool_versions` table. Worth doing a sweep for any other
function or trigger that references the old name (e.g.
`public.tools` itself was renamed to `public.tl_def`). My patches
are committed via `apply_migration` records:
- `fix_trg_tools_create_v1_table_rename`
- `fix_trg_tools_snapshot_version_table_rename`

---

## ⚠️ Cannot finish — flagging now

These are work I cannot do from the extension/DB side, listed so
nothing slips through before the Chrome Web Store submit.

1. **Argument-shape forgiveness** — the migration guide §3 hints at
   "argument forgiveness" (strip unknown keys, fail less aggressively
   on Zod). Not implemented; would change the security posture
   (action tools should still strict-validate). Defer with intent.

2. **`record_gif` tool** — substantial new capability (frame capture,
   GIF encoding, drop-target export) from canonical's advanced
   group. Not built. Not blocking since canonical lists it as
   `optional`.

3. **Non-CDP fallback for `read_console_messages` /
   `read_network_requests`** — both are admin-only today (require
   `debugger` permission). Canonical advertises them as general
   read tools. Building a non-CDP path needs `chrome.webRequest`
   for network and a content-script `console.*` shim — non-trivial
   and out of scope for this submission cycle.

4. **Test coverage for `aliases.ts` + `dispatch.ts`** — the audit
   subagent flagged that the case-table for namespace stripping has
   no tests. Worth adding before the next major release; not a
   blocker for submission since manual trace-walk verified all 12
   cases.

5. **`pnpm catalog:tools` requires WXT env to run** — the dump
   script imports `src/config/env.ts` which crashes outside the
   build context. Not a runtime issue (the extension's own catalog
   is built into the bundle), but if anyone tries to regenerate
   `types/tool-catalog.json` for diff purposes they'll need to run
   under `wxt dev` instead. Documented in the script's header
   comment; flag only.

6. **Persistent `memory` across SW restarts** — current `memory`
   router uses an in-process `Map`, wiped when the service worker
   recycles. Canonical says session-scoped, but in MV3 SWs recycle
   often. Cross-SW persistence would require `chrome.storage.session`
   (which is what `remember_for_domain` already uses but separately).
   Acceptable as v1; flag for a later upgrade.

---

## 🔍 Verification

Last-mile checks before you bundle and submit:

1. **Typecheck**: `pnpm tsc --noEmit` → clean ✓
2. **Build**: `pnpm wxt build` → succeeds ✓
3. **DB ↔ extension parity**:
   ```
   DB rows missing local handler:    0
   Extension handlers missing DB row: 0
   ```
4. **Manifest hygiene**: still need to verify `wxt.config.ts` /
   `manifest.json` have no leftover `<all_urls>` in base permissions
   (should be `optional_host_permissions`) — flagged in roadmap
   item #10 of CLAUDE.md but not addressed this session.
5. **Web Store identity**: `EXPECTED_EXTENSION_IDS` in
   `src/config/identity.ts` should already cover the build channel
   you're submitting (the v0.1.4 incident's fix is still in place).

---

## 📦 Submission checklist

- [ ] Bump version in `package.json` and `wxt.config.ts`
- [ ] Confirm `wxt.config.ts` matches the Web Store key
- [ ] Run `pnpm wxt build` (already verified clean)
- [ ] Zip `.output/chrome-mv3/`
- [ ] Submit via Chrome Web Store dashboard
- [ ] After approval, verify the published extension's ID is in
      `EXPECTED_EXTENSION_IDS` — and that the corresponding
      `chromiumapp.org` redirect URL is in Supabase auth config.
