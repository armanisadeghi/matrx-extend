# Screenshot capabilities — provider limits + proposal

> Research date: 2026-05-03
> Branch: `claude/research-screenshot-capabilities-vw1rd`
> Mission: capture the highest-fidelity screenshot we can without
> blowing past any provider's image-input ceiling, and without paying
> tokens for pixels the model is going to throw away.

---

## 1. Where we are today

### 1.1 `take_screenshot` — `src/lib/tools/handlers/read.ts:127–271`

| Setting | Value | Notes |
|---|---|---|
| Capture API | `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })` | Visible viewport only. PNG out, then re-encoded by us. |
| Output format | `jpeg` (default) / `png` | We always capture PNG and re-encode JPEG ourselves so `quality` is honored. |
| JPEG quality | 80 | |
| `max_dimension` | **1568 px** (longest side) | Hard-coded "Anthropic / OpenAI sweet spot." |
| Resize logic | OffscreenCanvas + `createImageBitmap` | Aspect-ratio preserved. |
| Encoding | base64 (no `data:` prefix), returned with `media_type` | Server passes `media_type` verbatim into image content blocks. |

### 1.2 `cdp_full_page_screenshot` — `src/lib/tools/handlers/cdp.ts:85–157`

| Setting | Value | Notes |
|---|---|---|
| Capture API | CDP `Page.captureScreenshot` w/ `captureBeyondViewport: true` and `clip` from `Page.getLayoutMetrics` | Full page, no scroll-stitch. |
| Output format | `jpeg` (default) / `png` / `webp` | |
| JPEG quality | 80 | |
| `capture_scale` | **0.5** (half resolution) | Default. Range 0.1–1.0. |
| Post-capture resize | **None** | We trust `capture_scale` to keep tokens down. |

### 1.3 Provider routing

The extension does **not** know which provider/model the conversation will hit
— `POST /ai/agent/{agent_id}` is multiplexed server-side. There is no client-side
hint of model in `client.state["browser-dom"]`. So **any image we emit has to
land safely on the smallest common denominator across Anthropic, Google, and OpenAI**
unless we add a hint.

### 1.4 Known issues with the current setup

1. **`capture_scale: 0.5` on a tall page** still produces images that violate
   provider per-image dimension caps. A 1920-wide page at scale 0.5 gives a 960
   px wide capture, but the height can be 10,000+ px on a long article — that
   blows past Anthropic's 8000-px hard cap and Gemini's 3072-px max
   (post-resize), and forces OpenAI's `auto` mode to aggressively downsample.
2. **No post-CDP resize step** for `cdp_full_page_screenshot` — we emit raw
   pixels straight from the protocol.
3. **No file-size guard.** Base64 grows ~33% over the binary. Anthropic's
   request size cap is 32 MB; a tall full-page WebP can exceed that on its own.
4. **No `media_resolution` / `detail` hint** passed through to the server even
   though Gemini and OpenAI honor a per-image quality knob.
5. **`max_dimension: 1568` is now leaving capability on the floor** for Opus 4.7
   (which natively accepts 2576) and for GPT-5.5 (which accepts up to 2048 at
   `high` and up to 6000 at `auto`/original).

---

## 2. Provider specs (verified from primary docs, May 2026)

### 2.1 Anthropic Claude — [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision), [Opus 4.7 release notes](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)

| Limit | Value | Notes |
|---|---|---|
| Hard max dimensions | **8000 × 8000 px** | Reduced to **2000 × 2000** if >20 images in one request. |
| Recommended long-edge — Sonnet 4.6 / Haiku 4.5 / older | **1568 px** (≈ 1.15 MP) | Anything bigger is auto-downscaled server-side; we still pay for the original tokens until downscale. |
| Recommended long-edge — **Opus 4.7** | **2576 px** (≈ 3.75 MP) | New native support. Coordinates are now 1:1 with pixels — no rescale math needed for bbox/click outputs. |
| Token formula | `width × height / 750` | |
| Native max tokens / image | 1568 (older) or **4784** (Opus 4.7) | |
| Padding | Bottom + right padded to multiple of **28 px** | Pre-resizing avoids surprise padding tokens. |
| Supported formats | JPEG, PNG, GIF (1st frame), WebP | |
| Request size cap | **32 MB** total request body | |
| Images / request | 100 (200k-context models), 600 otherwise | |
| Anti-pattern | Heavy lossy re-compression hurts text legibility — confirm settings on actual outputs. | |

### 2.2 Google Gemini — [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)

