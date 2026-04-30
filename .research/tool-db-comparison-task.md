# Task: Compare matrx-extend client tools to `public.tools` rows

**For:** an agent with read+write access to the Matrx Supabase project (table `public.tools`).
**From:** matrx-extend (the Chrome extension), which has just defined 63 client-side tools.
**Goal:** identify which extension tools already exist in `public.tools`, which are close-but-not-identical (and worth aligning), and which need new DB rows. Produce a single `.md` deliverable that the extension team can act on without re-deriving anything.

---

## Inputs

1. **Extension catalog** — the source of truth for what the extension can do today.
   - JSON: [`types/tool-catalog.json`](../types/tool-catalog.json)
   - Markdown: [`types/tool-catalog.md`](../types/tool-catalog.md)
   - 63 tools, each with `{ name, description, tier, input_schema (JSON Schema 7), required_permissions, surface_bundles }`.
   - Tier values: `read | action | ask-user | privileged`.
   - Bundle values: `assistant | pilot | pilot+privileged`.

2. **DB table** — `public.tools` in the Matrx Supabase project (project ref: `txzxabzwovsujtloxrus`). Inspect the live schema; do not assume column names. At time of writing the table is expected to have at least `name`, a description column, and an input-schema column (likely `parameters` or `input_schema`), but verify.

---

## Method

Work in three passes:

### Pass 1 — exact-name matches

For every tool in the catalog:
1. Query `public.tools` for a row with the same `name`.
2. If found, compare:
   - **Description text** — flag wording deltas, but minor differences are acceptable.
   - **Input schema** — compare property names, types, requireds, defaults, enums, min/max constraints. The extension's schema is the SOURCE OF TRUTH for what the *client* will accept. If the DB is stricter, the extension can loosen on its side. If the DB is looser, the DB should usually be tightened — flag it.
   - **Output description / schema** — extension catalog doesn't define an output schema yet. If the DB has one, copy the language verbatim back to the extension team so they can document it on their handlers.
3. Classify the match as:
   - **identical** — ship as-is, no work.
   - **drift** — same intent, schema mismatches in non-breaking ways. List each delta.
   - **conflict** — same name, different intent. Rename one of them.

### Pass 2 — fuzzy matches (different name, same job)

For every extension tool **without** an exact-name match:
1. Search `public.tools` for rows whose description or schema looks like the same operation. Examples to look for:
   - Extension `navigate_active_tab` ↔ DB `goto_url` / `open_url` / `browser_navigate`
   - Extension `click_element` ↔ DB `click` / `dom_click`
   - Extension `type_into_element` ↔ DB `fill_input` / `type_text`
   - Extension `take_screenshot` ↔ DB `screenshot` / `capture_visible_tab`
   - Extension `read_active_page` ↔ DB `scrape_page` / `extract_content`
   - Extension `search_history`, `search_bookmarks`, `download_url` etc. — likely only in the DB if browser-specific tools exist.
2. For each candidate match:
   - Note the DB name + schema.
   - Decide which name should win. **Prefer the DB name when it's already in production use** (less downstream churn). Recommend the rename to the extension. **Prefer the extension name when the DB name is generic and unclaimed** (e.g. `click` is a worse name than `click_element` because it's ambiguous).
   - Note any **schema arg name** changes the extension would need to adopt to match (e.g. `selector` ↔ `css_selector`).
3. Output: a "rename map" table — `extension_name` → `db_name` (or vice versa) → `schema_changes_needed`.

### Pass 3 — orphans on both sides

1. **Extension orphans** — extension tools with no DB equivalent at all. These need new rows in `public.tools`. Output: a SQL or PostgREST insert recipe per tool, with the extension catalog's `description`, `input_schema`, and any standard fields the DB requires (e.g. `category`, `is_active`, `created_by`). Use `category = 'browser-extension'` or whatever the established convention is.
2. **DB orphans** — DB tools that *aren't* in the extension catalog. These are tools other surfaces (server, frontend, desktop) implement that the extension doesn't. **List them, but don't propose changes.** The extension team will decide whether to implement any of them client-side.

