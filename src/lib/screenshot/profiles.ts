/**
 * Screenshot profile presets — per-provider sweet spots for sending
 * screenshots to vision-capable LLMs.
 *
 * Sources verified May 2026 against Anthropic, OpenAI, and Google docs.
 * Full details + URLs at .research/2026-05-03-vision-screenshot-specs.md.
 *
 * The model-server picks a profile when it knows what provider it's calling.
 * When it doesn't, `auto` is the safe default — lands inside every provider's
 * sweet spot without wasting tokens on any of them.
 */

export type ScreenshotProfile =
  | 'auto' // Default — "max useful" master image, Python resizes per-provider
  | 'auto-final' // Conservative final-sized output, server is passthrough
  | 'anthropic-default' // Sonnet 4.6 / Haiku 4.5 — 1568 tokens cap
  | 'anthropic-hires' // Opus 4.7 — 4784 tokens cap, automatic
  | 'openai-original' // GPT-5.4+ `detail: "original"`, computer use sweet spot
  | 'openai-high' // GPT-5.x `detail: "high"`
  | 'openai-low' // GPT-5.x `detail: "low"` — overview / icon
  | 'gemini-screenshot' // Gemini 3 `media_resolution_high`, screenshots
  | 'gemini-overview' // Gemini 3 `media_resolution_low`, low-budget pages
  | 'gemini-2.5-default' // Gemini 2.5 Flash / Pro, tile-based
  | 'ocr-heavy' // Aggressive quality for fine text
  | 'lossless'; // PNG, no resize — use sparingly

export interface ProfileConfig {
  /** Output format. JPEG wins for screenshots on every provider. */
  format: 'jpeg' | 'png';
  /** Max length of the longer side, in pixels. 0 = no resize. */
  max_dimension: number;
  /** JPEG quality 1–100. Ignored for PNG. */
  quality: number;
  /** Human-readable explanation — surfaced in tool docs + the Tools tab. */
  rationale: string;
  /** Approximate token cost per image at this profile (for budgeting). */
  est_tokens?: number;
}