| Limit | Value | Notes |
|---|---|---|
| Hard max dimensions | **3072 × 3072 px** | Larger is scaled down + padded to fit. |
| File size / image | **7 MB** (Gemini 3 Pro) | |
| Supported formats | JPEG, PNG, WebP, HEIC, HEIF | |
| Images / prompt | Up to **3000** | |
| Tile geometry (2.5) | If either dim > 384 px → tile into chunks of `min(w,h)/1.5` clamped to 256–768 px, each tile resized to 768×768 → **258 tokens / tile**. | |
| Tile geometry (≤ 384 px on both sides) | **258 tokens** flat. | |
| `media_resolution` parameter (Gemini 3) | LOW = **280 tok/img**, MEDIUM = **560 tok/img**, HIGH = **1120 tok/img** | Per-part — can mix in one request. |
| Default | MEDIUM | Reserve HIGH for diagrams / fine text. |

### 2.3 OpenAI GPT — [Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision), [GPT-5.5 doc](https://developers.openai.com/api/docs/models/gpt-5.5), [Multimodal cookbook](https://developers.openai.com/cookbook/examples/multimodal/document_and_multimodal_understanding_tips)

| Limit | Value | Notes |
|---|---|---|
| File size / image | **20 MB** (GPT-5+) — **50 MB total payload** for GPT-4o-class | |
| Supported formats | PNG, JPEG, WebP, non-animated GIF | |
| Images / request | 500 | |
| **GPT-4o** `detail: low` | Resized to 512 × 512 → flat **85 tokens**. | |
| **GPT-4o** `detail: high` | Fit inside 2048 × 2048 → shortest side scaled to 768 → tiled into 512 × 512 tiles → **85 + 170 × N tiles**. | |
| **GPT-4o** `detail: auto` | Heuristic — picks low/high per image. | |
| **GPT-5 / 5.4** `high` | Preserved without resizing **up to 2.56 MP and 2048-px max dim**. | |
| **GPT-5.5** `auto` (= "original") | Preserved up to **10.24 MP** and **6000-px max dim**. | New as of GPT-5.5. |
| **GPT-5.5** `high` | Up to **2.5 MP** and **2048-px max dim** preserved. | |
| **GPT-5.5** `low` | Resized aggressively above **512-px max dim**. | More aggressive than 4o. |

### 2.4 Smallest common denominator (no model hint)

If we can't tell which provider we're talking to:

| Constraint | Tightest value | Source |
|---|---|---|
| Max single dimension | **2048 px** (long edge) | OpenAI `high` cap; also fits Gemini and Sonnet/Haiku comfortably. |
| Max total pixels | **2.5 MP** | OpenAI `high` cap. |
| File size | **7 MB** | Gemini per-image cap. |
| Format | **JPEG q ≈ 80** | Universally accepted; smallest payload; text still legible. |
| Padding-friendly | Round dims to multiple of **28** | Anthropic-friendly; harmless elsewhere. |

This is the safe default we should ship today. Above that, we need a model hint.

---

## 3. The "ideal" capture per provider

| Provider / model | Long edge | Total pixels | Format | Quality | Notes |
|---|---|---|---|---|---|
| Sonnet 4.6 / Haiku 4.5 | **1568 px** | ≤ 1.15 MP | JPEG | 80 | What we ship today — leave it. |
| **Opus 4.7** | **2576 px** | ≤ 3.75 MP | JPEG | 85 | Higher quality is worth the extra ~3× tokens for screenshots. |
| Gemini 2.5 / 3 (default MEDIUM) | **1536 px** | ≤ 2.25 MP | JPEG | 80 | Tile structure means 768-px multiples are most efficient. |
| Gemini 2.5 / 3 (HIGH, OCR / diagrams) | **3072 px** | ≤ 9 MP | JPEG | 85 | Pay 1120 tok/image for crisp text; opt-in. |
| GPT-5.5 `auto` | **2048 px** | ≤ 2.5 MP | JPEG | 85 | Sweet spot. Only go above if `image_detail: "original"` is wanted. |
| GPT-5.5 `original` (text-heavy) | **6000 px** | ≤ 10.24 MP | PNG | n/a | Forensic / OCR mode only — pricey. |
| GPT-4o `low` | 512 px any dim | n/a | JPEG | 70 | Fixed 85-token cost — great for "is this a login page?" scout shots. |

### 3.1 Universal "good enough" preset

When we don't know the provider:

