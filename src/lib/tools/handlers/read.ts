/**
 * Tier: READ — informational tools. Run automatically without approval.
 */

import { log } from '@/lib/debug/log';
import { resolveProfile, type ScreenshotProfile } from '@/lib/screenshot/profiles';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

export const get_active_tab: ToolHandler<NoArgs, unknown> = {
  name: 'get_active_tab',
  tier: 'read',
  description:
    'Return information about the user’s currently focused browser tab: url, title, tab id, window id, status, favicon.',
  argsSchema: NoArgs,
  run: async () => {
    const tab = await activeTab();
    if (!tab) return { ok: false, reason: 'No active tab' };
    return {
      tab_id: tab.id,
      window_id: tab.windowId,
      url: tab.url,
      title: tab.title,
      status: tab.status,
      pinned: tab.pinned,
      incognito: tab.incognito,
      fav_icon_url: tab.favIconUrl,
    };
  },
};

const SelectionArgs = z.object({}).default({});
export const get_page_selection: ToolHandler<NoArgs, unknown> = {
  name: 'get_page_selection',
  tier: 'read',
  description:
    'Return the user’s currently selected text on the active tab. Empty string if nothing is selected.',
  argsSchema: SelectionArgs,
  run: async () => {
    const tab = await activeTab();
    if (!tab?.id) return { text: '', selected: false };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = window.getSelection?.();
          return {
            text: sel?.toString() ?? '',
            range_count: sel?.rangeCount ?? 0,
          };
        },
      });
      const r = first?.result as { text: string; range_count: number } | undefined;
      return { text: r?.text ?? '', selected: !!r?.text, range_count: r?.range_count ?? 0 };
    } catch (err) {
      log.warn('msg', 'get_page_selection failed', err);
      return { text: '', selected: false, error: (err as Error).message };
    }
  },
};

const ReadPageArgs = z
  .object({
    /** When true, scroll the page top→bottom first to trigger lazy loaders. */
    deep: z.boolean().optional().default(false),
  })
  .default({});
type ReadPageArgs = z.infer<typeof ReadPageArgs>;

export const read_active_page: ToolHandler<ReadPageArgs, unknown> = {
  name: 'read_active_page',
  tier: 'read',
  description:
    'Read the active tab and return a structured snapshot: cleaned article (markdown + html), title, byline, full image/video/link/audio lists, JSON-LD, schema types, SEO signals (headings, meta, alt-text coverage). Pass deep=true to scroll the page top→bottom first to trigger lazy-loaded images and infinite-scroll content before reading. Use this whenever you need to understand or quote the page.',
  argsSchema: ReadPageArgs,
  run: async (args) => {
    const tab = await activeTab();
    if (!tab?.id) return { ok: false, reason: 'No active tab' };
    // Pre-flight URL check — same shared classifier the Scrape tab uses.
    // Saves a confusing Chrome error and an immediate retry loop when we
    // already know the page is on Chrome's hard-blocklist.
    const { classifyTabUrl } = await import('@/lib/scrape/capture-error');
    const urlClass = classifyTabUrl(tab.url);
    if (urlClass.blocked) {
      return {
        ok: false,
        reason: `Chrome blocks extensions on ${urlClass.reason}. Ask the user to switch to a regular page.`,
        url: tab.url ?? null,
      };
    }
    if (args.deep) {
      const { scrollToLoadLazy } = await import('@/lib/scrape/page-ready');
      await scrollToLoadLazy(tab.id, { delayMs: 100, maxMs: 5000 });
    }
    // Reuse the in-tab scrape pipeline by sending the SCRAPE_CAPTURE message
    // to that tab's content script — same path the manual Scrape button uses.
    try {
      const { CHANNELS } = await import('@/lib/messaging/schemas');
      const result = await chrome.tabs.sendMessage(tab.id, {
        __matrx: true,
        kind: CHANNELS.SCRAPE_CAPTURE,
        payload: { options: {} },
      });
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Receiving end does not exist')) {
        return {
          ok: false,
          reason:
            "The page's helper script isn't loaded — usually because the extension was updated since this tab was opened. Ask the user to reload the page.",
          raw: msg,
        };
      }
      return { ok: false, reason: msg };
    }
  },
};

