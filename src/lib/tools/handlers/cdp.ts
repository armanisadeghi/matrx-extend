/**
 * Tier: PRIVILEGED — Chrome DevTools Protocol tools.
 *
 * Require the `debugger` optional permission, granted at runtime via the
 * Settings → "Advanced agent capabilities" toggle. The low-level attach /
 * detach / emulate primitives stay admin-only; the advertised CDP tools
 * (screenshot, a11y, network reads, input, perf, print) are gated only by
 * the `debugger` permission — admin_only was removed to match tl_def (see
 * the 2026-05 drift reconciliation).
 *
 * What CDP unlocks (the master key):
 *   - Full network body capture (every fetch URL + status + body).
 *   - Accessibility tree dumps (cleaner than DOM for vision-free agents).
 *   - Coordinate-based clicks that pass through shadow DOM and OOPIFs.
 *   - Full-page screenshots without scroll-stitching.
 *   - Performance metrics, JS heap snapshots, layout box dumps.
 *   - Device + geolocation emulation.
 *
 * UX:
 *   - Chrome shows a "is being debugged" banner while attached. We auto-detach
 *     when the run ends. The Settings tab has a "Stop debugging all tabs"
 *     button as a kill switch.
 *
 * NOTE: To run, the `debugger` permission must be present. The dispatcher
 * checks this BEFORE invoking the handler — see ToolHandler.required_optional_permissions.
 */

import * as cdp from '@/lib/cdp/client';
import { log } from '@/lib/debug/log';
import { resolveProfile, type ScreenshotProfile } from '@/lib/screenshot/profiles';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const NoArgs = z.object({}).default({});
type NoArgs = z.infer<typeof NoArgs>;

const CdpAttachArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type CdpAttachArgs = z.infer<typeof CdpAttachArgs>;

export const cdp_attach: ToolHandler<CdpAttachArgs, unknown> = {
  name: 'cdp_attach',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: CdpAttachArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    return cdp.attach(tabId);
  },
};

const CdpDetachArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type CdpDetachArgs = z.infer<typeof CdpDetachArgs>;

export const cdp_detach: ToolHandler<CdpDetachArgs, unknown> = {
  name: 'cdp_detach',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: CdpDetachArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    return cdp.detach(tabId);
  },
};

export const cdp_attached_tabs: ToolHandler<NoArgs, unknown> = {
  name: 'cdp_attached_tabs',
  tier: 'read',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: NoArgs,
  run: async () => ({ tab_ids: cdp.attachedTabsList() }),
};

const FullPageScreenshotArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /**
     * Provider/model profile — see src/lib/screenshot/profiles.ts. The
     * profile sets `format` + `quality` + a target `max_dimension` (used as
     * the long-edge cap before tile splitting). `auto` is safe for any
     * provider. Default 'auto'.
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
    /** Override format. `null` = use profile. */
    format: z.enum(['png', 'jpeg', 'webp']).optional(),
    /** Override 0–100 quality. Ignored for PNG. */
    quality: z.number().int().min(1).max(100).optional(),
    /** Capture below the fold too. Default true (the whole point). */
    full_page: z.boolean().optional().default(true),
    /**
     * Capture-time scaling — ratio of CSS pixels to image pixels.
     * Default `null` = compute from the page's content height vs the
     * profile's max_dimension, so the resulting image's long edge ≤ profile.
     * Pass an explicit number to override (1.0 = 1:1, 0.5 = half-size, etc.).
     */
    capture_scale: z.number().min(0.1).max(1).optional(),
  })
  .default({});
type FullPageScreenshotArgs = z.infer<typeof FullPageScreenshotArgs>;