```
long_edge   = 1920 px      // covers GPT-5.5 high, Opus 4.7 (slightly under 2576), Gemini MEDIUM
total_px    = ≤ 2.07 MP    // 1920 × 1080 reference
format      = jpeg
quality     = 80
size_guard  = ≤ 5 MB binary (≤ 6.7 MB base64) — well under the 7 MB Gemini cap
```

`1920` is chosen over `2048` because it's a hair under OpenAI's `high` cap and
tracks the most common monitor width — most websites' visible viewport is
≤ 1920 px wide so resizing rarely fires on `take_screenshot`.

---

## 4. Proposal — concrete changes

### Change 1 — bump default `max_dimension` from 1568 → **1920** (universal)

**File:** `src/lib/tools/handlers/read.ts:142`

```diff
- max_dimension: z.number().int().min(0).max(8192).optional().default(1568),
+ // Universal default that respects every provider's "no resize" sweet spot:
+ //   - Anthropic Sonnet/Haiku will downscale to 1568 server-side (free for us).
+ //   - Anthropic Opus 4.7 keeps native fidelity (2576 cap).
+ //   - Gemini stays well under the 3072 cap and slots into MEDIUM-tier tiles.
+ //   - OpenAI GPT-5.5 `high` accepts up to 2048; 1920 stays under without round-trip.
+ max_dimension: z.number().int().min(0).max(8192).optional().default(1920),
```

Why not 2048? Three reasons: (a) Sonnet/Haiku resize to 1568 anyway, so 1920 is
already past the marginal benefit there; (b) 1920 matches the typical viewport
width so most captures don't need resizing at all; (c) it gives Anthropic
padding headroom (rounded to multiples of 28) without crossing 2048.

### Change 2 — add a `mode` preset to `take_screenshot`

Replace the raw `max_dimension` knob with a friendlier preset list, while still
allowing override:

```ts
const ScreenshotArgs = z.object({
  format: z.enum(['png', 'jpeg']).default('jpeg'),
  quality: z.number().int().min(1).max(100).optional().default(80),
  max_dimension: z.number().int().min(0).max(8192).optional(),
  /**
   * Convenience preset. Sets max_dimension + quality if not explicitly given.
   *   - "scout"   → 768 px / q70   — cheap scan ("what is this page?")
   *   - "default" → 1920 px / q80  — universal sweet spot
   *   - "hi-res"  → 2560 px / q85  — Opus 4.7 native, GPT-5.5 original-ish
   *   - "ocr"     → 3072 px / q90  — text-heavy pages; expensive everywhere
   */
  mode: z.enum(['scout', 'default', 'hi-res', 'ocr']).optional().default('default'),
}).default({});
```

The handler picks `max_dimension` / `quality` from the preset only when the
caller didn't pass them explicitly. This gives the agent one knob (`mode`) to
turn instead of two co-dependent ones.

### Change 3 — post-capture resize for `cdp_full_page_screenshot`

**File:** `src/lib/tools/handlers/cdp.ts:85–157`

`Page.captureScreenshot` with `clip.scale` reduces resolution but does NOT cap
the long edge — a 12,000-px article at scale 0.5 still emits a 6,000-px tall
image. We need to defend against the per-image dimension cap:

```diff
   capture_scale: z.number().min(0.1).max(1).optional().default(0.5),
+  /**
+   * After capture, downscale so the longest side fits this many pixels.
+   * Default 4096 — leaves room for Gemini HIGH and Opus 4.7 + headroom for tall pages.
+   * Pass 0 to skip.
+   */
+  max_dimension: z.number().int().min(0).max(8192).optional().default(4096),
+  /**
+   * If the encoded image exceeds this many bytes, the handler re-encodes at lower
+   * quality (steps of -10) until it fits. Default 6 MB — under Gemini's 7 MB cap.
+   */
+  max_bytes: z.number().int().min(50_000).max(20_000_000).optional().default(6_000_000),
```

Implementation: after `Page.captureScreenshot`, base64-decode → `createImageBitmap`
→ resize via OffscreenCanvas (same path as `processScreenshot` in `read.ts` —
extract that into a shared helper) → re-encode → if `byteLength > max_bytes`,
loop quality down by 10 until under. Return the **final** dims + bytes plus the
**source** dims so the agent can map clicks/coordinates back to the live page.

### Change 4 — extract a shared `encode-screenshot.ts` helper

`processScreenshot` in `read.ts:172–230` becomes a shared module so both
`take_screenshot` and `cdp_full_page_screenshot` use identical scaling +
re-encoding + size-guard logic.

Suggested location: `src/lib/screenshots/encode.ts` (new file).