const ScreenshotArgs = z
  .object({
    /**
     * Provider/model profile to optimize for. The agent server should pass
     * this when it knows what model the screenshot is going to. `auto` is
     * the safe default — works for every provider without wasting tokens.
     * See src/lib/screenshot/profiles.ts for the full preset list.
     */
    profile: z
      .enum([
        'auto',
        'auto-final',
        'anthropic-default',
        'anthropic-hires',
        'openai-original',
        'openai-high',
        'openai-low',
        'gemini-screenshot',
        'gemini-overview',
        'gemini-2.5-default',
        'ocr-heavy',
        'lossless',
      ])
      .optional()
      .default('auto'),
    /**
     * Override format. `null` (default) = use the profile's format.
     * Use only when you have a strong reason to deviate.
     */
    format: z.enum(['png', 'jpeg']).optional(),
    /** Override quality 1–100. Ignored for PNG. `null` = use profile default. */
    quality: z.number().int().min(1).max(100).optional(),
    /**
     * Override max dimension in pixels. 0 = no resize. `null` = use profile.
     * Bypasses the per-provider sweet spot — use sparingly.
     */
    max_dimension: z.number().int().min(0).max(8192).optional(),
  })
  .default({});
type ScreenshotArgs = z.infer<typeof ScreenshotArgs>;

interface ScreenshotResult {
  ok: boolean;
  reason?: string;
  /** MIME type — `image/jpeg` or `image/png`. Use this verbatim in Anthropic / OpenAI image blocks. */
  media_type?: string;
  format?: 'jpeg' | 'png';
  /** Final width AFTER any resize. */
  width?: number;
  /** Final height AFTER any resize. */
  height?: number;
  /** Original viewport dimensions before resize. */
  source_width?: number;
  source_height?: number;
  /** Base64-encoded image data WITHOUT the `data:image/...;base64,` prefix. */
  image_base64?: string;
  /** Length of the base64 string (chars). Useful for budgeting. */
  byte_length?: number;
  /** True if we resized the image to fit `max_dimension`. */
  resized?: boolean;
  /** The profile used for this capture. */
  profile?: ScreenshotProfile;
  /** Approximate token cost for this image at the chosen profile (for budgeting). */
  est_tokens?: number;
}

/**
 * Decode the captureVisibleTab data URL, optionally resize, and re-encode at
 * the requested format/quality. Runs in SW context (OffscreenCanvas + fetch).
 */
