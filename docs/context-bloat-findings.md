# Context Bloat — Findings & Action Log

> Living doc. Append, don't rewrite. Each item gets a status tag.
> Status: `confirmed` (data-backed, safe to ship) ·
> `likely` (one trajectory, probable but worth re-checking on more) ·
> `hypothesis` (needs more traces / a different model to verify) ·
> `done` (shipped) · `parked` (waiting for X)

## Source data
Three captured conversations on the same task ("retrieve Anthropic API
request history") under `.arman-temp/json-saves/`:

| file | model | read_page calls | read_page bytes | get_page_text bytes | total tool bytes >5KB |
|---|---|---:|---:|---:|---:|
| `cerebras-context-1.json` | Cerebras GLM-4.7 | 8 | 227 KB | 0 | 227 KB |
| `cerebras-context-2.json` | Cerebras GLM-4.7 (re-run) | 8 | 249 KB | 0 | 249 KB |
| `opus-task-1-analysis.json` | Claude Opus 4.7 | **1** | 30 KB | 31 KB | 65 KB |

## Headline
Smaller models default to `read_page(interactive_only:false)` and re-call
it whenever they want page content. Opus calls `read_page` once for a map,
then switches to `get_page_text` for reading. Result: **~4× context size
on the smaller model for the same job**.

---

## 1. Per-element bloat in `read_page` (confirmed · safe to fix)

Every element in `read_page` results has measurable waste:

- **`text` field equals `name`** in 70–90% of elements (e.g. 142/149,
  144/200, 147/172 across captured calls). Pure duplication.
- **`tag` is implied by `role`** for ~95% of cases: `a↔link`, `li↔listitem`,
  `p↔paragraph`, `button↔button`, `h*↔heading`.
- **`"ref:N"` prefix** is namespace decoration inside a field already named
  `ref`. Bare integer suffices.
- **Empty strings emitted explicitly** (`"text":""`, `"name":""`) — up to
  87/200 per call.
- **`expanded: false`** on ~28 elements per call (closed-by-default menus).
  Only emit when meaningful (true).

**Expected savings:** ~50% of a typical `read_page` result, with zero loss
of model-usable signal.

## 2. Model uses `read_page` to fetch content (confirmed for Cerebras GLM · likely class-wide)

Cerebras's thinking-text after each `read_page` reads like article
consumption: *"I found the Usage and Cost API documentation. Let me
continue reading to get the full information about costs, limitations…"*.
It's using the element list's `text` snippets as a stand-in for
`get_page_text`, which it never loads.

Root cause (from system prompt): `read_page` is always-on; `get_page_text`
sits behind `load_browser_tools({category:"page"})`. The smaller model
never gets there.

**Action:**
- Update `read_page` description to point at `get_page_text` for content.
- Consider promoting `get_page_text` (and `find_text_on_page`) to always-on.
  System prompt lives server-side — flagged for backend team. (parked)

## 3. `interactive_only:false` is the worst possible default-override (confirmed)

In all three captured Cerebras `read_page` calls, the model explicitly
overrode the schema default (`interactive_only:true`) to `false`. The
result is the verbose 200-element dump including paragraphs and headings
the model can't act on (you can't click a `<p>`).

**Action:**
- Tighten `read_page` description so the model doesn't reach for `false`
  unless it actually needs refs to non-interactives.
- (later) Consider splitting non-interactive content out of the element
  list entirely — outline string vs ref-list.

## 4. Site chrome re-shipped on every read (confirmed · larger fix)

The first ~30 elements of every `read_page` on `platform.claude.com` were
the same docs nav. Across 8 calls that's ~240 redundant elements.

**Action ideas (deferred — needs a design pass):**
- Cache nav-block hash per origin; return `nav: {from: "nav-#abc"}` after first read.
- Per-conversation element memoization — diff against last-shipped set.

## 5. `find` doesn't search content text (likely · improving now)

