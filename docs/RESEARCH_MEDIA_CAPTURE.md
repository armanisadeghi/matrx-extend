# Research Media Capture — Handoff

**Date:** 2026-06-17
**Branch:** `feat/research-media-capture`
**Status:** implemented, typechecks (`npm run compile` ✓), **not yet runtime-tested in a loaded extension** — please verify, then ship.

This documents one small extension change made as part of fixing the AI Matrx
**research Media Gallery** (which showed no image dimensions and no files/videos).
Most of that fix is server-side; the extension's only job here is to hand the
server a bit more of what it already knows.

---

## What changed in the extension

The research capture flow (`features/tasks/TasksView.tsx` → `captureAndSubmit`)
already sends the page's raw `document.documentElement.outerHTML` to
`POST /research/.../extension-content`. It now **also** sends the browser's
measured image dimensions.

| File | Change |
|---|---|
| `src/lib/scrape/capture-media.ts` | **NEW.** `getCaptureImages(tabId)` — reads each `<img>`'s `currentSrc` + `naturalWidth`/`naturalHeight` from the loaded DOM via `chrome.scripting.executeScript`. Mirrors `collectImages()` in `collectors.ts`, inlined because the injected `func` can't import. Best-effort: returns `[]` on failure. |
| `src/lib/api/routes/research.ts` | `submitExtensionContent(...)` gained an optional `images: ExtensionImagePayload[]` arg, added to the POST body. New exported `ExtensionImagePayload` type. |
| `src/features/tasks/TasksView.tsx` | After `getOuterHtml`, calls `getCaptureImages(tabId)` and passes the result to `submitExtensionContent`. |

### Wire contract (additive, backward-compatible)

```
POST /research/topics/{topicId}/sources/{sourceId}/extension-content
{
  "html_content": "<raw outerHTML>",
  "capture_level": 1 | 2 | 3,
  "images": [ { "src": "https://…", "alt": "…|null", "width": 1280, "height": 720 }, … ]
}
```

`images` is optional. The server overlays `width`/`height` (the true
`naturalWidth`/`naturalHeight`) onto its HTML-parsed images by exact `src`, so
the gallery gets exact sizes **without re-downloading** each image. Older
builds that omit `images` still work — the server falls back to HTML attrs / URL
patterns / a server-side byte-probe. Server contract:
`aidream/research/media/FEATURE.md`.

---

## Why there is NO lazy-load timing change

The investigation flagged that Level-1 ("quick") capture doesn't scroll, so
lazy images can arrive as placeholders. We deliberately did **not** add a scroll
to Level 1: the capture ladder is designed so **L1 = quick, L2 = scroll,
L3 = user-gated** — a thin L1 escalates to L2, which already scrolls to fire lazy
loaders. Forcing a scroll into L1 would fight that architecture. The server-side
parser also already reads `data-src`/`data-lazy`, covering the common lazy
pattern. So lazy-load handling stays exactly as-is.

---

## What the extension does NOT need to send (handled server-side)

The same server fix also makes **files & videos** show up (PDFs, YouTube/Vimeo,
audio). That is driven entirely off the **HTML the extension already sends** —
the server parses `<video>`/`<audio>` tags, PDF/doc/video **links**, and even
embedded **`<iframe>` YouTube/Vimeo** players out of the raw HTML. So no extra
extension payload is required for files/videos today.

**Next, bigger step → see [`RESEARCH_ENRICHMENT.md`](./RESEARCH_ENRICHMENT.md):**
the browser can capture a large class of things the server can't (authenticated
content, rendered SPA DOM, XHR JSON, transcripts, screenshots, expanded comments).
That doc specs sending the already-computed `collectVideos()`/`collectAudio()`/
`collectMetadata()` collectors **and** a new `enrich` task kind — where the server
asks the extension to get a *specific* missing thing, not just re-scrape a page.

---

## Test checklist (before shipping)

1. `npm run compile` (tsc) — already green.
2. `npm run lint` — the one `forEach` warning in `capture-media.ts` matches the
   existing pattern in `collectors.ts` (9 identical warnings there); not new.
3. Load the extension, open the Tasks tab, run a Level-1/2/3 capture on a
   real research source.
4. In the network panel, confirm the `/extension-content` POST body contains a
   non-empty `images` array with numeric `width`/`height`.
5. In the AI Matrx research UI → topic → **Media** tab, confirm images show
   exact dimensions and the **Documents/Videos** sections populate.