async function processScreenshot(
  dataUrl: string,
  format: 'jpeg' | 'png',
  quality: number,
  maxDim: number,
): Promise<{
  base64: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  resized: boolean;
}> {
  // captureVisibleTab returns a data URL; cheapest way to get pixels is fetch().
  const blob = await fetch(dataUrl).then((r) => r.blob());
  const bitmap = await createImageBitmap(blob);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;

  let targetW = sourceWidth;
  let targetH = sourceHeight;
  let resized = false;
  if (maxDim > 0) {
    const longer = Math.max(sourceWidth, sourceHeight);
    if (longer > maxDim) {
      const scale = maxDim / longer;
      targetW = Math.max(1, Math.round(sourceWidth * scale));
      targetH = Math.max(1, Math.round(sourceHeight * scale));
      resized = true;
    }
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const out = await canvas.convertToBlob({
    type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    quality: format === 'jpeg' ? quality / 100 : undefined,
  });
  // Blob → base64 without involving FileReader (which doesn't exist in SW).
  const buf = await out.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  const base64 = btoa(bin);
  return { base64, width: targetW, height: targetH, sourceWidth, sourceHeight, resized };
}

export const take_screenshot: ToolHandler<ScreenshotArgs, ScreenshotResult> = {
  name: 'take_screenshot',
  tier: 'read',
  description:
    "Capture the visible viewport of the active tab, optimized for vision-API consumption. Default profile 'auto' returns a 'max useful' master image (JPEG q=88 @ 2576px — Opus 4.7's ceiling, the highest any current model uses) at ~600–900 KB; the server is expected to do per-provider final sizing from that master. Use 'auto-final' if the server is a passthrough (1568px JPEG q=85 — fits every provider). Provider-specific profiles when the server already knows the model: 'anthropic-default'/'anthropic-hires', 'openai-original'/'openai-high'/'openai-low', 'gemini-screenshot'/'gemini-overview'/'gemini-2.5-default'. Special-purpose: 'ocr-heavy' (high-q for fine text), 'lossless' (PNG, archival only). Returns { ok, media_type, format, width, height, source_width, source_height, image_base64, byte_length, resized, profile, est_tokens }. The `media_type` field is ready for direct use in an image content block — the agent server should pass it through verbatim, NOT stringify the whole object.",
  argsSchema: ScreenshotArgs,
  run: async (args) => {
    const tab = await activeTab();
    if (!tab?.windowId) return { ok: false, reason: 'No active tab' };
    const profileName = (args.profile ?? 'auto') as ScreenshotProfile;
    const profile = resolveProfile(profileName);
    const format = args.format ?? profile.format;
    const quality = args.quality ?? profile.quality;
    const maxDim = args.max_dimension ?? profile.max_dimension;
    try {
      // Capture in PNG when the caller wants PNG output AND no resize. For
      // every other case we ask captureVisibleTab for PNG and re-encode in
      // our own step — the built-in JPEG encoder doesn't honor `quality`
      // consistently across Chrome versions, and PNG → JPEG via canvas gives
      // us a knob we trust.
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png',
      });
      const processed = await processScreenshot(dataUrl, format, quality, maxDim);
      return {
        ok: true,
        media_type: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        format,
        width: processed.width,
        height: processed.height,
        source_width: processed.sourceWidth,
        source_height: processed.sourceHeight,
        image_base64: processed.base64,
        byte_length: processed.base64.length,
        resized: processed.resized,
        profile: profileName,
        est_tokens: profile.est_tokens,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const QueryElementsArgs = z.object({
  selector: z.string().min(1),
  attributes: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(500).optional().default(100),
});
type QueryElementsArgs = z.infer<typeof QueryElementsArgs>;

export const query_elements: ToolHandler<QueryElementsArgs, unknown> = {
  name: 'query_elements',
  tier: 'read',
  description:
    'Run document.querySelectorAll on the active tab and return up to `limit` matches as { tag, text, attrs }. `attrs` is a list of attribute names to extract. Use this to find CSS selectors that subsequent action tools can target.',
  argsSchema: QueryElementsArgs,
  run: async (args) => {
    const tab = await activeTab();
    if (!tab?.id) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector: string, attrs: string[] | null, limit: number) => {
          const out: Array<Record<string, unknown>> = [];
          const list = document.querySelectorAll(selector);
          const total = list.length;
          for (let i = 0; i < Math.min(list.length, limit); i++) {
            const el = list[i] as HTMLElement;
            const item: Record<string, unknown> = {
              index: i,
              tag: el.tagName.toLowerCase(),
              text: (el.innerText ?? '').slice(0, 240),
            };
            if (attrs && attrs.length > 0) {
              const a: Record<string, string | null> = {};
              for (const name of attrs) a[name] = el.getAttribute(name);
              item.attrs = a;
            } else {
              const a: Record<string, string> = {};
              for (const attr of Array.from(el.attributes)) a[attr.name] = attr.value;
              item.attrs = a;
            }
            const rect = el.getBoundingClientRect();
            item.visible = rect.width > 0 && rect.height > 0;
            out.push(item);
          }
          return { total, returned: out.length, items: out };
        },
        args: [args.selector, args.attributes ?? null, args.limit],
      });
      return first?.result ?? { total: 0, returned: 0, items: [] };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

export const read_handlers = [
  get_active_tab,
  get_page_selection,
  read_active_page,
  take_screenshot,
  query_elements,
];