export const PROFILES: Record<ScreenshotProfile, ProfileConfig> = {
  auto: {
    format: 'jpeg',
    max_dimension: 2576,
    quality: 88,
    rationale:
      "Default. 'Max useful' = Opus 4.7's 2576 px / 4784-token ceiling — the highest resolution any current vision model can productively use. JPEG q=88 keeps file size at ~600–900 KB even for 4K displays (vs. 12–20 MB raw PNG), so the bandwidth cost from browser → server is bounded. Python is expected to do per-provider final sizing from this master (it has full provider context + better tooling — Pillow's Lanczos, 4:4:4 chroma for OCR, progressive JPEGs, ICC handling). Use a specific provider profile only when Python won't do downstream resizing.",
    est_tokens: 4784,
  },
  /**
   * Conservative fallback for deployments where the server CAN'T do per-
   * provider resizing (legacy pipelines, single-provider setups). 1568 px
   * fits inside every provider's sweet spot without further work.
   */
  'auto-final': {
    format: 'jpeg',
    max_dimension: 1568,
    quality: 85,
    rationale:
      "Conservative final-sized output. 1568 px JPEG q=85 lands inside Anthropic Sonnet/Haiku's 1568-token cap, OpenAI GPT-5.x high's 2048 px cap, and Gemini 3's media_resolution_high budget. Use this when the server is a passthrough and won't resize further.",
    est_tokens: 1600,
  },

  // ─── Anthropic ─────────────────────────────────────────────────────────
  'anthropic-default': {
    format: 'jpeg',
    max_dimension: 1568,
    quality: 85,
    rationale:
      "Sonnet 4.6 / Haiku 4.5 cap at 1568 visual tokens. Above 1568 px the model auto-downscales but you're billed for the original size BEFORE the downscale — never go bigger.",
    est_tokens: 1568,
  },
  'anthropic-hires': {
    format: 'jpeg',
    max_dimension: 2576,
    quality: 88,
    rationale:
      "Opus 4.7's automatic high-resolution mode caps at 4784 tokens / 2576 px long edge. 3× the visual budget — use when computer-use or detailed OCR is needed AND the agent is on Opus 4.7.",
    est_tokens: 4784,
  },

  // ─── OpenAI ────────────────────────────────────────────────────────────
  'openai-original': {
    format: 'jpeg',
    max_dimension: 2048,
    quality: 85,
    rationale:
      "GPT-5.4+ `detail: 'original'` (default) preserves up to 10.24 MP / 6000 px / 10000 patches. 2048 px is the practical sweet spot for screenshots — beyond that you pay patches faster than the model gains accuracy. Use the `'computer-use'` variant of this profile for agent-driving workflows.",
    est_tokens: 4100,
  },
  'openai-high': {
    format: 'jpeg',
    max_dimension: 2048,
    quality: 85,
    rationale:
      'GPT-5.x `detail: "high"` — caps at 2.56 MP / 2048 px / 2500 patches (1536 on gpt-5/5.2/mini/nano).',
    est_tokens: 4100,
  },
  'openai-low': {
    format: 'jpeg',
    max_dimension: 512,
    quality: 75,
    rationale:
      'GPT-5.x `detail: "low"` — fixed ~85 tokens regardless of size. Use for icon-level / overview reads where layout matters but text legibility does not.',
    est_tokens: 85,
  },

  // ─── Google Gemini ─────────────────────────────────────────────────────
  'gemini-screenshot': {
    format: 'jpeg',
    max_dimension: 1536,
    quality: 85,
    rationale:
      'Gemini 3 Pro/Flash with `media_resolution_high`. Token budget is FIXED at 1120 — pixel count above ~1500 px is wasted. 1536 hits the budget exactly without overhead.',
    est_tokens: 1120,
  },
  'gemini-overview': {
    format: 'jpeg',
    max_dimension: 768,
    quality: 80,
    rationale:
      'Gemini 3 with `media_resolution_low`. Fixed 280 tokens. Use for full-page overviews where layout is enough.',
    est_tokens: 280,
  },
  'gemini-2.5-default': {
    format: 'jpeg',
    max_dimension: 1536,
    quality: 85,
    rationale:
      'Gemini 2.5 Flash/Pro — tile-based (768×768 = 258 tokens/tile). 1536 px = 4 tiles ≈ 1032 tokens. Match tile dimensions to avoid wasted tile coverage.',
    est_tokens: 1032,
  },

  // ─── Special-purpose ──────────────────────────────────────────────────
  'ocr-heavy': {
    format: 'jpeg',
    max_dimension: 2048,
    quality: 92,
    rationale:
      "Higher quality + larger max dimension for fine-text OCR. Goes through Anthropic Opus 4.7's 2576 px cap, OpenAI high's 2048 px cap, Gemini 3 high. q=92 preserves text edges that q=85 softens.",
    est_tokens: 4100,
  },
  lossless: {
    format: 'png',
    max_dimension: 0,
    quality: 100,
    rationale:
      "PNG, no resize. ONLY for archival / pixel-perfect comparison. Will blow past every provider's budget if used carelessly — agent server should reject this profile unless the caller explicitly asked for lossless.",
  },
};

/** Pretty list for UI use. */
export const ALL_PROFILES: ScreenshotProfile[] = Object.keys(PROFILES) as ScreenshotProfile[];

/** Helper: resolve a profile name (or fallback to `auto`) to its config. */
export function resolveProfile(name: ScreenshotProfile | undefined): ProfileConfig {
  return PROFILES[name ?? 'auto'] ?? PROFILES.auto;
}

/**
 * Per-provider hard limits in case the agent server wants to validate
 * downstream — values from the May-2026 research, conservative.
 */
export const PROVIDER_LIMITS = {
  anthropic: {
    max_file_bytes: 5 * 1024 * 1024,
    max_dimension: 8000,
    supported_mime: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const,
  },
  openai: {
    /** Total request payload, not per-image. */
    max_total_request_bytes: 512 * 1024 * 1024,
    max_images_per_request: 1500,
    supported_mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const,
  },
  google: {
    /** Inline base64. File API supports 2 GB / file. */
    max_inline_bytes: 100 * 1024 * 1024,
    supported_mime: ['image/jpeg', 'image/png', 'image/webp'] as const,
  },
} as const;
