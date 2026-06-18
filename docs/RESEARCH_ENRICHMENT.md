# Research — Browser Capture & Enrichment Tasks (spec)

**Date:** 2026-06-17 · **Status:** **extension side implemented** (2026-06-17).
**Tester:** only the human operator can visually verify extension behaviour in a
real browser — keep a manual checklist with each capability (docs/feature-tests.md
→ "Research capture — *", "Research queue — *", "Research enrich *").

### Implementation status (2026-06-17)

| Section | Extension | Server | Notes |
|---|---|---|---|
| **§4 collectors** (media + structured) | ✅ shipped — `getCapturePageData` sends `media`/`structured` | ⏳ ignores them today (additive, harmless) | `ExtensionContentSubmit` has no `extra='forbid'`; filed for consumption. |
| **§5 domain categories** | ✅ shipped — category-aware queue UI | ✅ **already live** — `policy_category`/`policy_reason` + `gated_login`/`low_value` buckets on the queue | The doc under-stated the server here; it was ready. |
| **§3 enrich task kind** | ✅ built + unit-tested, **dormant** — fulfils a directive via existing capture primitives | ❌ no generator; asset-upload endpoint is `501` | Lights up the instant the server tags items `task_kind:'enrich'`. Capture-family goals work; artifact goals (screenshot/download/xhr_json/transcript) need the server sink — they return an honest "not available yet". |

Server-side follow-ups are filed via matrx-feedback (the enrich-task generator +
`enrich_goal` routing, `media`/`structured` consumption, and the `/sources/upload`
endpoint). The extension degrades gracefully against every gap.

---

## 1. Why the browser is the unlock

The AI Dream server scrapes via plain HTTP. That ceiling is real and low:

- It has **no logged-in session** — paywalls, member walls, and "sign in to
  continue" are invisible to it.
- It sees the **initial HTML**, not the **rendered DOM** — modern SPAs ship an
  empty shell + JS; the server gets the shell.
- It can't **interact** — no clicking "load more", expanding comments, dismissing
  consent walls, or scrolling infinite feeds.
- It can't see what the page's JS **fetched** (the clean JSON behind the UI), the
  **canvas/WebGL** it drew, or content inside **shadow DOM / cross-origin iframes**.

The extension runs **in the user's browser, as the user**. Everything above is
reachable. **This is the strongest reason to route work to the extension** — not
just as a fallback when the server is blocked, but as the *better* capture path
for a large class of high-value sources. It also means the extension should do
more than re-scrape a page: it should **enrich** — go get the specific thing the
server knows is missing.

---

## 2. What the browser can capture that the server cannot

Most of these already exist as extension **tools** (categories `reading` /
`interaction` / `capture`). The work is wiring them to research, not building
them.

| Capability | Server | Browser/extension | Research value |
|---|---|---|---|
| **Authenticated content** (paywall, member wall, logged-in app) | ❌ | ✅ user's own session | NYT/WSJ/journals/LinkedIn for users who subscribe |
| **JS-rendered / SPA DOM** | ❌ shell only | ✅ live DOM after render | most modern news/app sites |
| **Post-interaction content** (load-more, accordions, tabs, "show comments", consent/age gates) | ❌ | ✅ click + re-read | comment threads, expandable sections |
| **Infinite scroll / lazy media** | ❌ | ✅ scroll-to-load | feeds, image-heavy pages |
| **Network/XHR payloads** (the JSON the page fetched) | ❌ | ✅ observe requests | the *clean* data behind a messy UI |
| **Shadow DOM / web components** | ❌ | ✅ pierce shadow roots | component-based sites |
| **Cross-origin iframes** | ❌ | ✅ | embedded docs, players, widgets |
| **Screenshots** (full page / element / viewport) | ❌ | ✅ | charts, infographics, paywalled previews, visual evidence |
| **Canvas / WebGL** (maps, charts, viz) | ❌ | ✅ screenshot/extract | data viz that has no DOM text |
| **Authenticated / JS-triggered downloads** | ❌ | ✅ | gated PDFs, datasets, exports |
| **Reader-mode article extraction** (defuddle/readability — already in `runScrape`) | partial | ✅ cleaner | denoised article text |
| **Computed media** (`currentSrc`, `naturalWidth/Height`, `<video>` duration, captions) | ❌ | ✅ (images already sent) | exact media metadata — see RESEARCH_MEDIA_CAPTURE.md |
| **Structured data** (JSON-LD, microdata, OpenGraph — `collectMetadata`/`collectJsonLd`) | partial | ✅ | author/date/citation/schema |
| **Transcripts / captions** (YouTube, video players) | ❌ | ✅ open + capture | video sources become text |
| **Locale/region-gated content** | ❌ | ✅ user's region | region-specific sources |

> The collectors in `src/lib/scrape/collectors.ts` (`collectVideos`,
> `collectAudio`, `collectLinks`, `collectMetadata`, `collectJsonLd`) already
> produce much of this and are currently discarded for research. Sending them is
> low-effort, high-value (next section).

---

## 3. Two task kinds: SCRAPE vs ENRICH

Today every extension task is **scrape** — "open this URL, capture the page."
Add a second kind:

- **`scrape`** (existing) — capture the page's content (the capture ladder L1→L4).
- **`enrich`** (new) — the server knows a *specific* thing is missing and asks the
  extension to get exactly that, using a browser capability the server lacks.

An **enrich** task carries a **directive**: what to get + how. Shape (proposed —
mirror the existing scrape-queue item, add `task_kind` + `enrich`):

