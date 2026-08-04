# Removed for the Chrome Web Store submission — and how to bring each back

> Everything here was removed **specifically to pass Chrome Web Store review**, not
> because it was broken. Each entry says exactly what was pulled, why, and the path to
> restoring it. Nothing was removed beyond what we explicitly agreed (§1, §2) plus the
> code each one directly depends on.

Full policy analysis: [CHROME_WEB_STORE_REVIEW.md](./CHROME_WEB_STORE_REVIEW.md).

---

## 1. `execute_javascript` / `evaluate_javascript` — remote code execution

**Removed:** 2026-07-11 · **Why:** hard MV3 policy violation (the likely repeat-rejection cause).

### What it did
The agent could send a JavaScript **string** and we ran it on the page via
`new Function('arg', code)` (`src/lib/tools/handlers/privileged.ts`).
`evaluate_javascript` (`src/lib/tools/handlers/canonical-mergers.ts`) was a thin
canonical-name wrapper that delegated to the same implementation.

### Why it had to go
MV3 prohibits *"executing a string fetched from a remote source"* and *"systems to run
complex commands fetched from a remote source, even if fetched as data."* The `code`
came from an LLM on our server, so this is exactly the prohibited pattern. Injecting via
`chrome.scripting` does not change it — the policy is about where the *logic* originates.

### What it did NOT power
Nothing. Verified: extraction, scraping, and Showcase all have their own code paths and
none call these tools. This was a standalone agent escape-hatch. Removing it broke no
feature.

### Exactly what was removed
- `execute_javascript` handler — `src/lib/tools/handlers/privileged.ts`
- `evaluate_javascript` handler — `src/lib/tools/handlers/canonical-mergers.ts`
- Both from `CANONICAL_SURFACE` / category map — `src/lib/tools/categories.ts`
- Registrations in `src/lib/tools/registry.ts`
- Display-registry entry — `src/features/chat/tool-display/registry.tsx`
- DB: `tool.binding` for `evaluate_javascript` set `is_active=false`; removed from
  `tool.surface_defaults.always_include_tools` (migration
  `2026_07_11_retire_remote_js_and_admin_diag_tools.sql`).

### How to bring it back — the sanctioned way
Do **not** restore `new Function(remoteString)`. Reintroduce via one of MV3's two
sanctioned exceptions:
- **User Scripts API** (`chrome.userScripts`) — the manifest already RESERVES the
  `userScripts` permission for exactly this. Requires the user to toggle
  "Allow User Scripts" per-extension in `chrome://extensions`, so it cannot be silently
  on by default.
- **Debugger API** (`Runtime.evaluate`) — we already ship `debugger` + a CDP client.
  Cost: the "is being debugged" banner on every touched tab.

Re-activate the DB binding + surface default when the sanctioned implementation lands.

---

## 2. Admin diagnostics — `get_system_info`, `list_network_blocking_rules`

**Removed:** 2026-07-11 · **Why:** their permissions are unjustifiable to a reviewer.

### What they did (both admin-only)
- `get_system_info` — CPU / memory / display info via `chrome.system.*`.
- `list_network_blocking_rules` — dumps dynamic + session
  `chrome.declarativeNetRequest` rules.

### Why they had to go
They are the **only** consumers of four permissions the manifest itself admitted were
added *"preemptively"* for a roadmap item:
`system.cpu`, `system.memory`, `system.display`, `declarativeNetRequestWithHostAccess`.
Both tools are admin-gated, so a Web Store reviewer can never trigger them — which makes
those four permissions "declared but not serving the user-facing purpose," a documented
rejection cause. The same rule flagged `contextMenus` on the published v0.1.4 build.

### Exactly what was removed
- `src/lib/tools/handlers/system-info.ts` (whole file — it is the only `chrome.system.*`
  / `chrome.declarativeNetRequest` caller in `src/`)
- Its import + registration in `src/lib/tools/registry.ts`
- Both from the category map in `src/lib/tools/categories.ts`
- Manifest permissions `system.cpu`, `system.memory`, `system.display`,
  `declarativeNetRequestWithHostAccess` — `wxt.config.ts`
- (Neither tool was bound in the DB, so no `tool.binding` change was needed.)

### How to bring it back
1. Re-add the four permissions to `wxt.config.ts`. **Every one must have a real,
   reviewer-reachable consumer** before the NEXT submission, or it trips "declared but
   unused" again. Do not re-add them "preemptively."
2. Restore `system-info.ts` + its registration (recoverable from git history at the
   commit that removed it).
3. Only worth doing once these diagnostics are actually surfaced to a real (non-admin,
   or reviewer-reachable) user flow.

---

## Not removed, but still open (see CHROME_WEB_STORE_REVIEW.md)

- **Single purpose** — the listing must stop advertising five features; the UI/description
  need to lead with the one purpose (an agent that runs your browser).
- **Privacy policy** — a working URL must be in the dashboard's designated field.
- **`debugger` permission** — highest-scrutiny permission there is; keep only with a clear
  justification in reviewer notes, or drop CDP from the public build.
- **`new Function` on PAGE DATA** in `data-pattern/framework-dump.ts` + `modes/next-data.ts`
  — not remote code (it parses a `__NEXT_DATA__` blob from the page), but a reviewer
  grepping for `new Function` will flag it. Replace with a real parser to remove the argument.