When the model wants to find an element by topic ("retention policy",
"compliance API"), `find` currently only matches against
`name + role + tag + text-snippet` of **interactive** elements (because
`getFreshScrape` cache key is `interactive_only:true`). A `read_page(false)`
that includes headings → an immediate `find("retention")` invalidates
the cache and re-scrapes interactive-only, losing the heading text.

**Action (next):**
- `find` should reuse whichever fresh scrape exists.
- Prefilter haystack should include the full text snippet (already does),
  but the candidate pool should include non-interactive elements when
  they're cached, and surface the nearest clickable ancestor in matches.

## 6. Behavior-vs-fact split (do not over-correct)

| observation | category |
|---|---|
| `read_page` per-element duplication | **fact** — fix immediately |
| Cerebras opts `interactive_only:false` every time | **likely class-wide** — verify with one more non-Opus model before treating as universal |
| Cerebras never loads the `page` category | **likely class-wide** — verify; if confirmed, promote `get_page_text` to core |
| Cerebras re-calls `read_page` instead of paginating with `scroll_page` | **single trajectory** — don't act yet |
| Opus uses `browser_batch` heavily | **single trajectory** — don't promote it as universal pattern yet |

---

---

## 7. Initial-tool surface is server-side, not extension-side (confirmed)

The extension sends `capabilities: ["browser-dom"]` only
([src/hooks/use-chat-stream.ts:431](../src/hooks/use-chat-stream.ts#L431)).
The actual "what tools does the model see on turn 1" decision lives in
**aidream**:
- the `browser-dom` capability handler
- `public.tools` DB rows + `category_routing` config

Local artifacts in this repo are documentation only:
- `CATEGORY_BY_TOOL` in [categories.ts:198](../src/lib/tools/categories.ts#L198)
  declares which tools we *think* belong to `core`.
- `coreToolNames()` in [registry.ts:160](../src/lib/tools/registry.ts#L160)
  exists but is **never called** — dead code; only the catalog dump reads it.
- `CANONICAL_SURFACE` in [categories.ts:416](../src/lib/tools/categories.ts#L416)
  is an aspirational, larger list for the in-extension Tools tab.

**Action:** changes to the initial surface (e.g. promote `get_page_text` to
always-on) must be made in aidream. Once done, mirror the change in this
repo's `CATEGORY_BY_TOOL` so the two stay aligned, and consider removing
dead `coreToolNames()`. (parked — needs aidream PR)

## 8. Page-reading tool family has too many sound-alikes (confirmed)

Seven read-tier tools all do some flavor of "read the page" without clear
wedges between them. Cerebras's reach for `read_page(false)` is partly
because it's the only "read" tool in core and the description is broad
enough to seem like the right answer to "give me the content".

| tool | category | what it returns |
|---|---|---|
| `read_page` | core | element list with refs |
| `read_active_page` | page | full scrape (md + media + JSON-LD + SEO) |
| `get_page_text` | page | clean article text |
| `fetch_url_as_markdown` | page | same pipeline, any URL, no tab needed |
| `extract_microdata` | page | structured-data only |
| `get_page_links` | page | anchors only |
| `find_text_on_page` | page | text substring/regex hits |

Confusing name pairs:
- `read_page` (refs) vs `read_active_page` (content) — names suggest
  opposite weights.
- `find` (NL element) vs `find_text_on_page` (substring text) — both
  start with "find".
- `get_page_text` vs `read_active_page` — both extract article text; one
  is just lighter.

**Action ideas (deferred — naming changes are breaking):**
- Cross-link descriptions: each tool's description points to its
  sound-alikes with one-liners about the wedge.
- Consider renaming the next time we bump a major version:
  `read_page` → `list_page_elements`, `read_active_page` → `read_page_full`,
  etc.

Element-inspection family (`query_elements`, `inspect_element`,
`get_element_details`, `get_element_at_point`, `get_form_fields`,
`get_computed_style`) is also crowded; lower urgency.

## 9. ✅ Per-element bloat fix shipped — measured

Replayed the `cerebras-context-1` trace through the new serializer:

| | before | after | saved |
|---|---:|---:|---:|
| sum of all 8 `read_page` payloads | 227 KB | 153 KB | **32.7%** |
| total conversation context | 314 KB | 240 KB | **23.6%** |

Zero loss of model-usable signal — only duplicate `text`/`name`,
tag-implied-by-role, empty fields, `expanded:false` were removed.

## 10. ✅ `find` broadened

[page-refs.ts:434-619](../src/lib/tools/handlers/page-refs.ts#L434-L619):
- Searches name + text + href + role + tag (was just name+role+tag+text)
- Per-field weighting (name 1.0 / text 0.6 / href 0.4 / role-or-tag 0.2)
- Whole-phrase bonus when the full query appears in name or text
- Non-interactive content (headings, paragraphs) included by default
  (`include_content:true`); set false to restrict to clickables
- Cache reuse fixed — accepts whichever scrape is cached, no longer
  invalidated by a prior `read_page(interactive_only:false)`

---

## 11. Canonical tool set IS documented (confirmed)

[docs/proposed_browser_tools.json](./proposed_browser_tools.json) is the
declared single source of truth — `_meta.status: "canonical"`,
`_meta.version: "1.0.0"`, dated 2026-05-04. 27 tools in 5 groups.

The `core` group (12 tools, `recommendation: "browser_default"`):
```
read_page · find · get_page_text · find_text_on_page · computer ·
form_input · navigate · tabs · wait_for · ask_user · notify_user · update_plan
```

Its description: *"The agent-builder UI pre-checks these when creating a
browser agent; clients (matrx-extend, etc.) typically pre-include them
in the request's tools list. The server does NOT auto-inject — inclusion
is always the agent definition's or the client's choice."*

**Implication**: `get_page_text` was already supposed to be in the initial
surface. The Cerebras trace not seeing it = drift between the canonical
doc and what aidream actually advertises for that agent. Either the
agent's definition in aidream wasn't updated to opt into core, or the
server-side discovery handler isn't reading the canonical groups.

The canonical-migration audit (May 2026) explicitly marks `read_active_page` as DROP (replaced by
`read_page(trigger_lazy_load:true)` + `get_page_text`) — confirming
`get_page_text` is the intended primary content reader.

## 12. Local `CATEGORY_BY_TOOL` is out of sync with the canonical (confirmed)

[src/lib/tools/categories.ts:197-209](../src/lib/tools/categories.ts#L197-L209)
places `get_page_text`, `find_text_on_page`, `form_input`, `navigate`,
`tabs`, `wait_for`, `notify_user`, `update_plan` in non-`core` categories
even though the canonical doc puts them all in `core`. Cosmetic today
because the local map isn't sent over the wire — the catalog dump emits
a `core_bundle` that doesn't match canonical intent.

**Action:** reconcile when convenient. Low risk; documentation-only.

## 13. `get_page_text` vs `fetch_url_as_markdown` — not duplicates (confirmed)

Both legitimate. Different jobs:
- `get_page_text` — active tab, in-page Readability extract, plain text,
  ~50-line handler. Fast, lightweight.
  [page-refs.ts:684](../src/lib/tools/handlers/page-refs.ts#L684)
- `fetch_url_as_markdown` — any URL via offscreen fetch + full scrape
  pipeline (defuddle + readability + turndown + SEO collectors), returns
  markdown with rich metadata.
  [fetch.ts:50](../src/lib/tools/handlers/fetch.ts#L50)

Shipped 2026-05-05 per [tools-roadmap.md:132](../.research/tools-roadmap.md#L132).
`fetch_url_as_markdown` is **not** in the canonical 27-tool set — it
landed *after* the 2026-05-04 audit and was never classified. Should be
added to the canonical doc with "extension-only" disposition, or pitched.

---

## Open questions for next traces

- Does any other small model (e.g. Cerebras Qwen, Mistral, Gemini Flash)
  follow the same `read_page(false)` pattern? If yes → universal.
- Does a Cerebras trace where `page` category is pre-loaded behave like
  Opus's? If yes → confirms the fix is "make `get_page_text` reachable".
- Does Opus's single-call `max_nodes:400` strategy generalize? Or does
  he break when the page truly has 1000+ elements?