export const cdp_full_page_screenshot: ToolHandler<FullPageScreenshotArgs, unknown> = {
  name: 'cdp_full_page_screenshot',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: FullPageScreenshotArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    const profileName = (args.profile ?? 'auto') as ScreenshotProfile;
    const profile = resolveProfile(profileName);
    // Profile.format only knows jpeg/png; CDP also supports webp. If the
    // caller explicitly asked for webp, honor it; otherwise use the profile's.
    const format = args.format ?? profile.format;
    const quality = args.quality ?? profile.quality;
    try {
      // Get the layout. We need it both to clip to full page AND to compute
      // capture_scale when the caller didn't override.
      const layout = await cdp.send<{
        contentSize: { width: number; height: number };
        cssLayoutViewport: { clientWidth: number; clientHeight: number };
      }>(tabId, 'Page.getLayoutMetrics');

      // Compute capture_scale so the resulting long edge ≤ profile.max_dimension.
      // Caller's explicit override wins. profile.max_dimension === 0 = no resize.
      let captureScale: number;
      if (args.capture_scale != null) {
        captureScale = args.capture_scale;
      } else if (profile.max_dimension === 0) {
        captureScale = 1;
      } else {
        const longest = Math.max(layout.contentSize.width, layout.contentSize.height);
        captureScale = longest <= profile.max_dimension ? 1 : profile.max_dimension / longest;
        // Clamp to CDP's accepted range.
        captureScale = Math.max(0.1, Math.min(1, captureScale));
      }

      const clip: Record<string, number> | undefined = args.full_page
        ? {
            x: 0,
            y: 0,
            width: layout.contentSize.width,
            height: layout.contentSize.height,
            scale: captureScale,
          }
        : undefined;

      const result = await cdp.send<{ data: string }>(tabId, 'Page.captureScreenshot', {
        format,
        quality: format === 'png' ? undefined : quality,
        captureBeyondViewport: args.full_page,
        clip,
      });
      const mediaType =
        format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      // Captured image dimensions (best-effort, in image-pixels). Full-page
      // applies captureScale via the clip; viewport capture does not.
      const scale = args.full_page ? captureScale : 1;
      const baseW = args.full_page ? layout.contentSize.width : layout.cssLayoutViewport.clientWidth;
      const baseH = args.full_page
        ? layout.contentSize.height
        : layout.cssLayoutViewport.clientHeight;
      const width = Math.round(baseW * scale);
      const height = Math.round(baseH * scale);

      // Persist to cld_files + wbx_screenshot so the capture has a durable
      // URL the UI renders (and survives reload) and lands in the Screenshots
      // gallery. image_base64 stays in the result for the vision model.
      let fileId: string | null = null;
      let fileUrl: string | null = null;
      let screenshotId: string | null = null;
      try {
        const tab = await chrome.tabs.get(tabId);
        const { persistScreenshot } = await import('@/lib/screenshot/persist');
        const persisted = await persistScreenshot({
          tab,
          base64: result.data,
          mimeType: mediaType,
          // persistScreenshot only uses `format` for the filename extension;
          // mimeType carries the real type (incl. webp).
          format: format === 'jpeg' ? 'jpeg' : 'png',
          width,
          height,
          source: 'agent',
        });
        fileId = persisted.fileId;
        fileUrl = persisted.fileUrl;
        screenshotId = persisted.screenshotId;
      } catch (err) {
        log.warn('sw', 'cdp_full_page_screenshot persistence failed; returning inline only', err);
      }

      return {
        ok: true,
        media_type: mediaType,
        format,
        width,
        height,
        capture_scale: captureScale,
        profile: profileName,
        est_tokens: profile.est_tokens,
        image_base64: result.data,
        byte_length: result.data.length,
        file_id: fileId,
        file_url: fileUrl,
        screenshot_id: screenshotId,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const A11yTreeArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Maximum nodes to return. Default 500. */
    max_nodes: z.number().int().positive().max(5000).optional().default(500),
  })
  .default({});
type A11yTreeArgs = z.infer<typeof A11yTreeArgs>;

export const cdp_a11y_tree: ToolHandler<A11yTreeArgs, unknown> = {
  name: 'cdp_a11y_tree',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: A11yTreeArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      await cdp.send(tabId, 'Accessibility.enable');
      const tree = await cdp.send<{ nodes: Array<Record<string, unknown>> }>(
        tabId,
        'Accessibility.getFullAXTree',
      );
      const nodes = tree.nodes.slice(0, args.max_nodes).map((n) => ({
        node_id: n.nodeId,
        role: (n.role as { value?: string })?.value,
        name: (n.name as { value?: string })?.value,
        value: (n.value as { value?: unknown })?.value,
        description: (n.description as { value?: string })?.value,
        properties: n.properties,
        child_ids: n.childIds,
      }));
      return { ok: true, count: nodes.length, total: tree.nodes.length, nodes };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const InputClickArgs = z.object({
  x: z.number(),
  y: z.number(),
  /** mouse button. Default 'left'. */
  button: z.enum(['left', 'right', 'middle']).optional().default('left'),
  /** click count. Default 1. Pass 2 for double-click. */
  click_count: z.number().int().min(1).max(3).optional().default(1),
  tab_id: z.number().int().optional(),
});
type InputClickArgs = z.infer<typeof InputClickArgs>;

export const cdp_input_click_xy: ToolHandler<InputClickArgs, unknown> = {
  name: 'cdp_input_click_xy',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: InputClickArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      await cdp.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: args.x,
        y: args.y,
        button: args.button,
        clickCount: args.click_count,
      });
      await cdp.send(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: args.x,
        y: args.y,
        button: args.button,
        clickCount: args.click_count,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const InputTypeArgs = z.object({
  text: z.string(),
  tab_id: z.number().int().optional(),
});
type InputTypeArgs = z.infer<typeof InputTypeArgs>;

export const cdp_input_type: ToolHandler<InputTypeArgs, unknown> = {
  name: 'cdp_input_type',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: InputTypeArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      await cdp.send(tabId, 'Input.insertText', { text: args.text });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const NetCaptureStartArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type NetCaptureStartArgs = z.infer<typeof NetCaptureStartArgs>;

export const cdp_network_capture_start: ToolHandler<NetCaptureStartArgs, unknown> = {
  name: 'cdp_network_capture_start',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: NetCaptureStartArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      await cdp.startNetworkCapture(tabId);
      return { ok: true, tab_id: tabId };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const NetCaptureDrainArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Max records to return per call. Default 100. */
    max: z.number().int().positive().max(2000).optional().default(100),
    /** Optional URL substring filter. */
    url_contains: z.string().optional(),
  })
  .default({});
type NetCaptureDrainArgs = z.infer<typeof NetCaptureDrainArgs>;

export const cdp_network_capture_drain: ToolHandler<NetCaptureDrainArgs, unknown> = {
  name: 'cdp_network_capture_drain',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: NetCaptureDrainArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    let records = cdp.drainNetworkCapture(tabId, args.max);
    if (args.url_contains) {
      const sub = args.url_contains.toLowerCase();
      records = records.filter((r) => r.url.toLowerCase().includes(sub));
    }
    return { ok: true, count: records.length, records };
  },
};

const NetCaptureStopArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type NetCaptureStopArgs = z.infer<typeof NetCaptureStopArgs>;

export const cdp_network_capture_stop: ToolHandler<NetCaptureStopArgs, unknown> = {
  name: 'cdp_network_capture_stop',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: NetCaptureStopArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    await cdp.stopNetworkCapture(tabId);
    return { ok: true };
  },
};