### Change 5 — surface a `screenshot_hint` in `client.state["browser-dom"]`

Today the server has to assume one provider. Add a forward-compatible field so
the server can either echo back what it picked or so we can hint based on the
agent the user chose:

```ts
// src/lib/chat/build-browser-dom-state.ts — add to BrowserDomState
screenshot_capability: {
  /** Long-edge cap we honored on capture. */
  max_dimension: number;
  /** Format we emit by default. */
  format: 'jpeg' | 'png';
  /** True if this client can re-capture at higher resolution if asked. */
  can_upscale: boolean;
};
```

Server can then route: if it's calling Opus 4.7 it asks the next
`take_screenshot` to use `mode: "hi-res"`; for GPT-4o it can stick with
`default` or downgrade to `scout`. No extension change needed once the
parameter is plumbed.

### Change 6 — return `byte_length` as **decoded** bytes, not base64 chars

**File:** `src/lib/tools/handlers/read.ts:264`, `cdp.ts:151`

We currently return `byte_length: image_base64.length` — that's the base64
string length, not the binary size. Swap to `Math.floor(image_base64.length * 3 / 4)`
(or compute it on the Blob before encoding). The server uses this for budget
math — letting it think the image is 33% bigger than reality is silently wrong.

### Change 7 — drop `format: 'png'` for `cdp_full_page_screenshot` defaults; keep `jpeg`

Already correct (line 89). No change. Leaving this here as a confirmation —
PNG full-page captures routinely exceed 32 MB on long articles and would brick
Anthropic requests.

### Change 8 — document multi-image batching constraints

Add a one-paragraph note to `take_screenshot` and `cdp_full_page_screenshot`
descriptions noting that **>20 images / request silently halves Anthropic's
per-image cap to 2000 × 2000**. The agent doesn't know this; the description
should warn it (or `browser_batch` should refuse to combine more than 20
screenshot calls).

### Change 9 — add a `take_screenshot_low` shortcut tool? *(optional, defer)*

OpenAI's `low`-detail mode is genuinely cheap (85 tokens flat) and great for
scout shots. We could either expose `mode: "scout"` (covered in Change 2) or
ship a dedicated `take_screenshot_low` discoverability tool. **Recommend
sticking with the `mode` preset for now** — adding tools costs context surface
on every turn.

---

## 5. Test plan

After implementing changes 1–6:

1. **Snapshot a 1920×1080 page with `mode: "default"`** — verify long-edge
   ≤ 1920, base64 length ≈ 200–400 KB, `byte_length` is decoded bytes.
2. **Snapshot a 4K monitor at `mode: "default"`** — verify resize fires, output
   ≤ 1920 px.
3. **Full-page snapshot a 12,000-px tall article** — verify post-capture
   downscale fires, output ≤ 4096 px on long edge, ≤ 6 MB binary.
4. **Round-trip a JPEG from the agent timeline through `chrome.tabs.sendMessage`
   to a content script that draws it on a canvas** — verifies no base64 padding
   or `data:` prefix issues.
5. **Multi-screenshot batch (`browser_batch` × 5)** — confirm we stay under the
   Anthropic 32 MB request cap.
6. **OCR-heavy page (`mode: "ocr"`)** — confirm the agent gets readable text on
   small fonts and that the upgrade is opt-in.

Manual smoke-test these in the **Tools tab** (`src/features/tools/ToolsView.tsx`)
which runs the same dispatcher path the agent uses.

---

## 6. Order of operations

1. Change 4 (extract `encode-screenshot.ts`) — pure refactor, no behavior change.
2. Change 6 (decoded `byte_length`) — single-line fix, ride along with #4.
3. Change 1 + 2 (default `max_dimension` + `mode` preset) — one PR, internal
   only, behavior change is "screenshots are slightly larger by default."
4. Change 3 (CDP post-capture resize + size-guard) — one PR, gated by
   admin-only flag for a day to check no regressions on long pages.
5. Change 5 (`screenshot_capability` hint) — coordinate with the server team
   before shipping; the schema lives in
   `types/server-handoff/browser-dom-capability.json` and they have to be
   ready to read it.
6. Change 8 (description tweak) — ride along with any of the above.
7. Change 9 (deferred).

---

## 7. Sources

- [Anthropic — Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Anthropic — What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Google — Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Google — Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- [Google — Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [OpenAI — Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI — GPT-5.5 latest-model guide](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI cookbook — Multimodal tips](https://developers.openai.com/cookbook/examples/multimodal/document_and_multimodal_understanding_tips)
