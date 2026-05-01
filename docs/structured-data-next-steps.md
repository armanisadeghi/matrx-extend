# Structured Data — Next Steps

After the v1 build, you correctly identified that the gold prize isn't the
*data* — it's a **reusable, auto-applied pattern**. Today the system saves
patterns but doesn't auto-trigger them, doesn't ask about route generality,
and AI-extract doesn't produce a pattern config you can re-run without AI.

This file captures the plan to close those gaps and the agent spec to give
the agent-builder.

---

## Goal

When you visit a page that matches a saved pattern's domain + route:

1. **Auto-detect** that a pattern matches.
2. **Auto-extract** in the background (non-blocking).
3. **Surface results** in the side panel — already-done, no clicks.
4. **Persist** the rows into the chosen `user_table` (if configured).
5. **Same pattern works server-side** — backend cron worker re-runs without
   the user being present.

Today: you click List Pattern → Extract → Save (popover). Next visit:
nothing. The pattern just sits in `wbx_pattern`.

---

## Phase 1 — Local auto-trigger (sidepanel)

### Behavior

- On every tab/url change, sidepanel calls `fetchPatternsForDomain(host)`.
- For each pattern, run `urlMatchesPattern` ([matcher.ts](../src/lib/data-pattern/matcher.ts)) against the current URL.
- For matched patterns: call `runPattern(pattern, tab.id)`, cache the rows
  in zustand state keyed by `${tab.url}|${pattern.id}`.
- DataView (and a new "Auto-extracted" surface) shows the cached rows
  without requiring a click.
- After successful run, append rows to `target_user_table_id` if set, via
  the `append_rows_to_user_table` RPC we already have.

### What changes

| File | Change |
|---|---|
| `src/state/auto-extract.ts` (new) | Zustand store: `Map<patternId, {rows, lastRunAt, status}>`. |
| `src/hooks/use-auto-extract.ts` (new) | Watches `useActiveTab().url`, debounces 500ms after URL change, runs all matching patterns, writes to the store. |
| [DataView.tsx](../src/features/data/DataView.tsx) | Show "auto-extracted" badge on patterns that fired automatically; surface a "Run again" button that calls `runPattern` manually. |
| [ShowcaseView](../src/features/showcase/ShowcaseView.tsx) | Add an "Auto" status indicator at the top — "3 patterns matched this URL, 47+12+1 rows extracted in background". |

### UX rule

**Never auto-extract without consent.** When the user saves a pattern,
SaveAsPattern should add a checkbox: "Run this automatically when I visit
matching URLs" (default ON). Stored as `wbx_pattern.auto_run BOOLEAN DEFAULT
true`. The extension only auto-fires patterns with `auto_run = true`.

### Migration

```sql
alter table public.wbx_pattern
  add column if not exists auto_run boolean not null default true;
```

That's it for Phase 1.

---

## Phase 2 — Route-pattern suggestion at save time

When you save a pattern from `https://electronic.vegas/edc-week-las-vegas-calendar-guide/`,
the SaveAsPattern dialog should ask:

> Does this pattern apply to other pages on `electronic.vegas`?
>
> ○ Just this URL (current behavior)
> ● Other pages with the same path shape: `/[slug]-las-vegas-calendar-guide/`
> ○ Any page on `electronic.vegas`
> ○ A custom glob: `/blog/**`

The "same path shape" detection is a heuristic — replace last segment with
`*`. The user picks; we save the corresponding `route_pattern`.

**Why this matters:** the user's example says it perfectly: *"This is the
perfect example we often see that when a site has a pattern, that pattern
is often reused."* One pattern saved on `/edc-week-...` should auto-fire on
all the sister calendars too.

---

## Phase 3 — Pattern from AI extraction

You correctly noted: AI Extract gives data, not a pattern. After AI extracts
rows successfully, we should call a SECOND agent that converts the
extraction into a reusable List-Pattern config. Once we have the config,
future runs need no AI.

### Flow

1. User runs AI Extract → rows return successfully.
2. UI offers a button: **"Save as auto-pattern"**.
3. Click triggers a second agent (the "pattern-from-data" agent below).
4. We capture 2-3 sample HTML cards via DOM probing matching the rows'
   structure.
5. Send agent: page URL + 2-3 sample HTML + extracted rows + the user's
   description.
6. Agent returns a `list_pattern` config (`list_root`, `item_selector`,
   `field_paths`).
7. We test-run that config in the page; if rows match, save it. If not,
   surface a diff and let the user adjust.

This is the biggest UX leverage: **the user describes what they want once,
and we permanently encode it as a non-AI pattern**.

### Agent spec (give to agent-builder)