```jsonc
{
  "task_kind": "enrich",
  "source_id": "…", "topic_id": "…", "url": "https://…",
  "enrich": {
    "goal": "transcript",          // see catalog below
    "reason": "youtube source has no text content",
    "hints": { "selector": "…", "expect_chars_min": 500 }
  }
}
```

### Enrichment goal catalog (each maps to existing extension tools)

| `goal` | When the server emits it | Browser does | Returns |
|---|---|---|---|
| `rendered_dom` | server scrape was thin but page is a known SPA | settle + scroll, capture live `outerHTML` | html_content (level≥2) |
| `authenticated` | source host is login/paywall-gated AND the user has a session | capture as the logged-in user | html_content |
| `transcript` | source is YouTube/video with no text | open player, open transcript panel, capture | text content |
| `download` | a PDF/dataset link the server couldn't fetch (auth/JS) | trigger + capture the download | file → `/assets` or paste |
| `xhr_json` | page renders from an API the server can't see | observe network, capture the relevant JSON | structured data |
| `comments` | thread sites (Reddit/HN/forums) where replies are the value | expand + scroll comments, capture | html/text |
| `screenshot` | chart/infographic/visual-only source | full-page or element screenshot | image → `/assets`, rs_media |
| `structured` | citation/author/date/table missing | read JSON-LD/microdata/tables | structured fields |
| `expand` | content behind load-more/accordion/consent | click the obstacle(s), then capture | html_content |

The server posts enrichment results to the **same** `/extension-content` (for
html/text) or `/assets` (for files/screenshots) so persistence is unchanged.
Add an optional `enrich_goal` to the submit body so the server can route the
result (e.g. a `transcript` becomes content; a `screenshot` becomes an rs_media
image).

---

## 4. Immediate win — send the collectors you already compute

Before the full enrich machinery, ship this (it's already collected, just
discarded): in `captureAndSubmit`, alongside `images` (already sent), also send
`videos` (incl. `<video>` `currentSrc` + iframe YouTube/Vimeo), `audio`, and the
page `metadata`/`jsonLd`. The server already derives videos/PDFs from the HTML,
but the collectors catch **JS-injected** media and the **clean structured data**
the HTML scan can't. Proposed body extension:

```jsonc
{ "html_content": "…", "capture_level": 1, "images": [...],
  "media": { "videos": [...], "audio": [...] },
  "structured": { "metadata": {...}, "jsonLd": [...] } }
```

Server work to consume these is small (mirror the existing `images` overlay +
`collect_page_resources`). Until then it's harmless (ignored).

---

## 5. Domain-aware routing (why some sources should never be auto-scraped)

The server **already resolves** site categories (aidream `research/domain_policy.py`)
and surfaces them on every scrape-queue item as `policy_category` + `policy_reason`,
plus dedicated `gated_login` / `low_value` buckets. The extension treats them
differently in the queue UI (✅ implemented — see §5 status above):

- **`open`** — normal scrape ladder.
- **`login_required`** (e.g. NYT) — the server will NOT keep trying. The extension
  shows these as **"Sign in to capture"**: only actionable for a user who has a
  session. Pair with an `authenticated` enrich task. If the user can't/won't sign
  in, it stays parked with the reason shown — not retried.
- **`low_value`** (e.g. Facebook) — rarely relevant; do **not** auto-queue. Show
  under a collapsed "Low-value" group the user can opt into. Critically, these
  must NOT silently become expensive scrape tasks (30k chars of nav junk → a
  costly LLM cleanup for ~nothing).
- **`special`** (e.g. Reddit) — capturable and useful, but with a tuned selector;
  surface as a normal task but tagged so the user knows it's worth it.

The category + a human reason ("Login required", "Low-value source") come down on
the source/queue item so the **same labels** show in the extension and the web UI.

---

## 6. Server side — what exists, what's needed

**Exists:** `/extension-content` accepts `images` (browser-measured dims);
`research/domain_policy` resolves per-host/path policy (block / force-to-extension
levels / content selectors); the media gallery now renders videos/docs/audio.

**Needed (server):**
1. `task_kind` + `enrich` on the extension scrape-queue item + a generator that
   emits enrich tasks when it detects a gap (youtube w/o transcript, SPA-thin,
   gated host w/ user session, unfetched PDF link).
2. Accept `media`/`structured` (§4) and `enrich_goal` on the submit body.
3. Domain **categories** + user-facing reason (§5), surfaced on `rs_source`.

**Done (extension, 2026-06-17):** §4 collectors (`src/lib/scrape/capture-media.ts`
→ `getCapturePageData`, sent via `submitExtensionContent`); the category-aware
queue UI (§5, `src/features/tasks/TasksView.tsx`); the `enrich` executor (§3,
`src/lib/research/enrich.ts` + `enrich-types.ts`) reusing the existing capture
primitives, surfaced in the queue and dormant until the server emits enrich items.

---

## 7. Manual test checklist (operator-only)

For each capability shipped, verify in a real browser:
- [ ] `media`/`structured` appear in the `/extension-content` POST body
- [ ] an `authenticated` enrich on a logged-in paywall returns full text
- [ ] a `transcript` enrich on a YouTube source returns the transcript
- [ ] a `screenshot` enrich produces an rs_media image
- [ ] `login_required` sources show "Sign in to capture" and are NOT auto-retried
- [ ] `low_value` sources do NOT auto-queue and never trigger an LLM cleanup