---

## Deliverable

Write a single file: `.research/tool-db-comparison-result.md` (next to this task spec).

Structure:

```markdown
# Tools DB Comparison — <YYYY-MM-DD>

## Summary
- Total in extension catalog: 63
- Exact name matches: N
- Fuzzy matches (rename candidates): N
- Extension orphans (need new DB rows): N
- DB orphans (extension doesn't implement): N
- Conflicts (same name, different intent): N

## Pass 1 — Exact name matches

### identical (no action)
- `tool_name_a`
- `tool_name_b`
…

### drift (action: align schemas)

| extension name | db column | extension value | db value | recommendation |
|---|---|---|---|---|
| `click_element` | `parameters.required` | `["selector"]` | `["selector","nth"]` | DB should make `nth` optional with default 0 |
| `read_active_page` | `description` | "Read the active tab and return…" | "Reads page content…" | merge: prefer extension wording (more specific) |
…

### conflict (action: rename one side)
…

## Pass 2 — Fuzzy matches → rename map

| extension name | db name | schema deltas | which name wins | reason |
|---|---|---|---|---|
| `navigate_active_tab` | `goto_url` | `url`→`url` (same), DB has extra `wait_for: 'load'` | DB wins (production use); extension renames | already used by 8 agents |
…

## Pass 3 — Orphans

### Extension orphans (insert into `public.tools`)

For each, an INSERT recipe:

```sql
INSERT INTO public.tools (name, description, parameters, category, …)
VALUES (
  'list_open_tabs',
  'List all open browser tabs...',
  '{"type":"object","properties":{"all_windows":{"type":"boolean"}}}'::jsonb,
  'browser-extension',
  …
);
```

…

### DB orphans (extension doesn't implement; informational)

| db name | description summary | likely client surface |
|---|---|---|
| `web_search` | server-side search | server / agent |
…

## Notes / decisions for the extension team

- (free-form: anything you noticed that needs human judgment)
```

---

## Working notes for the agent

- **Don't assume the DB column names**. Run `\d public.tools` (or PostgREST OPTIONS) first.
- **Schema comparison**: when comparing JSON schemas, flatten them — different orderings of `properties`, `required`, `additionalProperties` are equivalent. What matters is: same property names, same types, same required set, same defaults, same enums.
- **Don't write to the DB.** This task is read-only. The deliverable is recommendations the human will execute (or punt to another agent).
- **Be concrete.** "Schema differs" is useless. "Extension's `nth` is `integer >= 0` with default 0; DB's is `integer >= 1` with no default" is useful.
- **Keep tier in mind.** A tool's tier (`read` / `action` / `privileged` / `ask-user`) affects how the agent gates it. The DB may not have tier as a column. If it does, flag mismatches; if it doesn't, recommend adding one (or storing it in `metadata`).
- **`required_permissions` is extension-only.** It lists Chrome `permissions` keys the tool relies on. The DB shouldn't store these — they're a property of the implementation, not the contract. Skip them in comparisons.
- **`surface_bundles` is extension-only.** Each tool ships in zero or more of: assistant (Chat tab), pilot (drives the browser), pilot+privileged. The DB shouldn't store bundle membership either.

---

## Glossary (so the agent uses the right vocabulary in the result file)

- **catalog** — the JSON file the extension generates (`types/tool-catalog.json`).
- **tool name** — the unique identifier the agent uses to call the tool (e.g. `click_element`).
- **input_schema / parameters** — the JSON Schema describing what arguments the tool takes.
- **tier** — risk level: `read` (auto-runs), `action` (mutating, gated by permission mode), `privileged` (always confirms), `ask-user` (renders a question card to the human).
- **bundle** — which UI surface ships the tool: `assistant` (read-only Chat), `pilot` (full browser-driving agent), `pilot+privileged` (trusted agents only).
- **surface** — the part of the extension where the agent runs: Assistant / Pilot.

That's everything. Run the comparison and drop the result file. Ping the extension team when done.
