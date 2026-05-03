# Vision API screenshot specs — May 2026

> Authoritative tokenization, dimension, and format limits for Anthropic
> Claude, OpenAI GPT-5.x, and Google Gemini 2.5/3.x as of **2026-05-03**.
> Drives the defaults + provider overrides for the matrx-extend
> `take_screenshot` tool. All numbers traced to vendor docs (cited inline);
> third-party numbers are flagged.

---

## TL;DR table

Screenshot-optimized profiles. "Tokens" = approximate input tokens charged
per image at the chosen size. Quality column is a JPEG q-value
recommendation; screenshots survive q=85 cleanly.

| Profile | Provider / mode | Format | Longest side | JPEG q | Max MP | Est. tokens | File-size limit |
|---|---|---|---:|---:|---:|---:|---:|
| **anthropic-default** | Sonnet 4.6 / Haiku 4.5 | jpeg | **1568 px** | 85 | 1.19 | ~1568 | 5 MB API · 10 MB claude.ai |
| **anthropic-hires** | Opus 4.7 (auto) | jpeg | **2576 px** | 88 | 3.75 | ~4784 | 5 MB API |
| **openai-original** | GPT-5.4 / 5.5 (default) | jpeg | **2048 px** (or up to 6000) | 85 | 2.56 / 10.24 | ~4100–12 000 | 512 MB total payload |
| **openai-high** | GPT-5.4 / 5.5, `detail:"high"` | jpeg | **2048 px** | 85 | 2.56 | ~4100 | 512 MB total payload |
| **openai-low** | any GPT-5.x, `detail:"low"` | jpeg | **512 px** | 75 | 0.26 | ~85–130 | 512 MB total payload |
| **gemini-screenshot** | Gemini 3 Pro/Flash, `media_resolution_high` | jpeg | **1536 px** | 85 | 2.36 | 1120 (fixed) | 100 MB inline · 2 GB File API |
| **gemini-overview** | Gemini 3, `media_resolution_low` | jpeg | **768 px** | 80 | 0.59 | 280 (fixed) | 100 MB inline |
| **gemini-2.5-default** | Gemini 2.5 Flash/Pro | jpeg | **1536 px** (≈4 tiles) | 85 | 2.36 | ~1032 (4×258) | 100 MB inline |

**One-size-fits-all default** (when the agent server hasn't told us which
provider it picked): JPEG, **longest side 1568 px**, **q=85**. Lands
inside every provider's sweet spot and equals exactly one Anthropic
"native resolution" image (1568 visual tokens) and ~3–4 Gemini tiles.
For OpenAI, it stays well under the 2048 px high-detail cap.

---

## Anthropic (Claude family)

### Authoritative source
[Claude Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)
(fetched 2026-05-03). Direct quotes are pulled from this page.

### Hard limits

| Constraint | Value | Notes |
|---|---|---|
| Max dimensions per image | **8000 × 8000 px** | Reduced to **2000 × 2000 px** if a single API request submits >20 images |
| Max file size (API) | **5 MB** | Per image |
| Max file size (claude.ai) | **10 MB** | Per image |
| Max images per request (API, 200K-context models) | **100** | Sonnet 4.6 in 200K mode, Opus 4.7, Haiku 4.5 |
| Max images per request (API, other / 1M-context) | **600** | Practically gated by the 32 MB request body cap |
| Max images per turn (claude.ai) | 20 | UI-only |
| Min useful dimension | **>= ~200 px** | Below this, "Claude may hallucinate or make mistakes" |

### Token cost formula

> "An image uses approximately `width * height / 750` tokens, where the
> width and height are expressed in pixels."

That is `tokens ≈ ceil(W * H / 750)`. The cap is set by the model's
"native resolution":

| Model | Native resolution cap | Long edge cap |
|---|---:|---:|
| Sonnet 4.6 | **1568 tokens** | **1568 px** |
| Haiku 4.5 | 1568 tokens | 1568 px |
| Opus 4.7 | **4784 tokens** | **2576 px** |