const NetGetBodyArgs = z.object({
  request_id: z.string().min(1),
  tab_id: z.number().int().optional(),
});
type NetGetBodyArgs = z.infer<typeof NetGetBodyArgs>;

export const cdp_network_get_body: ToolHandler<NetGetBodyArgs, unknown> = {
  name: 'cdp_network_get_body',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: NetGetBodyArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const r = await cdp.fetchResponseBody(tabId, args.request_id);
      return { ok: true, body: r.body, base64_encoded: r.base64Encoded };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const PrintPdfArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** Print landscape. Default false. */
    landscape: z.boolean().optional().default(false),
    /** Print background graphics. Default true. */
    print_background: z.boolean().optional().default(true),
  })
  .default({});
type PrintPdfArgs = z.infer<typeof PrintPdfArgs>;

export const cdp_print_pdf: ToolHandler<PrintPdfArgs, unknown> = {
  name: 'cdp_print_pdf',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: PrintPdfArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      const r = await cdp.send<{ data: string }>(tabId, 'Page.printToPDF', {
        landscape: args.landscape,
        printBackground: args.print_background,
      });
      return { ok: true, pdf_base64: r.data, byte_length: r.data.length };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const PerfMetricsArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type PerfMetricsArgs = z.infer<typeof PerfMetricsArgs>;

export const cdp_perf_metrics: ToolHandler<PerfMetricsArgs, unknown> = {
  name: 'cdp_perf_metrics',
  tier: 'read',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: PerfMetricsArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      await cdp.send(tabId, 'Performance.enable');
      const r = await cdp.send<{ metrics: Array<{ name: string; value: number }> }>(
        tabId,
        'Performance.getMetrics',
      );
      const map: Record<string, number> = {};
      for (const m of r.metrics) map[m.name] = m.value;
      return { ok: true, metrics: map };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const EmulateDeviceArgs = z.object({
  tab_id: z.number().int().optional(),
  width: z.number().int().min(100),
  height: z.number().int().min(100),
  device_scale_factor: z.number().positive().optional().default(2),
  mobile: z.boolean().optional().default(true),
  user_agent: z.string().optional(),
});
type EmulateDeviceArgs = z.infer<typeof EmulateDeviceArgs>;

export const cdp_emulate_device: ToolHandler<EmulateDeviceArgs, unknown> = {
  name: 'cdp_emulate_device',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: EmulateDeviceArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      await cdp.send(tabId, 'Emulation.setDeviceMetricsOverride', {
        width: args.width,
        height: args.height,
        deviceScaleFactor: args.device_scale_factor,
        mobile: args.mobile,
      });
      if (args.user_agent) {
        await cdp.send(tabId, 'Emulation.setUserAgentOverride', {
          userAgent: args.user_agent,
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const ClearEmulationArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type ClearEmulationArgs = z.infer<typeof ClearEmulationArgs>;

export const cdp_clear_emulation: ToolHandler<ClearEmulationArgs, unknown> = {
  name: 'cdp_clear_emulation',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: ClearEmulationArgs,
  run: async (args, ctx) => {
    const tabId = args.tab_id ?? (await getAssignedTabId(ctx));
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    if (!cdp.isAttached(tabId)) return { ok: true };
    try {
      await cdp.send(tabId, 'Emulation.clearDeviceMetricsOverride');
      await cdp.send(tabId, 'Network.setUserAgentOverride', { userAgent: '' }).catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

// ─── read_console_messages ────────────────────────────────────────────────

const ReadConsoleArgs = z
  .object({
    tab_id: z.string().optional(),
    /** Auto-start console capture if it's not already running. Default true. */
    auto_start: z.boolean().optional().default(true),
    /** Canonical: limit returned messages. */
    limit: z.number().int().positive().max(2000).optional(),
    /** Legacy alias for `limit`. */
    max: z.number().int().positive().max(2000).optional(),
    /** Only return messages at these console levels. */
    level_filter: z.array(z.string()).optional(),
    /** Canonical: regex filter on message text. Same as `pattern`. */
    pattern: z.string().optional(),
    /** Convenience flag for errors + exceptions only. */
    errors_only: z.boolean().optional().default(false),
    /** Canonical: clear the buffer after reading. */
    clear: z.boolean().optional().default(false),
  })
  .default({});
type ReadConsoleArgs = z.infer<typeof ReadConsoleArgs>;

export const read_console_messages: ToolHandler<ReadConsoleArgs, unknown> = {
  name: 'read_console_messages',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: ReadConsoleArgs,
  run: async (args, ctx) => {
    const tabId =
      (args.tab_id ? Number.parseInt(args.tab_id, 10) : null) ??
      (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId)) return { ok: false, reason: 'No active tab' };
    if (args.auto_start) {
      try {
        await cdp.startConsoleCapture(tabId);
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }
    const errorsOnly = args.errors_only;
    const filter = errorsOnly
      ? ['error', 'warn']
      : args.level_filter && args.level_filter.length > 0
        ? args.level_filter
        : undefined;
    const pattern = args.pattern ? new RegExp(args.pattern) : undefined;
    const max = args.limit ?? args.max ?? 100;
    const messages = cdp.drainConsoleCapture(tabId, {
      max,
      level_filter: filter,
      pattern,
      clear: args.clear,
    });
    return { ok: true, count: messages.length, messages };
  },
};

// ─── canonical wrappers for network reads (debugger permission required) ──
//
// These match the canonical schema names (`read_network_requests`,
// `get_request_body`) but inherit our CDP-backed implementation. When a
// non-CDP fallback is built (chrome.webRequest), the admin gate will be
// dropped. Until then, calling them as a non-admin returns a helpful
// error pointing the user to grant the `debugger` optional permission.

const ReadNetworkArgs = z
  .object({
    tab_id: z.string().optional(),
    url_pattern: z.string().optional(),
    /** Auto-start capture if it isn't running. Default true. */
    auto_start: z.boolean().optional().default(true),
    include_body: z.boolean().optional().default(false),
    limit: z.number().int().positive().max(2000).optional().default(100),
    clear: z.boolean().optional().default(false),
  })
  .default({});
type ReadNetworkArgs = z.infer<typeof ReadNetworkArgs>;

export const read_network_requests: ToolHandler<ReadNetworkArgs, unknown> = {
  name: 'read_network_requests',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: ReadNetworkArgs,
  run: async (args, ctx) => {
    const tabId =
      (args.tab_id ? Number.parseInt(args.tab_id, 10) : null) ??
      (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId)) return { ok: false, reason: 'No active tab' };
    if (args.auto_start) {
      try {
        await cdp.startNetworkCapture(tabId);
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }
    let records = cdp.drainNetworkCapture(tabId, args.limit);
    if (args.url_pattern) {
      const sub = args.url_pattern.toLowerCase();
      records = records.filter((r) => r.url.toLowerCase().includes(sub));
    }
    return { ok: true, count: records.length, records };
  },
};

const GetRequestBodyArgs = z.object({
  tab_id: z.string().optional(),
  request_id: z.string().min(1),
});
type GetRequestBodyArgs = z.infer<typeof GetRequestBodyArgs>;

export const get_request_body: ToolHandler<GetRequestBodyArgs, unknown> = {
  name: 'get_request_body',
  tier: 'privileged',
  required_optional_permissions: ['debugger'],
  supportedBrowsers: ['chrome'],
  argsSchema: GetRequestBodyArgs,
  run: async (args, ctx) => {
    const tabId =
      args.tab_id ??
      (args.tab_id ? Number.parseInt(args.tab_id, 10) : null) ??
      (await getAssignedTabId(ctx));
    if (tabId == null || !Number.isFinite(tabId)) return { ok: false, reason: 'No active tab' };
    return cdp_network_get_body.run(
      { request_id: args.request_id, tab_id: tabId } as never,
      // Pass the parent ctx through so the inner handler keeps the same
      // assignedTabId / conversationId — we already resolved tabId above
      // anyway, but keeping ctx consistent matters for tools that read it.
      ctx,
    );
  },
};

export const cdp_handlers = [
  cdp_attach,
  cdp_detach,
  cdp_attached_tabs,
  cdp_full_page_screenshot,
  cdp_a11y_tree,
  cdp_input_click_xy,
  cdp_input_type,
  cdp_network_capture_start,
  cdp_network_capture_drain,
  cdp_network_capture_stop,
  cdp_network_get_body,
  cdp_print_pdf,
  cdp_perf_metrics,
  cdp_emulate_device,
  cdp_clear_emulation,
  read_console_messages,
  read_network_requests,
  get_request_body,
];
