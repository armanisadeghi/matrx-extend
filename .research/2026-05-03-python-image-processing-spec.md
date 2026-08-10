# Python team — screenshot processing spec

> Companion to [`2026-05-03-vision-screenshot-specs.md`](./2026-05-03-vision-screenshot-specs.md).
> Audience: the Python service that receives screenshots from the
> matrx-extend extension and forwards them to Anthropic / OpenAI / Gemini.

---

## 1. What you receive from the extension

The `take_screenshot` and `cdp_full_page_screenshot` tool results have this
shape (verbatim from the tool dispatcher's `output` field):

```jsonc
{
  "ok": true,
  "media_type": "image/jpeg",        // pass through verbatim, do NOT stringify
  "format": "jpeg",                  // "jpeg" | "png" | "webp" (CDP only)
  "width": 2576,                     // post-resize, in pixels
  "height": 1449,
  "source_width": 3840,               // viewport pixels at capture time
  "source_height": 2160,
  "image_base64": "<...>",           // no `data:` prefix
  "byte_length": 612345,             // DECODED bytes (binary) — already correct
                                     //   base64 wire size is ~ byte_length * 4/3
  "resized": true,
  "profile": "auto",                 // see profile list below
  "est_tokens": 4784                 // extension's estimate at this profile
}
```

**Default profile is `auto`**, which produces a "max-useful master":

| Knob | Value |
|---|---|
| Long edge | **2576 px** (Opus 4.7's native cap) |
| Format | JPEG |
| Quality | 88 |
| Smoothing | `imageSmoothingQuality = 'high'` (Lanczos-ish) |
| Typical size | 600 KB – 1.5 MB |

The intent is: **do all per-provider downsizing in Python**. Pillow's
Lanczos is better than the canvas's, you have full provider context, and
you can re-encode with chroma settings the canvas API doesn't expose.

The extension exposes other profiles (`anthropic-default`,
`anthropic-hires`, `openai-original`, `openai-high`, `openai-low`,
`gemini-screenshot`, `gemini-overview`, `gemini-2.5-default`,
`ocr-heavy`, `lossless`) for callers that bypass Python. Default flow
keeps `auto` and lets you do the math.

---

## 2. The decision tree

```
incoming master image (auto profile)
        │
        ▼
  detect target model
        │
   ┌────┼────────────┬───────────────┐
   ▼    ▼            ▼               ▼
Anthropic   OpenAI     Gemini 3     Gemini 2.5
  │           │           │            │
  ▼           ▼           ▼            ▼
§ 3         § 4          § 5          § 6
```

Each section gives you the **exact** target dims, format, quality, and any
provider-specific encoding flags.

---

## 3. Anthropic (Claude family)

### 3.1 Per-model targets

| Model | Long-edge target | JPEG quality | Notes |
|---|---:|---:|---|
| `claude-sonnet-4-6` | **1568 px** | 85 (90 for OCR) | Hard cap. Above this, server downscales — wastes bytes, not tokens. |
| `claude-haiku-4-5` | **1568 px** | 85 | Same envelope as Sonnet. |
| `claude-opus-4-7` | **2576 px** | 88 (90 for OCR) | Native hi-res. **No beta header needed.** Pixel coords are 1:1. |
| `claude-3-5-sonnet`, older | **1568 px** | 85 | Treat as Sonnet 4.6. |

### 3.2 Algorithm

```python
from io import BytesIO
from PIL import Image

ANTHROPIC_TARGETS = {
    "claude-opus-4-7":    {"long_edge": 2576, "quality": 88},
    "claude-sonnet-4-6":  {"long_edge": 1568, "quality": 85},
    "claude-haiku-4-5":   {"long_edge": 1568, "quality": 85},
    # default fallback
    "_default":           {"long_edge": 1568, "quality": 85},
}
ANTHROPIC_MAX_BYTES = 5 * 1024 * 1024  # 5 MB API per-image cap

def for_anthropic(master_jpeg_bytes: bytes, model: str, ocr_mode: bool = False) -> bytes:
    cfg = ANTHROPIC_TARGETS.get(model, ANTHROPIC_TARGETS["_default"])
    img = Image.open(BytesIO(master_jpeg_bytes)).convert("RGB")

    # 1. Resize so long edge == cfg["long_edge"] (only downscale, never up)
    long_edge = max(img.size)
    if long_edge > cfg["long_edge"]:
        scale = cfg["long_edge"] / long_edge
        new_size = (round(img.width * scale), round(img.height * scale))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    # 2. Optional: pad bottom/right to multiple of 28 to avoid surprise padding
    #    tokens. Skip if you're emitting bbox/click coords back to the agent —
    #    Anthropic's server pads the same way and the model's coords are
    #    relative to the padded image.
    # (We recommend skipping — the model handles unpadded fine.)

    # 3. Encode JPEG with quality from config; for OCR bump to 90 and disable
    #    chroma subsampling (canvas can't do this, Pillow can).
    quality = 90 if ocr_mode else cfg["quality"]
    subsampling = 0 if ocr_mode else 2  # 0 = 4:4:4, 2 = 4:2:0
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality, subsampling=subsampling,
             optimize=True, progressive=True)
    out = buf.getvalue()

    # 4. Enforce 5 MB API per-image cap. If we somehow exceed it, step quality
    #    down by 5 until it fits. Should be rare for screenshots.
    while len(out) > ANTHROPIC_MAX_BYTES and quality > 60:
        quality -= 5
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=quality, subsampling=subsampling,
                 optimize=True, progressive=True)
        out = buf.getvalue()
    return out
```

### 3.3 Wire format

```python
{
    "type": "image",
    "source": {
        "type": "base64",
        "media_type": "image/jpeg",
        "data": base64.b64encode(out).decode("ascii"),
    },
}
```

Or use the **Files API** (`anthropic-beta: files-api-2025-04-14`) for
multi-turn conversations — base64 images get re-sent on every turn
otherwise. Worth doing past 3 turns with screenshots.

### 3.4 Anti-patterns

- **Don't** send PNG unless the screenshot is a wireframe / pure flat-color
  UI; JPEG q=85+ is indistinguishable from PNG to the model and 5–10× smaller.
- **Don't** stringify the whole tool result; pass `media_type` through verbatim.
- **Don't** combine >20 screenshots in one request — Anthropic silently caps
  per-image dims to 2000 × 2000 above that threshold.

---

## 4. OpenAI (GPT-5 family)

### 4.1 Per-model targets

OpenAI has **four** detail values: `low`, `high`, `original`, `auto`.
What you pick depends on the model AND whether you want fidelity or speed.

| Model | Recommended `detail` | Long-edge target | JPEG quality | Notes |
|---|---|---:|---:|---|
| `gpt-5.5` | **`original`** (== `auto` here) | **2048 px** typical, up to 6000 px for OCR | 85 (90 OCR) | Computer-use sweet spot per launch docs. |
| `gpt-5.4` | **`original`** (auto = high; be explicit) | 2048 px / up to 6000 OCR | 85 (90 OCR) | First model with `original`. |
| `gpt-5.2` | `high` | 2048 px | 85 | No `original`. 1536-patch cap. |
| `gpt-5` (base) | `high` | 2048 px | 85 | Same as 5.2. |
| `gpt-5-mini` | `high` | 1568 px | 85 | ×1.62 multiplier — be conservative. |
| `gpt-5-nano` | `low` for icons, `high` for text | 512 / 1568 | 75 / 85 | ×2.46 multiplier. |
| `gpt-4o`, `o3`, `o4` (legacy) | `high` | 2048 px | 85 | Tile-based (85 + 170/tile). |

### 4.2 Algorithm

```python
OPENAI_TARGETS = {
    "gpt-5.5":      {"detail": "original", "long_edge": 2048, "quality": 85},
    "gpt-5.4":      {"detail": "original", "long_edge": 2048, "quality": 85},
    "gpt-5.2":      {"detail": "high",     "long_edge": 2048, "quality": 85},
    "gpt-5":        {"detail": "high",     "long_edge": 2048, "quality": 85},
    "gpt-5-mini":   {"detail": "high",     "long_edge": 1568, "quality": 85},
    "gpt-5-nano":   {"detail": "high",     "long_edge": 1568, "quality": 85},
    "gpt-4o":       {"detail": "high",     "long_edge": 2048, "quality": 85},
    "_default":     {"detail": "high",     "long_edge": 2048, "quality": 85},
}

def for_openai(master_jpeg_bytes: bytes, model: str, ocr_mode: bool = False) -> tuple[bytes, str]:
    cfg = OPENAI_TARGETS.get(model, OPENAI_TARGETS["_default"])
    img = Image.open(BytesIO(master_jpeg_bytes)).convert("RGB")

    # OCR override: on gpt-5.4/5.5 push to 6000 long-edge, q=90.
    target_long = cfg["long_edge"]
    quality = cfg["quality"]
    if ocr_mode and cfg["detail"] == "original":
        target_long = min(6000, max(img.size))
        quality = 90

    long_edge = max(img.size)
    if long_edge > target_long:
        scale = target_long / long_edge
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.Resampling.LANCZOS,
        )

    # OpenAI tokenization is patch-based on 32×32 patches. Aligning to a
    # multiple of 32 trims a few wasted patches at the edges. Optional;
    # negligible savings — only do it if every token counts.
    # img = align_to_patch_grid(img, patch=32)  # crop/pad to nearest 32

    # 4:2:0 subsampling fine for general; 4:4:4 for OCR.
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=quality,
             subsampling=0 if ocr_mode else 2,
             optimize=True, progressive=True)
    return buf.getvalue(), cfg["detail"]
```

### 4.3 Wire format (Responses API)

```python
{
    "type": "input_image",
    "image_url": f"data:image/jpeg;base64,{base64.b64encode(out).decode('ascii')}",
    "detail": detail,   # "original" | "high" | "low" | "auto"
}
```

### 4.4 Edge cases

- **Full-page (very tall) screenshots** at `original`: max patches is 10,000
  → for a 1920-wide image, height ceiling is ~5333 px. Above that, server
  downscales the height, you keep paying patches. **Split full-page captures
  at ~5000 px tall** and send as multiple images.
- **`gpt-5-nano`**: the 2.46× patch multiplier makes `high` expensive
  (~6k tokens for a 1920 screenshot). Default to `low` (~85 tokens) unless
  you know fine detail is needed.

---

## 5. Google Gemini 3.x

### 5.1 Per-model targets

Gemini 3 uses a **fixed-budget** tokenizer — pixels above the budget are
wasted. The `media_resolution` parameter controls the budget, NOT the wire
size. Right strategy: send a moderately-sized JPEG (1536 px long edge) and
set `media_resolution_high`.

| Model | `media_resolution` | Long-edge | Quality | Notes |
|---|---|---:|---:|---|
| `gemini-3-pro` | `MEDIA_RESOLUTION_HIGH` (default) | **1536 px** | 85 | 1120 tokens fixed. |
| `gemini-3-flash` | `MEDIA_RESOLUTION_HIGH` | 1536 px | 85 | Only Gemini supporting `ULTRA_HIGH` (2240 tokens) — overkill for screenshots, reserve for academic-paper PDFs. |
| `gemini-3-pro` (overview) | `MEDIA_RESOLUTION_LOW` | 768 px | 80 | 280 tokens fixed. Use for "is this a login page?" |

### 5.2 Algorithm

```python
GEMINI_3_TARGETS = {
    "high":   {"resolution": "MEDIA_RESOLUTION_HIGH", "long_edge": 1536, "quality": 85},
    "low":    {"resolution": "MEDIA_RESOLUTION_LOW",  "long_edge": 768,  "quality": 80},
    "ultra":  {"resolution": "MEDIA_RESOLUTION_ULTRA_HIGH", "long_edge": 2048, "quality": 88},
}

def for_gemini_3(master_jpeg_bytes: bytes, mode: str = "high") -> tuple[bytes, str]:
    cfg = GEMINI_3_TARGETS[mode]
    img = Image.open(BytesIO(master_jpeg_bytes)).convert("RGB")
    long_edge = max(img.size)
    if long_edge > cfg["long_edge"]:
        scale = cfg["long_edge"] / long_edge
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.Resampling.LANCZOS,
        )
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=cfg["quality"], subsampling=2,
             optimize=True, progressive=True)
    return buf.getvalue(), cfg["resolution"]
```

### 5.3 Wire format

```python
# google.genai SDK
from google.genai import types

types.Part.from_bytes(
    data=out,
    mime_type="image/jpeg",
    media_resolution=resolution,   # one of MEDIA_RESOLUTION_*
)
```

`media_resolution` can be set per-part — mix LOW for thumbnails and HIGH
for the focal screenshot in a single request to control cost.

---

## 6. Google Gemini 2.5 (Vertex / legacy)

### 6.1 Per-model targets

Gemini 2.5 is **tile-based**: 768 × 768 = 258 tokens / tile. Match dimensions
to tile boundaries to avoid paying for partial tiles.

| Long edge | Tiles | Tokens |
|---:|---:|---:|
| 768 | 1 | 258 |
| **1536** | **4** | **1032** |
| 2304 | 9 | 2322 |
| 3072 | 16 | 4128 |

### 6.2 Algorithm

```python
def for_gemini_25(master_jpeg_bytes: bytes, target_long: int = 1536) -> bytes:
    """Resize so long edge is a multiple of 768 (one extra tile = +258 tok)."""
    img = Image.open(BytesIO(master_jpeg_bytes)).convert("RGB")
    long_edge = max(img.size)
    if long_edge > target_long:
        scale = target_long / long_edge
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.Resampling.LANCZOS,
        )
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85, subsampling=2,
             optimize=True, progressive=True)
    return buf.getvalue()
```

### 6.3 Wire format

Same `Part.from_bytes` pattern. `media_resolution` on Gemini 2.5 is more
limited (`LOW` = 64 tokens, default = 256 + Pan & Scan ≈ 2048).

---

## 7. The "I don't know which model" fallback

If model isn't known at routing time, do exactly one thing:

```python
def for_unknown(master_jpeg_bytes: bytes) -> bytes:
    """1568 px / q=85 JPEG. Fits Anthropic exactly, well under OpenAI/Gemini caps."""
    img = Image.open(BytesIO(master_jpeg_bytes)).convert("RGB")
    long_edge = max(img.size)
    if long_edge > 1568:
        scale = 1568 / long_edge
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.Resampling.LANCZOS,
        )
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85, subsampling=2,
             optimize=True, progressive=True)
    return buf.getvalue()
```

---

## 8. Common gotchas

1. **`byte_length` in the tool result is decoded bytes** (post-fix in this
   branch). The base64 string is ~33 % larger. Use `byte_length` for
   provider size caps; use `len(image_base64)` only for wire-budget math.
2. **Always use `Image.Resampling.LANCZOS`** for downscale. Default
   resample (bicubic / bilinear) softens text edges noticeably at q=85.
3. **`subsampling=0`** (4:4:4) on JPEG saves text legibility for OCR; costs
   ~30 % more bytes than 4:2:0. Use only when `ocr_mode=True`.
4. **`progressive=True` + `optimize=True`** on Pillow saves 5–10 % bytes
   with no quality cost. Always on.
5. **Don't double-decode**. The extension already gave you a JPEG; if the
   target encoding is also JPEG, decoding to `Image` and re-encoding loses
   one generation of compression. For Anthropic + Sonnet/Haiku at the same
   default 1568 px, if `master.long_edge ≤ 1568` and `master.quality == 85`,
   pass through the bytes unchanged.
6. **Sniff the master's actual quality**. The extension says q=88 but if a
   future profile change drops it lower, your re-encode at 85 silently
   nukes detail. Use `pillow.JpegImagePlugin._getmp(img)` or skip re-encode
   if `master_quality ≤ target_quality`.
7. **Multi-image budgeting**: for Anthropic specifically, **>20 images per
   request silently halves per-image dim caps to 2000 × 2000**. Track the
   image count in the request builder and either resize accordingly or
   split the request.

---

## 9. Test harness checklist

For each provider/model the Python service supports, verify with one
known screenshot (a 2576 × 1449 master from the extension):

- [ ] Output dims match the per-model target table.
- [ ] Output bytes < provider per-image cap.
- [ ] Round-trip an image content block through the provider's API and
      confirm the model can read 8-pt text.
- [ ] Confirm `media_type` propagates correctly (Anthropic rejects
      mismatched media_type / data MIME).
- [ ] OCR mode produces a measurably crisper image (visual diff or pixel
      Laplacian variance > non-OCR variant).
- [ ] At >20 images, Anthropic requests fall back to 2000 × 2000.

---

## 10. References

- [Anthropic Vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Claude Opus 4.7 release notes](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [OpenAI images & vision](https://developers.openai.com/api/docs/guides/images-vision)
- [GPT-5.4 launch](https://openai.com/index/introducing-gpt-5-4/)
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini media_resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- Companion doc with full provider research: [`2026-05-03-vision-screenshot-specs.md`](./2026-05-03-vision-screenshot-specs.md)
