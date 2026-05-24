/**
 * Tier: READ — informational tools. Run automatically without approval.
 */

import { log } from '@/lib/debug/log';
import { resolveProfile, type ScreenshotProfile } from '@/lib/screenshot/profiles';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

export const get_active_tab: ToolHandler<NoArgs, unknown> = {
  name: 'get_active_tab',
  tier: 'read',
  argsSchema: NoArgs,
  run: async (_args, ctx) => {
    const tab = await getAssignedTab(ctx);
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
  argsSchema: SelectionArgs,
  run: async (_args, ctx) => {
    const tab = await getAssignedTab(ctx);
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
  argsSchema: ReadPageArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
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
    // Reuse the in-tab scrape pipeline through the shared captureWithFallback
    // helper. captureWithFallback is the same path auto-scrape and the chat
    // hook's pre-send refresh use — it auto-injects the content script on a
    // "no receiver" failure (covers stale tabs after extension upgrade) and
    // returns structured reasons rather than letting raw chrome errors leak.
    const { captureWithFallback } = await import('@/lib/scrape/capture-with-fallback');
    const cap = await captureWithFallback(tab.id, tab.url);
    if (cap.ok) return cap.soup;

    // Map structured failure to the agent-friendly shape the handler used
    // to return inline. Same hint about reloading the tab when injection
    // can't recover (e.g. tab opened before the extension installed).
    if (cap.reason === 'unreachable-url') {
      return {
        ok: false,
        reason: cap.detail ?? 'This URL is not reachable by the extension.',
        url: tab.url ?? null,
      };
    }
    if (cap.reason === 'no-content-script' || cap.reason === 'inject-failed') {
      return {
        ok: false,
        reason:
          "The page's helper script isn't loaded — usually because the extension was updated since this tab was opened. Ask the user to reload the page.",
        detail: cap.detail ?? null,
      };
    }
    return { ok: false, reason: cap.detail ?? cap.reason ?? 'capture failed' };
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
    /**
     * When true (default), upload the captured image to cld_files and index
     * it in `wbx_screenshot` keyed by the active tab's canonical URL. The
     * Screenshots side-panel tab reads from that index. Set to `false` for
     * one-shot captures the user does not want retained — agents should
     * almost never set this.
     */
    persist: z.boolean().optional().default(true),
    /**
     * Marks who initiated the capture. The Screenshots tab uses this to
     * label rows ("by you" vs "by agent"). Defaults to `unknown`; the
     * side-panel button passes `'user'`, the agent dispatcher leaves it
     * unset (which becomes `unknown`), giving us a reliable way to
     * distinguish at a glance.
     */
    capture_source: z.enum(['agent', 'user', 'unknown']).optional().default('unknown'),
    /**
     * Capture scope. `visible` (default) = current viewport only via
     * captureVisibleTab. `full_page` = scroll-and-stitch the full
     * scrollable height via captureVisibleTab + OffscreenCanvas. The
     * full-page path needs no extra permissions but is slower
     * (captureVisibleTab is rate-limited to ~2/sec, so a 10-screen
     * page takes ~5 seconds) and may show position:fixed elements on
     * every tile. Use `cdp_full_page_screenshot` (admin + debugger)
     * when you need a clean single-shot full page.
     */
    mode: z.enum(['visible', 'full_page']).optional().default('visible'),
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
  /**
   * cld_files file_id when the screenshot was persisted to the cloud
   * store. Populated for every successful capture unless persistence
   * was suppressed via `persist:false`. The Screenshots side-panel tab
   * indexes off this — every successful agent or user capture lands in
   * `wbx_screenshot` keyed by the active page's canonical URL.
   */
  file_id?: string | null;
  /** Always-fetchable URL for the persisted image (CDN if public, signed otherwise). May be null when neither configured. */
  file_url?: string | null;
  /** wbx_screenshot row id for this capture, if persistence succeeded. */
  screenshot_id?: string | null;
  /** `visible` or `full_page` — echoes what was captured. */
  mode?: 'visible' | 'full_page';
  /** Full-page only: number of viewport tiles stitched. */
  tile_count?: number;
  /**
   * Full-page only: true when the page exceeded the tile cap and the
   * bottom was cut off. Caller should treat the image as a "best-effort"
   * full page in that case.
   */
  truncated?: boolean;
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
  argsSchema: ScreenshotArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
    if (!tab?.windowId) return { ok: false, reason: 'No active tab' };
    const profileName = (args.profile ?? 'auto') as ScreenshotProfile;
    const profile = resolveProfile(profileName);
    const format = args.format ?? profile.format;
    const quality = args.quality ?? profile.quality;
    const maxDim = args.max_dimension ?? profile.max_dimension;
    const persist = args.persist ?? true;
    const captureSource = (args.capture_source ?? 'unknown') as 'agent' | 'user' | 'unknown';
    const mode = (args.mode ?? 'visible') as 'visible' | 'full_page';
    try {
      // Both paths feed the same processScreenshot (PNG → optionally
      // resized → encoded at requested format/quality). The built-in
      // captureVisibleTab JPEG encoder ignores quality consistently
      // across Chrome versions, so we always ask for PNG and re-encode.
      let dataUrl: string;
      let tileCount: number | undefined;
      let truncated: boolean | undefined;
      if (mode === 'full_page') {
        const { captureFullPage } = await import('@/lib/screenshot/full-page');
        const fp = await captureFullPage(tab);
        dataUrl = fp.dataUrl;
        tileCount = fp.tileCount;
        truncated = fp.truncated;
      } else {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png',
        });
      }
      const processed = await processScreenshot(dataUrl, format, quality, maxDim);
      const mediaType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

      // Persist to cld_files + wbx_screenshot index. Both the agent's
      // `take_screenshot` calls and the user's "Take screenshot" button
      // come through this same handler, so this is the single
      // cross-working entry point for the Screenshots tab. Persistence
      // failures are logged but don't fail the call — the inline image
      // is still useful even when the cloud round-trip is unavailable.
      let fileId: string | null = null;
      let fileUrl: string | null = null;
      let screenshotId: string | null = null;
      if (persist) {
        try {
          const { persistScreenshot } = await import('@/lib/screenshot/persist');
          const persisted = await persistScreenshot({
            tab,
            base64: processed.base64,
            mimeType: mediaType,
            format,
            width: processed.width,
            height: processed.height,
            source: captureSource,
          });
          fileId = persisted.fileId;
          fileUrl = persisted.fileUrl;
          screenshotId = persisted.screenshotId;
        } catch (err) {
          log.warn('sw', 'screenshot persistence failed; returning inline only', err);
        }
      }

      return {
        ok: true,
        mode,
        media_type: mediaType,
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
        file_id: fileId,
        file_url: fileUrl,
        screenshot_id: screenshotId,
        tile_count: tileCount,
        truncated,
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
  argsSchema: QueryElementsArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
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
            const isPassword =
              el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password';
            const item: Record<string, unknown> = {
              index: i,
              tag: el.tagName.toLowerCase(),
              text: (el.innerText ?? '').slice(0, 240),
            };
            if (attrs && attrs.length > 0) {
              const a: Record<string, string | null> = {};
              for (const name of attrs) {
                const raw = el.getAttribute(name);
                a[name] = isPassword && name === 'value' && raw ? '***' : raw;
              }
              item.attrs = a;
            } else {
              const a: Record<string, string> = {};
              for (const attr of Array.from(el.attributes)) {
                a[attr.name] = isPassword && attr.name === 'value' ? '***' : attr.value;
              }
              item.attrs = a;
            }
            if (isPassword) item.masked = true;
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
