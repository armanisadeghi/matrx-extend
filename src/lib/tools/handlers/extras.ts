import { lastAudibleAt, lastMutedChangeAt } from '@/lib/audio/audible-log';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
/**
 * Small high-leverage utility tools.
 *
 * - `get_clipboard`     — read the system clipboard (inverse of set_clipboard).
 * - `tab_audio_inspect` — diagnostic: which tabs are making noise?
 * - `mutation_watch`    — observe an element for N ms; report changes.
 *
 * 📝 Notes:
 *    .research/proposed-tools-and-features.md (items #6, #15, #8)
 *    .research/tools-roadmap.md
 */
import { z } from 'zod';

// ─── get_clipboard ─────────────────────────────────────────────────────────
const GetClipboardArgs = z
  .object({
    /** Strip leading/trailing whitespace. Default true. */
    trim: z.boolean().optional().default(true),
    /** Cap returned length. Default 100_000 chars. */
    max_chars: z.number().int().positive().max(1_000_000).optional().default(100_000),
  })
  .default({});
type GetClipboardArgs = z.infer<typeof GetClipboardArgs>;

interface GetClipboardResult {
  ok: boolean;
  reason?: string;
  text?: string;
  byte_length?: number;
  truncated?: boolean;
}

export const get_clipboard: ToolHandler<GetClipboardArgs, GetClipboardResult> = {
  name: 'get_clipboard',
  tier: 'action',
  required_optional_permissions: ['clipboardRead'],
  argsSchema: GetClipboardArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
    if (!tab?.id) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: async () => {
          try {
            const text = await navigator.clipboard.readText();
            return { ok: true, text };
          } catch (err) {
            return {
              ok: false,
              reason: (err as Error).message ?? 'clipboard read denied',
            };
          }
        },
      });
      const r = first?.result as { ok: boolean; reason?: string; text?: string } | undefined;
      if (!r) return { ok: false, reason: 'no result from in-page reader' };
      if (!r.ok) {
        return {
          ok: false,
          reason: `${r.reason ?? 'failed'} (the active page may need focus — ask the user to click on the page and retry).`,
        };
      }
      let text = r.text ?? '';
      if (args.trim) text = text.trim();
      const truncated = text.length > args.max_chars;
      if (truncated) text = text.slice(0, args.max_chars);
      return {
        ok: true,
        text,
        byte_length: text.length,
        truncated,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

// ─── tab_audio_inspect ─────────────────────────────────────────────────────
const TabAudioInspectArgs = z.object({}).default({});
type TabAudioInspectArgs = z.infer<typeof TabAudioInspectArgs>;

interface AudioTabInfo {
  id: number;
  title: string | null;
  url: string | null;
  audible: boolean;
  muted: boolean;
  active: boolean;
  window_id: number;
  /** ms-since-epoch the tab was last heard, or null if never heard while we were watching. */
  last_audible_at: number | null;
}

interface TabAudioInspectResult {
  ok: boolean;
  audible_now: AudioTabInfo[];
  recently_audible: AudioTabInfo[];
  muted: AudioTabInfo[];
  total_tabs_inspected: number;
}

const RECENT_AUDIBLE_WINDOW_MS = 60_000;

export const tab_audio_inspect: ToolHandler<TabAudioInspectArgs, TabAudioInspectResult> = {
  name: 'chrome_tab_audio_inspect',
  tier: 'read',
  argsSchema: TabAudioInspectArgs,
  run: async () => {
    const allTabs = await chrome.tabs.query({});
    const audibleNow: AudioTabInfo[] = [];
    const recentlyAudible: AudioTabInfo[] = [];
    const mutedTabs: AudioTabInfo[] = [];
    const now = Date.now();
    for (const t of allTabs) {
      if (t.id == null) continue;
      const info: AudioTabInfo = {
        id: t.id,
        title: t.title ?? null,
        url: t.url ?? null,
        audible: !!t.audible,
        muted: !!t.mutedInfo?.muted,
        active: !!t.active,
        window_id: t.windowId,
        last_audible_at: lastAudibleAt(t.id),
      };
      if (info.audible) audibleNow.push(info);
      if (info.muted) mutedTabs.push(info);
      if (
        !info.audible &&
        info.last_audible_at != null &&
        now - info.last_audible_at <= RECENT_AUDIBLE_WINDOW_MS
      ) {
        recentlyAudible.push(info);
      }
    }
    return {
      ok: true,
      audible_now: audibleNow,
      recently_audible: recentlyAudible,
      muted: mutedTabs,
      total_tabs_inspected: allTabs.length,
    };
  },
};

// Keep `lastMutedChangeAt` import alive for future surface changes (per-tab
// mute-history may move into the response shape later).
void lastMutedChangeAt;

// ─── mutation_watch ────────────────────────────────────────────────────────
const MUTATION_KIND_VALUES = ['text', 'attributes', 'children', 'visibility'] as const;
type MutationKind = (typeof MUTATION_KIND_VALUES)[number];

const MutationWatchArgs = z
  .object({
    ref: z.string().optional(),
    selector: z.string().optional(),
    duration_ms: z.number().int().positive().max(30_000).default(3_000),
    kinds: z.array(z.enum(MUTATION_KIND_VALUES)).optional(),
    /** Cap on event count returned. Default 200. */
    max_events: z.number().int().positive().max(2_000).optional().default(200),
  })
  .refine((a) => a.ref || a.selector, { message: 'one of `ref` or `selector` is required' });
type MutationWatchArgs = z.infer<typeof MutationWatchArgs>;

interface MutationEvent {
  ts_ms: number;
  kind: MutationKind;
  before?: string;
  after?: string;
  attribute?: string;
  added_count?: number;
  removed_count?: number;
  visible?: boolean;
}

interface MutationWatchResult {
  ok: boolean;
  reason?: string;
  duration_ms?: number;
  events?: MutationEvent[];
  total_events?: number;
  truncated?: boolean;
}

export const mutation_watch: ToolHandler<MutationWatchArgs, MutationWatchResult> = {
  name: 'mutation_watch',
  tier: 'read',
  argsSchema: MutationWatchArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
    if (!tab?.id) return { ok: false, reason: 'No active tab' };
    const refSelector = args.ref
      ? `[data-matrx-ref="${args.ref.replace(/^ref:/, '').replace(/(["\\])/g, '\\$1')}"]`
      : (args.selector ?? null);
    if (!refSelector) return { ok: false, reason: 'No selector resolved' };
    const kinds = args.kinds ?? (MUTATION_KIND_VALUES as unknown as MutationKind[]);
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: watchMutationsInPage,
        args: [refSelector, args.duration_ms, kinds as string[], args.max_events],
      });
      return (
        (first?.result as MutationWatchResult) ?? {
          ok: false,
          reason: 'no result from in-page watcher',
        }
      );
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

