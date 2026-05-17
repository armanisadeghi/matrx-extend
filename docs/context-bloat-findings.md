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

## Open questions for next traces

- Does any other small model (e.g. Cerebras Qwen, Mistral, Gemini Flash)
  follow the same `read_page(false)` pattern? If yes → universal.
- Does a Cerebras trace where `page` category is pre-loaded behave like
  Opus's? If yes → confirms the fix is "make `get_page_text` reachable".
- Does Opus's single-call `max_nodes:400` strategy generalize? Or does
  he break when the page truly has 1000+ elements?