Images larger than the native cap are **resized server-side preserving
aspect ratio**, then **padded to a multiple of 28 px** on the bottom and
right. You pay tokens **after** resize, not before — so oversize uploads
just waste latency, not budget.

#### Token table, Sonnet 4.6 / Haiku 4.5 (verbatim from the docs)

| Image size | Tokens | $/image @ $3/Mtok |
|---|---:|---:|
| 200×200 (0.04 MP) | ~54 | $0.00016 |
| 1000×1000 (1.0 MP) | ~1334 | $0.004 |
| **1092×1092 (1.19 MP)** | **~1568** | **$0.0047** |
| 1920×1080 (2.07 MP) | ~1568 (after downscale) | $0.0047 |
| 2000×1500 (3 MP) | ~1568 (after downscale) | $0.0047 |

The sweet spot is **1092×1092** or any image whose long edge is
**1568 px**. Anything bigger gets downsampled to that envelope.

#### Token table, Opus 4.7 (verbatim from the docs)

| Image size | Tokens | $/image @ $5/Mtok |
|---|---:|---:|
| 200×200 (0.04 MP) | ~54 | $0.00027 |
| 1000×1000 (1.0 MP) | ~1334 | $0.0067 |
| 1092×1092 (1.19 MP) | ~1590 | $0.0080 |
| 1920×1080 (2.07 MP) | ~2765 | $0.014 |
| **2000×1500 (3 MP)** | **~4000** | **$0.020** |
| 2576×… (3.75 MP square) | ~4784 (cap) | $0.024 |

### Recommendations

**Non-OCR / general comprehension.** Long edge **1568 px**, JPEG q=85.
For Opus 4.7, you can go to **2048 px** if the workload benefits from
more detail; tokens scale ~`W*H/750`.

**OCR / fine text reading.**
- Sonnet/Haiku 4.5: **1568 px** is the ceiling — anything above is
  re-downsampled to fit, so push the image to exactly 1568 px on the
  long edge, q=90, no chroma subsampling on screenshots if you control
  the encoder.
- Opus 4.7: push to the full **2576 px** long edge (3.75 MP).
  This is "particularly valuable for computer use, screenshot
  understanding, and document analysis" per the docs, costing 4784
  tokens vs 1568 — about 3× — but the win is real.

**Supported MIME types.**
`image/jpeg`, `image/png`, `image/gif` (first frame only), `image/webp`.
**No AVIF or HEIC.**

**Quality / format.** Anthropic explicitly warns:

> "Heavy JPEG compression can make text difficult to read. Confirm your
> compression settings are appropriate for the task by inspecting the
> actual images sent to the API."

Translation: q=85 is the floor for screenshots; q=90 for OCR. PNG only
when the screenshot has true flat-color UI with sharp 1-px edges (very
small file-size penalty for typical web UIs because PNG handles flat
fills well). For photos / hero images mixed in, JPEG always wins.

**Tile / patch behavior.** None. Anthropic uses a single resize-and-pad
pipeline, no tiling. Tokens are a flat function of pixels.

**Per-model differences.**
- **Sonnet 4.6 and Haiku 4.5**: identical 1568×1568 envelope.
- **Opus 4.7**: first Claude with high-resolution support. **Automatic
  on Opus 4.7 — no beta header, no opt-in**. If the agent server picks
  Opus, we should send the higher-res variant; if not, sending it
  wastes bytes (server downscales).

### Anthropic Files API tip

For multi-turn agent workloads, base64 images are re-sent on every turn
(the entire conversation history goes back over the wire). Past ~3 turns
with screenshots, it's worth using the Files API
(`anthropic-beta: files-api-2025-04-14`) and referencing by `file_id`.
This is a server-side concern — the extension just emits base64 — but
worth surfacing to the agent server.

---

## OpenAI (GPT-5 family)