/**
 * In-page mutation watcher — installs MutationObserver + IntersectionObserver
 * for the requested duration, returns a structured event log.
 */
function watchMutationsInPage(
  selector: string,
  durationMs: number,
  kinds: string[],
  maxEvents: number,
): Promise<MutationWatchResult> {
  return new Promise((resolve) => {
    let target: Element | null = null;
    try {
      target = document.querySelector(selector);
    } catch (err) {
      resolve({ ok: false, reason: `bad selector: ${(err as Error).message}` });
      return;
    }
    if (!target) {
      resolve({ ok: false, reason: 'element not found' });
      return;
    }

    const watchText = kinds.includes('text');
    const watchAttrs = kinds.includes('attributes');
    const watchChildren = kinds.includes('children');
    const watchVisibility = kinds.includes('visibility');

    const events: MutationEvent[] = [];
    const startTs = Date.now();
    let truncated = false;

    function push(ev: MutationEvent) {
      if (events.length >= maxEvents) {
        truncated = true;
        return;
      }
      events.push(ev);
    }

    let lastText = (target.textContent ?? '').trim();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const ts = Date.now() - startTs;
        if (m.type === 'characterData' && watchText) {
          const after = (target!.textContent ?? '').trim();
          if (after !== lastText) {
            push({
              ts_ms: ts,
              kind: 'text',
              before: lastText.slice(0, 200),
              after: after.slice(0, 200),
            });
            lastText = after;
          }
        } else if (m.type === 'attributes' && watchAttrs) {
          push({
            ts_ms: ts,
            kind: 'attributes',
            attribute: m.attributeName ?? undefined,
            before: m.oldValue?.slice(0, 200),
            after: (m.target as Element).getAttribute(m.attributeName ?? '')?.slice(0, 200),
          });
        } else if (m.type === 'childList') {
          if (watchChildren && (m.addedNodes.length || m.removedNodes.length)) {
            push({
              ts_ms: ts,
              kind: 'children',
              added_count: m.addedNodes.length,
              removed_count: m.removedNodes.length,
            });
          }
          // Re-check text since childList can change effective textContent.
          if (watchText) {
            const after = (target!.textContent ?? '').trim();
            if (after !== lastText) {
              push({
                ts_ms: ts,
                kind: 'text',
                before: lastText.slice(0, 200),
                after: after.slice(0, 200),
              });
              lastText = after;
            }
          }
        }
      }
    });
    observer.observe(target, {
      characterData: watchText,
      characterDataOldValue: watchText,
      attributes: watchAttrs,
      attributeOldValue: watchAttrs,
      childList: watchChildren || watchText,
      subtree: true,
    });

    let intersection: IntersectionObserver | null = null;
    if (watchVisibility) {
      let lastVisible: boolean | null = null;
      intersection = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const ts = Date.now() - startTs;
          const visible = e.isIntersecting && e.intersectionRatio > 0;
          if (lastVisible === null || lastVisible !== visible) {
            push({ ts_ms: ts, kind: 'visibility', visible });
            lastVisible = visible;
          }
        }
      });
      intersection.observe(target);
    }

    setTimeout(() => {
      observer.disconnect();
      intersection?.disconnect();
      resolve({
        ok: true,
        duration_ms: Date.now() - startTs,
        events,
        total_events: events.length,
        truncated,
      });
    }, durationMs);
  });
}

export const extras_handlers = [get_clipboard, tab_audio_inspect, mutation_watch];
