# Server needs — research browser-capture enrichment

Companion to [RESEARCH_ENRICHMENT.md](./RESEARCH_ENRICHMENT.md). The **extension
side is shipped** (commit on `main`, 2026-06-17). These are the aidream-side
contracts that complete the loop. Every one is additive and back-compatible — the
extension degrades gracefully against each gap today, so there is no rush and no
breakage, but each item is wasted effort on the client until the server consumes it.

> Filed here rather than via matrx-feedback because that MCP rejected a service
> submission (FK to a real user) and the AI Dream feedback tool is admin-only.
> An admin should mirror these into the tracker.

Master server reference: `aidream/research/docs/EXTENSION_API.md`.

---

## 1. Consume `media` + `structured` on extension-content (§4) — small

**Route:** `POST /research/topics/{topic_id}/sources/{source_id}/extension-content`
**Model:** `aidream/research/models.py` → `ExtensionContentSubmit`

The extension now sends two new optional keys (gathered from the LIVE DOM in one
injection, so they hold what the HTML scan can't):

```jsonc
{
  "html_content": "…", "capture_level": 1, "images": [...],   // unchanged
  "media": { "videos": [{ "src": "…", "poster": null, "duration": 12.3 }],
             "audio":  [{ "src": "…", "type": "audio/mpeg" }] },
  "structured": { "metadata": { "title", "description", "canonical", "lang",
                                "og": {…}, "twitter": {…}, "schemaTypes": [...] },
                  "jsonLd": [ /* raw JSON-LD objects */ ] }
}
```

`ExtensionContentSubmit` has no `extra='forbid'`, so these are ignored today (a
true no-op). **Needed:** add optional `media` + `structured` fields and feed them
into the existing pipeline:
- `media.videos` / `media.audio` → `collect_page_resources` / `schedule_media_ingest`.
  Today those derive video/audio only from the parsed HTML, so JS-injected players
  (and YouTube/Vimeo iframes resolved post-render) are missed.
- `structured.metadata` / `structured.jsonLd` → wherever author/date/citation/schema
  is extracted — cleaner than re-parsing the HTML.

The two keys are only attached when non-empty, so a media-less page POSTs the exact
legacy body.

---

## 2. Generate `enrich` tasks + route `enrich_goal` (§3) — the main piece

**Queue route:** `GET /research/extension/scrape-queue` (`ExtensionScrapeItem`)
**Submit route:** `POST …/extension-content` (`enrich_goal` field)

The extension fulfils an enrich directive by reusing its capture primitives
(settle/scroll/click-obstacles → capture rendered DOM → submit with `enrich_goal`).
It is built, unit-tested, and surfaced in the queue UI — **dormant only because no
server emits enrich tasks**.

**Needed:**

1. Tag a queue item with `task_kind:'enrich'` + an `enrich` directive when the
   server detects a SPECIFIC gap a plain re-scrape won't fix. Shape the client
   already parses (all optional except `goal`):

   ```jsonc
   "task_kind": "enrich",
   "enrich": {
     "goal": "rendered_dom",                 // catalog below
     "reason": "SPA shipped an empty shell",  // shown to the user
     "hints": { "selector": "#load-more", "expect_chars_min": 500 }
   }
   ```

   Goal catalog & natural generators:
   | goal | emit when |
   |---|---|
   | `rendered_dom` | server scrape thin but host is a known SPA |
   | `authenticated` | host is `gated_login` (domain_policy) AND the user has a session |
   | `expand` | content behind load-more / accordion / consent |
   | `comments` | thread sites where replies are the value (Reddit/HN/forums) |
   | `structured` | citation / author / date / table missing |
   | `transcript` | YouTube/video source with no text *(needs sink #1+upload)* |
   | `screenshot` | chart/infographic/visual-only source *(needs upload #3)* |
   | `download` | gated/JS PDF or dataset the server couldn't fetch *(needs upload #3)* |
   | `xhr_json` | page renders from an API the server can't see *(needs CDP wiring)* |

   The capture-family goals (`rendered_dom`/`authenticated`/`expand`/`comments`/
   `structured`) work through the existing content sink TODAY — start with those.

2. Accept + route `enrich_goal` on the extension-content body (client sends it now;
   server ignores it harmlessly). Route the result: a `transcript`/`comments`/
   `rendered_dom` result becomes content; a `screenshot` becomes an rs_media image
   (needs #3).

---

## 3. Implement the asset-upload endpoint (§3 screenshot/download) — unblock artifacts

**Route:** `POST /research/topics/{topic_id}/sources/upload`
**Today:** `aidream/api/routers/research.py:1349` raises **HTTP 501**
("File upload will be implemented with multipart support").

This is the only sink for binary research artifacts, so the extension's
`screenshot` and `download` enrich goals have nowhere to land — `planEnrich`
marks them unsupported and the UI shows an honest "not available yet, needs the
research asset-upload endpoint".

**Needed:** implement upload (multipart or base64), persist the file, and create
the matching `rs_media` row (image for screenshots, document for downloaded
PDFs/datasets) tied to `{topic_id}` (+ optional `source_id`). Lowest priority of
the three — the capture-family enrich goals and §4 collectors deliver value first.