```
NAME: pattern-from-extracted-data

PURPOSE
  Given a webpage's URL, 1-3 sample HTML cards (the repeating items the
  user wants), and the structured rows that an AI extractor already pulled
  from those cards, produce a List-Pattern config that re-creates those
  rows by pure DOM extraction (no AI). The output is a JSON object the
  matrx-extend Chrome extension can save and auto-run on future visits.

VARIABLES (in addition to user_input)
  - page_url        (string)        URL of the page.
  - page_metadata   (json)          Optional: title, description, og.
  - sample_html     (string[])      1-3 outerHTML strings of repeating items
                                    (capped to ~3KB each by the caller).
  - extracted_rows  (json[])        The rows the AI extracted. Each row is
                                    one object whose keys are user-chosen
                                    field names and whose values came from
                                    the corresponding sample item. This is
                                    the GROUND TRUTH the pattern must match.
  - list_root_hint  (string)        Optional: a CSS selector the user
                                    already picked for the list root.

USER INPUT
  Free text. Usually the same description the user wrote for the AI
  extractor (e.g. "every concert listing — name, date, venue, ticket URL").

REQUIRED RESPONSE (JSON, single fence)

  {
    "kind": "list_pattern",
    "config": {
      "list_root": "css-selector-of-the-parent-element",
      "item_selector": "css-selector-relative-to-list_root-that-matches-each-card",
      "field_paths": [
        {
          "name": "snake_case_field_name",
          "rel_selector": "css-selector-relative-to-an-item",
          "attr": "optional-attribute-name (e.g. href, src, content); omit for innerText"
        }
      ]
    },
    "confidence": "high | medium | low",
    "notes": "string — anything the user should know (e.g. 'rating is computed from a class name and may break')",
    "warnings": [
      "string — risk callouts: fragile selectors, fields whose extracted
       value couldn't be matched in the sample HTML, etc."
    ]
  }

BEHAVIOR EXPECTATIONS

  1. Selectors must MATCH THE EXTRACTED VALUES. For each field in
     extracted_rows[0], find the source element in sample_html[0] and
     produce a selector that yields the same string.

  2. Prefer stable selectors in this order:
       a. [itemprop="..."]                       (microdata — best)
       b. [data-testid="..."], [data-qa="..."]   (test hooks — usually stable)
       c. tag.<filtered-class>                   (filter out auto-gen hashes
                                                  like css-abc123, jsx-1)
       d. structural :nth-of-type                (last resort)

     Selectors must be RELATIVE to one item. Do NOT include the list_root
     in field selectors.

  3. For attribute fields (href, src, content, datetime, value), prefer
     setting "attr" rather than reading innerText.

  4. If a field in extracted_rows can't be located in sample_html, OMIT it
     from field_paths and include a warning ("could_not_locate: <name>").
     Don't guess — better to miss a field than break the pattern.

  5. If list_root_hint is provided, USE IT — don't second-guess the user.

  6. If sample_html contains NESTED itemscope microdata wrapping the
     repeating item (e.g. WebPage > Event), use the inner item type's
     selector for item_selector (e.g. li[itemtype$="schema.org/Event"]).

  7. Cap field_paths at 12. The user can add more later.

EXAMPLE INPUT

  user_input: "every concert listing on this page — name, date, venue, ticket URL, age range"
  page_url: "https://electronic.vegas/edc-week-..."
  sample_html: ["<div class=\"wideeventwrapper\">...</div>"]
  extracted_rows: [{
    "Event Name": "Cedric Gervais",
    "Date & Time": "Friday, May. 1, 2026 at 11:00 am",
    "Venue": "Tao Beach at the Venetian",
    "Ticket URL": "https://electronic.vegas/event/cedric-gervais-tao-beach-vegas-may-1/",
    "Age Range": "21+"
  }]

EXAMPLE OUTPUT

  {
    "kind": "list_pattern",
    "config": {
      "list_root": "#wideeventsList",
      "item_selector": "div.wideeventwrapper",
      "field_paths": [
        { "name": "event_name", "rel_selector": "[itemprop=\"name\"]" },
        { "name": "date_time", "rel_selector": "li.wideeventDate", "attr": null },
        { "name": "venue", "rel_selector": "[itemprop=\"location\"] [itemprop=\"name\"]" },
        { "name": "ticket_url", "rel_selector": "li.wideeventTitle a", "attr": "href" },
        { "name": "image_url", "rel_selector": "meta[itemprop=\"image\"]", "attr": "content" },
        { "name": "start_date", "rel_selector": "meta[itemprop=\"startDate\"]", "attr": "content" }
      ]
    },
    "confidence": "high",
    "notes": "Extra fields image_url and start_date pulled from microdata <meta> tags inside the card — not in the original AI rows but present in the HTML.",
    "warnings": []
  }
```

---

## Phase 4 — Server-side auto-runs

Out of scope for this repo (lives in your backend), but the schema we
shipped already supports it. Once the cron worker exists, your backend can:

1. Read `wbx_pattern` rows where `auto_run = true` and `last_run_at <
   now() - interval`.
2. Render the URL via headless browser.
3. Call `runPattern` server-side (port the dispatcher; or just re-implement
   each mode's `runInPage` body in Python/Playwright since the modes are
   self-contained).
4. Append rows via the `append_rows_to_user_table` RPC.
5. Update `last_run_at`, `last_status`, `last_run_count`.

This is what gives the user *"it just shows up in my knowledge base"* —
the magic moment.

---

## Implementation order recommendation

If we have ~1 day:
1. Phase 1 (local auto-trigger) — biggest immediate UX win.
2. Phase 2 (route-pattern suggestion at save) — small, high leverage.

If we have ~3 days:
3. Phase 3 (pattern-from-data agent) — wire it AFTER you've created the
   agent in your agent-builder. The extension side is ~half a day of work.

Phase 4 lives on your backend. Once Phases 1-3 ship and you trust the
patterns, the cron worker is a contained build.