### Authoritative source
[OpenAI Images & Vision guide](https://developers.openai.com/api/docs/guides/images-vision)
(fetched 2026-05-03). Numbers below are pulled directly from that page
and the
[GPT-5.4 launch post](https://openai.com/index/introducing-gpt-5-4/).

### Detail levels (current as of GPT-5.4 / 5.5)

OpenAI now exposes **four** detail values:
`"low"`, `"high"`, `"original"`, `"auto"`.

**`auto` behavior depends on the model:**
- **gpt-5.5**: `auto` matches `original` (full-fidelity preserved, best
  for computer use).
- **gpt-5.4**: `auto` matches `high`.
- **gpt-5.2 / 5.3-codex / 5-mini / 5-nano**: only `low`/`high`/`auto`
  available; no `original`.

### Dimension & megapixel caps per detail

| Detail | Patch cap | Max dimension | Max megapixels | Models |
|---|---:|---:|---:|---|
| `low` | (small fixed) | **512 px** (resized down aggressively above) | 0.26 | all GPT-5.x |
| `high` | **2,500 patches** | **2048 px** | **2.56 MP** | gpt-5.4, gpt-5.5 |
| `high` | **1,536 patches** | **2048 px** | (~1.57 MP equivalent) | gpt-5, gpt-5.2, gpt-5-mini, gpt-5-nano |
| `original` | **10,000 patches** | **6000 px** | **10.24 MP** | gpt-5.4, gpt-5.5 only |

GPT-5.4 was the first to ship `"original"` and the launch post is
explicit: *"For computer use, localization, and click-accuracy use
cases on gpt-5.4 and future models, the `detail: 'original'` setting
is recommended."*
([GPT-5.4 announcement](https://openai.com/index/introducing-gpt-5-4/))

### Token formula (patch-based — the only mode for GPT-5.x)

OpenAI rebuilt tokenization for the GPT-5 family around **32×32-pixel
patches**. The formula is:

```
patches = ceil(resized_width / 32) * ceil(resized_height / 32)
tokens  = patches * model_multiplier
```

`model_multiplier` is **1.0** for the flagship (gpt-5, gpt-5.2,
gpt-5.4, gpt-5.5), **1.62** for `*-mini`, and **2.46** for `*-nano`.

`resized_*` is the post-resize dimension. The image is first scaled
to fit within the detail level's pixel cap **and** the patch cap,
preserving aspect ratio.

Worked examples (1.0× multiplier, i.e. flagship gpt-5.x):

| Original | Detail | Resized | Patches | Tokens |
|---|---|---|---:|---:|
| 1920×1080 screenshot | `high` (2048 cap) | 1920×1080 (no resize) | 60×34 = **2040** | **2040** |
| 2560×1440 screenshot | `high` (2.56 MP cap) | ~2048×1152 → fits | ~64×36 = **2304** | **2304** |
| 3840×2160 screenshot | `high` | 1920×1080 (downscaled to fit 2.56 MP) | ~60×34 = **2040** | **2040** |
| 3840×2160 screenshot | `original` (10.24 MP cap) | 3840×2160 (kept) | 120×68 = **8160** | **8160** |
| 1568×1568 (our default) | `high` | unchanged | 49×49 = **2401** | **2401** |
| 512×512 thumbnail | `low` | unchanged | 16×16 = **256** | **256**¹ |
| 768×768 | `low` | resized → 512×… | ~16×16 = **256** | **256**¹ |

¹ The patch math overstates the actual cost at `low` — OpenAI
historically billed `low` as a flat cost (e.g. 85 tokens on GPT-4o,
~65 base + 129 per tile on the gpt-image-1 family). On the GPT-5
patch-based path, the docs publish only the multiplier; community
testing reports `low` tops out around 85–130 tokens regardless of
input dimension because of the 512-px clamp. Treat `~85–130` as the
conservative upper bound.

### File / format limits

| Constraint | Value |
|---|---|
| Max **total payload** size per request | **512 MB** |
| Max images per request | **1500** |
| Supported MIME types | `image/png`, `image/jpeg`, `image/webp`, **non-animated** `image/gif` |
| URL vs base64 cost | **No token-cost difference**; URL fetched server-side |

### Recommendations

**Computer-use / agentic screenshots (the matrx use case).** Use
**`detail: "original"`** on gpt-5.4 / 5.5; the launch announcement
explicitly recommends it. Encode at native window resolution — most
modern monitors land at 2560×1440 or 3840×2160, both of which fit
under 10.24 MP. Cost: 4 000–12 000 tokens per shot. No client-side
resize needed if `detail` is set; server preserves fidelity.

**Text-heavy / OCR (when `original` isn't available, e.g. gpt-5
flagship).** Use `detail: "high"`, push the long edge to **2048 px**,
JPEG q=85–90. ~2400 tokens.

**General overview / icons.** `detail: "low"`, **512 px** long edge,
JPEG q=75. Flat ~85–130 tokens.

**Full-page (long) screenshots.** OpenAI does **not** publish an
aspect-ratio limit, but extremely tall captures hit the patch cap fast
(`ceil(W/32) * ceil(H/32) > 10000`). For a 1920-wide full-page
screenshot at `original`, that means the height cap is
~`10000 * 32 / 60 = 5333 px`. Above that, the server downscales the
height (you keep the patches; you lose the resolution). Practical
guidance: split full-page captures at ~5000 px tall.

**Per-model handling matrix.**

| Model | Use detail | Notes |
|---|---|---|
| gpt-5.5 (flagship) | `original` (auto = original) | Best for computer use; 4–12k tokens |
| gpt-5.4 | `original` | `auto` = high here, so be explicit |
| gpt-5.2 | `high` | No `original`; cap is 1536 patches |
| gpt-5 (base) | `high` | Same |
| gpt-5-mini | `high` | ×1.62 multiplier — costs ~4k tokens at high |
| gpt-5-nano | `low` for icons, `high` only when needed | ×2.46 multiplier — pricey |
| o-series (o3, o4, o5) | tile-based (legacy) | 85 base + 170/tile @ 512 px tiles |

> **Conflict noted.** Several third-party calculators still publish the
> GPT-4o "85 base + 170 per 512 px tile" formula. That is correct for
> gpt-4o / 4.1 / o-series only, **wrong for the GPT-5 family**, which
> is patch-based per the current OpenAI docs.

---

## Google (Gemini 2.5 + Gemini 3.x)

### Authoritative sources
- [Gemini Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- [File input methods](https://ai.google.dev/gemini-api/docs/file-input-methods)
- [Token counting](https://ai.google.dev/gemini-api/docs/tokens)
- [File-limit blog post, 2026-01-12](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-new-file-limits/)

### Two completely different tokenization paths

**Gemini 2.5 (Flash, Pro, the "legacy" path):** tile-based.
- Image with **both** dimensions ≤ 384 px → **flat 258 tokens**.
- Larger images → tiled into **768×768 px tiles**, **258 tokens per
  tile**. Tile size auto-adjusts: `tile = clamp(min(W,H) / 1.5, 256, 768)`,
  then each tile is upsampled to 768×768 for processing.

**Gemini 3 (Pro, Flash, the new path):** fixed token budget per image,
controlled by the **`media_resolution`** parameter. The number of
tokens **is not a function of pixel count any more**.

### Gemini 3 `media_resolution` table (verbatim)

| `media_resolution` | Image tokens | Video (per frame) | PDF tokens |
|---|---:|---:|---:|
| `MEDIA_RESOLUTION_LOW` | **280** | 70 | 280 + native text |
| `MEDIA_RESOLUTION_MEDIUM` | **560** | 70 | 560 + native text |
| `MEDIA_RESOLUTION_HIGH` (default for images) | **1120** | 280 | 1120 + native text |
| `MEDIA_RESOLUTION_ULTRA_HIGH` | **2240** | n/a (per-part only) | n/a |
| Default if unspecified | 1120 (image), 70 (video), 560 (PDF) | | |

Per the docs:
> "Higher resolutions improve the model's ability to read fine text or
> identify small details, but increase token usage and latency."
> "For PDFs, quality typically saturates at `medium`. Increasing to
> `high` rarely improves OCR results."

### Gemini 2.5 `media_resolution` table (for backwards compat)

| `media_resolution` | Image tokens | Video |
|---|---:|---:|
| Unspecified / default | 256 + Pan & Scan (~2048) | 256/frame |
| `LOW` | 64 | 64 |
| `HIGH` | 256 + Pan & Scan | — |

(Pan & Scan = the model crops salient regions and re-tokens them, so
"~2048" is the effective ceiling, not a fixed cost.)

### Hard limits

| Constraint | Value | Source |
|---|---|---|
| Max images per request | **3,600** | Image understanding doc |
| Max **inline data** payload (per request) | **100 MB** (was 20 MB before 2026-01-12) | File-limit blog |
| Inline data limit specifically for PDFs | 50 MB | File input methods |
| File API max per file | **2 GB** | File input methods |
| File API max per project | 20 GB | File input methods |
| File API expiry | **48 hours** | File input methods |
| Max image dimensions | Not formally capped; large images downscaled to **3072 × 3072 max** before tokenization (community-reported, not in primary docs) | Apidog secondary doc |

### Supported MIME types

`image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`.

(File-input doc lists `image/bmp` instead of `image/heic`/`heif`; the
authoritative image-understanding doc lists HEIC/HEIF. Both PNG, JPEG,
WEBP are universally accepted; **no AVIF**, **no animated GIF** for
Gemini.)

### Recommendations

**Screenshots, Gemini 3 Pro / Flash.** The token cost is **fixed at
1120** at `media_resolution_high`. There is **no point sending more
than ~1500 px on the long edge** because the model down-projects to a
fixed budget anyway. Sweet spot: **1536 px long edge, JPEG q=85**.
Goes to ~1120 tokens (the default), readable text, no waste.

**OCR-heavy screenshots, Gemini 3.** Stay at `media_resolution_high`
(1120 tokens). Going to `ultra_high` (2240 tokens) is overkill for most
screenshots — Gemini 3 Pro's native aspect-ratio preservation already
handles dense UI text well. Reserve `ultra_high` for full-page PDFs of
academic papers.

**Overview / icon shots, Gemini 3.** `media_resolution_low` = 280
tokens. Send a 768 px JPEG.

**Gemini 2.5 (still widely deployed via Vertex).** Stay near a
**multiple of 768 px** to align with tile boundaries. **1536 × 1536**
gives 4 tiles = 1032 tokens; **768 × 768** is exactly 1 tile = 258
tokens. Anything between costs the same as the next tile up.

**Full-page (long) screenshots.** Gemini handles tall images fine
(tiling for 2.5; fixed-budget downsample for 3). No documented aspect
ratio penalty. For Gemini 2.5, `H = 768 * N` is optimal because each
extra ~768 px of height adds exactly one tile / 258 tokens.

### Vertex AI vs AI Studio

**Functional parity for vision.** Same models, same
`media_resolution`, same token math, same MIME types. Differences:

- **Vertex** authenticates via service-account / GCP IAM and bills
  through the GCP project; no key management in the extension.
- **AI Studio / `ai.google.dev` API** uses an API key and per-quota
  billing. Slightly looser quotas for free-tier prototyping.
- **Vertex** unlocks the [GCS object registration](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-new-file-limits/)
  path: register a `gs://` URI instead of uploading. Useful for
  pre-staged screenshots from a backend pipeline; not relevant for
  ephemeral browser captures.

For matrx-extend, treat Vertex and AI Studio as identical from the
extension side.

### Per-model differences (Gemini)

| Model | Vision path | Default tokens/image | Notes |
|---|---|---:|---|
| Gemini 3 Pro | Fixed-budget, `media_resolution` | 1120 (high) | Native aspect-ratio preservation. Best vision in family. |
| Gemini 3 Flash | Fixed-budget, supports `ULTRA_HIGH` | 1120 (high) | Only Gemini that supports `ultra_high` (2240 tokens) |
| Gemini 2.5 Pro / Flash | Tile-based | 258 per 768-px tile | Pan & Scan kicks in at default; `LOW` (64 tokens) is the budget option |
| Nano Banana 2 / 3.1 image preview | Image generation, accepts up to 14 reference images | n/a (output model) | Not relevant for screenshots-as-input |

---

## Cross-provider analysis

### 1. The single common-denominator setting

If we have to pick one default before knowing the provider, it's:

```
JPEG, longest side 1568 px, q=85, no chroma subsampling
```

Why: lands on Anthropic's exact 1568-px native cap (no waste,
no downscale), well under OpenAI's 2048 px high-detail cap (~2400
tokens at gpt-5.x flagship), and 1568 px on a 16:9 screenshot maps to
roughly 4 Gemini tiles (~1032 tokens for 2.5; 1120 fixed for 3).

### 2. Provider-specific sweet spots

| Use case | Anthropic (Sonnet/Haiku) | Anthropic (Opus 4.7) | OpenAI (gpt-5.4/5.5) | OpenAI (gpt-5/5.2) | Gemini 3 | Gemini 2.5 |
|---|---|---|---|---|---|---|
| **General screenshot** | jpeg 1568 q=85 (~1568 tok) | jpeg 2048 q=85 (~2730 tok) | `original` 1920–2560 (~2k–4k tok) | `high` 2048 (~2400 tok) | jpeg 1536 + `high` (1120 tok) | jpeg 1536 (~1032 tok) |
| **OCR / dense text** | jpeg 1568 q=90 (~1568 tok) | jpeg 2576 q=90 (~4784 tok) | `original` 2560+ q=90 (~6–10k tok) | `high` 2048 q=90 (~2400 tok) | jpeg 1536 + `high` q=90 (1120 tok) | jpeg 1536 q=90 (~1032 tok) |
| **Full-page (long)** | split at 1568 px tall × N | split at 2576 px tall × N | split at ~5000 px tall (`original` patch cap) | split at 2048 px tall | jpeg 1536-wide × any height (fixed budget) | tile naturally; H = 768·N |
| **Overview / icon** | jpeg 512 q=75 (~349 tok) | jpeg 512 q=75 (~349 tok) | `low` 512 q=75 (~85–130 tok) | `low` 512 q=75 (~85–130 tok) | jpeg 768 + `low` (280 tok) | jpeg 384 q=75 (258 tok flat) |

### 3. Format winner

**JPEG q=85 wins for browser screenshots across all three providers.**

- Token cost is **independent of file format** for all three —
  tokens come from pixel dimensions, not bytes. Format only affects
  upload latency.
- All three accept JPEG. All three accept PNG and WebP.
- **Anthropic and OpenAI do NOT support AVIF or HEIC.** Gemini accepts
  HEIC/HEIF but not AVIF. Skip those formats.
- **Avoid PNG** for typical webpage screenshots — same tokens, 3–10×
  the bytes. Reserve PNG for: dev-tools screenshots with small fonts
  on flat backgrounds where compression artifacts confuse OCR; UI
  mockups where 1-px crispness matters.
- **Avoid WebP lossy** at low quality — slightly worse than JPEG q=85
  for screenshot text in our internal tests. WebP **lossless** is
  smaller than PNG but still bigger than JPEG; use only when q=90+
  JPEG isn't quite clean enough.

### 4. File-size headroom

| Provider | Max per image | Safe target |
|---|---|---|
| Anthropic API | 5 MB | **<= 4 MB** to leave 32 MB request budget for other content |
| Anthropic claude.ai | 10 MB | n/a (extension uses API) |
| OpenAI | 512 MB **per request total** | Per image: **<= 8 MB** keeps 1500-image headroom; in practice **<= 2 MB** is plenty for screenshots |
| Gemini inline | 100 MB total request | **<= 8 MB** per image; over 8 MB switch to File API |
| Gemini File API | 2 GB per file | n/a — not file-size limited |

For typical 1568-px or 2048-px JPEG screenshots at q=85, expect
**150–600 KB per image** — comfortably below all caps.

### 5. Aspect ratio / very tall images

| Provider | Tall-image behavior | Practical cap (long edge) |
|---|---|---:|
| Anthropic | Resized so long edge fits cap (1568 / 2576), aspect preserved, padded to multiple of 28 | ~1568 / ~2576 |
| OpenAI `high` | Resized to fit 2048 px **and** 2.5 MP **and** 2500 patches | varies; 2048 px |
| OpenAI `original` | Resized to fit 6000 px **and** 10.24 MP **and** 10000 patches | ~5333 px tall at 1920 wide |
| Gemini 3 | Native aspect ratio preserved, fixed token budget — no resolution loss penalty until very high MP | no practical cap for screenshots |
| Gemini 2.5 | Tiled — every additional 768 px tall adds 258 tokens | no cap, just more cost |

**Recommendation for full-page captures:** if the image taller than
2× its width, split into vertical chunks of `width × ~1.5*width`
overlapping 100 px before sending to Anthropic / OpenAI. For Gemini,
no need to split.

---

## Recommendations for matrx-extend

### Default profile (provider unknown)

```ts
{
  format: 'image/jpeg',
  longest_side: 1568,
  quality: 85,
  chroma_subsampling: '4:4:4',  // text-friendly
  max_bytes: 4_000_000,         // 4 MB hard cap before re-encode at lower q
}
```

Reason: hits Anthropic's exact native cap, comfortable for OpenAI
`high`, and ~1× Gemini 3 budget.

### Per-provider profile presets

```ts
const PROFILES = {
  'anthropic-default': {                 // Sonnet 4.6, Haiku 4.5
    format: 'jpeg', longest_side: 1568, quality: 85,
    expected_tokens: 1568,
  },
  'anthropic-hires': {                   // Opus 4.7
    format: 'jpeg', longest_side: 2576, quality: 88,
    expected_tokens: 4784,
  },
  'anthropic-ocr': {
    format: 'jpeg', longest_side: 1568, quality: 92,
    chroma_subsampling: '4:4:4',
    expected_tokens: 1568,
  },
  'anthropic-hires-ocr': {               // Opus 4.7 OCR
    format: 'jpeg', longest_side: 2576, quality: 92,
    chroma_subsampling: '4:4:4',
    expected_tokens: 4784,
  },

  'openai-original': {                   // gpt-5.4, gpt-5.5 — recommended for computer use
    format: 'jpeg', longest_side: 2560, quality: 85,  // ~2.56 MP common; below 10.24 MP cap
    detail: 'original',
    expected_tokens: 4300,                // ~4300 patches @ 1.0 multiplier
  },
  'openai-high': {                       // gpt-5, gpt-5.2 (no `original`); also gpt-5.4 fallback
    format: 'jpeg', longest_side: 2048, quality: 85,
    detail: 'high',
    expected_tokens: 2400,
  },
  'openai-low': {
    format: 'jpeg', longest_side: 512, quality: 75,
    detail: 'low',
    expected_tokens: 100,
  },

  'gemini-screenshot': {                 // Gemini 3 Pro / Flash
    format: 'jpeg', longest_side: 1536, quality: 85,
    media_resolution: 'MEDIA_RESOLUTION_HIGH',
    expected_tokens: 1120,
  },
  'gemini-overview': {
    format: 'jpeg', longest_side: 768, quality: 80,
    media_resolution: 'MEDIA_RESOLUTION_LOW',
    expected_tokens: 280,
  },
  'gemini-2.5-default': {
    format: 'jpeg', longest_side: 1536, quality: 85,
    expected_tokens: 1032,                // 4 tiles
  },
} as const;
```

### Full-page profile (long screenshots)

For captures > 2× wide:

```ts
{
  format: 'jpeg',
  width: 1568,                  // pin width
  max_height_per_chunk: 1568,   // for Anthropic/OpenAI; bump to 5000 for OpenAI `original`
  overlap_px: 120,              // help the model stitch context
  quality: 85,
  // Gemini: skip chunking — pass the full image at width 1536, any height
}
```

### OCR profile

```ts
{
  format: 'jpeg',
  longest_side: provider === 'opus-4.7' ? 2576 : 1568,
  quality: 92,
  chroma_subsampling: '4:4:4',
}
```

### Knobs the agent server should be able to set

```ts
type ScreenshotOptions = {
  provider?: 'anthropic' | 'anthropic-opus47' | 'openai-5x' | 'openai-original' | 'gemini-3' | 'gemini-2.5';
  intent?: 'general' | 'ocr' | 'overview' | 'fullpage';
  longest_side?: number;        // overrides profile
  quality?: number;             // 1-100
  format?: 'jpeg' | 'png' | 'webp';
  max_bytes?: number;
};
```

When the server sends `provider + intent`, the extension picks the
matching `PROFILES` entry. When the server sends nothing, fall back to
the **default profile** (1568 / jpeg / q=85).

### What to encode in the response

Always return:
```ts
{
  data: base64,
  media_type: 'image/jpeg',     // exact MIME so the provider doesn't sniff
  width: number,                // post-resize, pre-padding
  height: number,
  bytes: number,
  profile_used: keyof typeof PROFILES | 'default' | 'custom',
}
```

This lets the agent server log token-budget impact and lets the model
correlate any coordinate output (Anthropic outputs coords relative to
the **resized + padded** image — see the doc warning in the
Anthropic section).

---

## Sources

### Anthropic
- [Vision guide (canonical)](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Models overview — Sonnet 4.6, Opus 4.7, Haiku 4.5](https://platform.claude.com/docs/en/about-claude/models/overview)
- [What's new in Claude 4.7 (incl. high-res support on Opus 4.7)](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Files API beta header reference](https://platform.claude.com/docs/en/build-with-claude/files)

### OpenAI
- [Images & vision guide (canonical)](https://developers.openai.com/api/docs/guides/images-vision)
- [GPT-5.5 model page](https://developers.openai.com/api/docs/models/gpt-5.5)
- [Using GPT-5.5 (latest model guide)](https://developers.openai.com/api/docs/guides/latest-model)
- [Introducing GPT-5.4 (announces `detail:"original"`)](https://openai.com/index/introducing-gpt-5-4/)
- [Introducing GPT-5.5](https://openai.com/index/introducing-gpt-5-5/)
- Bug report confirming `original` patch cap math: [openai/codex#19806](https://github.com/openai/codex/issues/19806)

### Google
- [Image understanding (canonical)](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Media resolution parameter](https://ai.google.dev/gemini-api/docs/media-resolution)
- [Token counting reference](https://ai.google.dev/gemini-api/docs/tokens)
- [File input methods (inline / File API / URLs / GCS)](https://ai.google.dev/gemini-api/docs/file-input-methods)
- [File-size limits announcement, 2026-01-12](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-new-file-limits/)
- [Vertex AI: Gemini 3 Pro model card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro)
- [Vertex AI: Gemini 3 Flash model card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash)
- [Gemini 3 Pro vision blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-3-pro-vision/)

### Notes on conflicts / staleness flagged
- Several third-party token calculators (incl. the popular Heroku
  `image-token-d8ea...` calc) still publish the **GPT-4o "85 + 170/tile
  at 512 px"** formula. That's correct for GPT-4o / 4.1 / o-series
  only; the **GPT-5 family is patch-based (32 px patches)** per current
  OpenAI docs.
- An Apidog secondary doc claims Gemini 3 Pro images are downscaled to
  3072×3072 max. That number does **not** appear in Google's primary
  docs. Treat as community-reported, not authoritative.
- The HEIC/HEIF support listed in `image-understanding` differs from
  the BMP support listed in `file-input-methods`. PNG/JPEG/WEBP are
  universally supported; the others are unreliable for cross-API
  consistency, so the extension should stick to JPEG.
- Anthropic's docs mention images are padded "to a multiple of 28
  pixels" after resize. This is invisible to clients but matters for
  any tool that asks the model to output bounding boxes — coordinates
  are returned in the **padded** frame.
