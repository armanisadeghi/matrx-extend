/**
 * Tier: PRIVILEGED — Chrome DevTools Protocol tools.
 *
 * Admin-only by default. Require the `debugger` optional permission, which is
 * granted at runtime via the Settings → "Advanced agent capabilities" toggle.
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
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

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
  description:
    'Attach a Chrome DevTools Protocol session to a tab (defaults to active tab). Required before any other cdp_* tool can run on that tab. Chrome will show a "is being debugged" banner while attached. The session auto-cleans up when the agent run ends; you can also call cdp_detach explicitly.',
  argsSchema: CdpAttachArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  description: 'Close the CDP session on a tab (defaults to active tab). Removes the debug banner.',
  argsSchema: CdpDetachArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    return cdp.detach(tabId);
  },
};

export const cdp_attached_tabs: ToolHandler<NoArgs, unknown> = {
  name: 'cdp_attached_tabs',
  tier: 'read',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description: 'Return the list of tab ids currently attached via CDP.',
  argsSchema: NoArgs,
  run: async () => ({ tab_ids: cdp.attachedTabsList() }),
};

const FullPageScreenshotArgs = z
  .object({
    tab_id: z.number().int().optional(),
    /** image/png or image/jpeg or image/webp. Default png. */
    format: z.enum(['png', 'jpeg', 'webp']).optional().default('png'),
    /** 0–100 quality for jpeg/webp. Default 85. */
    quality: z.number().int().min(1).max(100).optional().default(85),
    /** Capture below the fold too. Default true (the whole point). */
    full_page: z.boolean().optional().default(true),
  })
  .default({});
type FullPageScreenshotArgs = z.infer<typeof FullPageScreenshotArgs>;

export const cdp_full_page_screenshot: ToolHandler<FullPageScreenshotArgs, unknown> = {
  name: 'cdp_full_page_screenshot',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Capture the FULL page (not just viewport) as base64. CDP\'s Page.captureScreenshot with captureBeyondViewport. Use this instead of take_screenshot when the user asks "give me a picture of the whole article" or you need to OCR a long form. Returns { format, image_base64, byte_length }.',
  argsSchema: FullPageScreenshotArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const att = await cdp.attach(tabId);
    if (!att.ok) return { ok: false, reason: att.reason };
    try {
      // Get the layout to clip to full page.
      let clip: Record<string, number> | undefined;
      if (args.full_page) {
        const layout = await cdp.send<{
          contentSize: { width: number; height: number };
          cssLayoutViewport: { clientWidth: number; clientHeight: number };
        }>(tabId, 'Page.getLayoutMetrics');
        clip = {
          x: 0,
          y: 0,
          width: layout.contentSize.width,
          height: layout.contentSize.height,
          scale: 1,
        };
      }
      const result = await cdp.send<{ data: string }>(tabId, 'Page.captureScreenshot', {
        format: args.format,
        quality: args.format === 'png' ? undefined : args.quality,
        captureBeyondViewport: args.full_page,
        clip,
      });
      return {
        ok: true,
        format: args.format,
        image_base64: result.data,
        byte_length: result.data.length,
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Dump the accessibility tree of the active tab via Accessibility.getFullAXTree. Each node has { role, name, value, description, properties, children }. Use INSTEAD of read_active_page when you want a clean semantic view of the page — it omits decorative DOM and surfaces aria-roles, button labels, form-field associations directly. Best for vision-free reasoning.',
  argsSchema: A11yTreeArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Synthesize a real mouse click at viewport coordinates (x, y) via Input.dispatchMouseEvent. Bypasses event-handler shadowing, works through shadow DOM and cross-origin iframes (OOPIFs) — the most reliable click in existence. Use when click_element fails because the page intercepts synthetic clicks.',
  argsSchema: InputClickArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Type literal text into whatever element currently has focus, via Input.insertText. Fires beforeinput / input / compositionend events correctly so React-controlled inputs accept it. Use after focus_element + when type_into_element fails.',
  argsSchema: InputTypeArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Begin capturing every Network event on a tab (default: active). After this, navigate or interact with the page; calls accumulate in a buffer. Use cdp_network_capture_drain to read them. Use cdp_network_capture_stop when finished.',
  argsSchema: NetCaptureStartArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Drain captured Network events from a tab\'s buffer. Each entry has { request_id, url, method, status, mime_type, request_headers, response_headers, finished, failed, ts_ms }. Use cdp_network_get_body with a request_id to fetch a response body lazily.',
  argsSchema: NetCaptureDrainArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description: 'Stop capturing Network events on a tab and clear its buffer.',
  argsSchema: NetCaptureStopArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Fetch the response body for a captured request, by request_id (from cdp_network_capture_drain). Returns { body, base64_encoded }. Bodies are large so we don\'t buffer them eagerly.',
  argsSchema: NetGetBodyArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Print a tab to PDF via Page.printToPDF. Returns base64 PDF data. Useful for archival, sharing, or feeding the PDF to a downstream model.',
  argsSchema: PrintPdfArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Read Performance.getMetrics for a tab. Returns { Documents, Frames, JSHeapUsedSize, LayoutCount, RecalcStyleCount, ScriptDuration, TaskDuration, … }. Useful when an action triggered chaos and you need to measure it.',
  argsSchema: PerfMetricsArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  description:
    'Override viewport metrics + user agent on a tab. Use to view a page as iPhone Safari, Pixel Chrome, etc., without leaving the user\'s window. Reset by calling cdp_clear_emulation.',
  argsSchema: EmulateDeviceArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
  description: 'Clear device + UA overrides on a tab.',
  argsSchema: ClearEmulationArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
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
    tab_id: z.number().int().optional(),
    /** Auto-start console capture if it's not already running. Default true. */
    auto_start: z.boolean().optional().default(true),
    /** Limit returned messages. Default 100. */
    max: z.number().int().positive().max(2000).optional().default(100),
    /** Only return messages at these console levels. */
    level_filter: z.array(z.string()).optional(),
    /** Only return messages whose text matches this regex pattern. */
    pattern: z.string().optional(),
    /** Convenience: only errors + warnings. Equivalent to level_filter=['error','warn']. */
    errors_only: z.boolean().optional().default(false),
  })
  .default({});
type ReadConsoleArgs = z.infer<typeof ReadConsoleArgs>;

export const read_console_messages: ToolHandler<ReadConsoleArgs, unknown> = {
  name: 'read_console_messages',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['debugger'],
  description:
    'Read console messages from a tab. Auto-starts CDP console capture if not already running. Filter by level, text regex, or use errors_only=true. Returns { count, messages: [{ level, text, url, line, ts_ms }] }. Console capture stays on until cdp_detach or tab close.',
  argsSchema: ReadConsoleArgs,
  run: async (args) => {
    const tabId = args.tab_id ?? (await activeTabId());
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    if (args.auto_start) {
      try {
        await cdp.startConsoleCapture(tabId);
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    }
    const filter = args.errors_only
      ? ['error', 'warn']
      : args.level_filter && args.level_filter.length > 0
        ? args.level_filter
        : undefined;
    const pattern = args.pattern ? new RegExp(args.pattern) : undefined;
    const messages = cdp.drainConsoleCapture(tabId, {
      max: args.max,
      level_filter: filter,
      pattern,
    });
    return { ok: true, count: messages.length, messages };
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
];
