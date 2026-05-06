/**
 * Tools that depend on optional manifest permissions.
 *
 * These are admin-only by default. The `debugger` family lives in
 * `cdp.ts`; this file holds:
 *   - cookies (read + write) — `cookies` permission
 *   - page MHTML capture       — `pageCapture` permission
 *   - recently-closed tabs     — `sessions` permission
 *
 * Each tool declares `required_optional_permissions` so the dispatcher can
 * ensure the permission is granted before running. The Settings tab has
 * toggles to grant / revoke these at runtime.
 */

import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

// ─── cookies ───────────────────────────────────────────────────────────────

const GetCookiesArgs = z.object({
  /** Either a single URL ("https://example.com/path") or a domain ("example.com"). */
  url: z.string().url().optional(),
  domain: z.string().optional(),
  /** Specific cookie name to read; omit to return all matching cookies. */
  name: z.string().optional(),
});
type GetCookiesArgs = z.infer<typeof GetCookiesArgs>;

export const get_cookies: ToolHandler<GetCookiesArgs, unknown> = {
  name: 'get_cookies',
  tier: 'read',
  admin_only: true,
  required_optional_permissions: ['cookies'],
  description:
    'Read cookies for a URL or domain. Pass `url` (preferred — narrower) OR `domain`, optionally also `name` to filter to one cookie. Returns a list of { name, value, domain, path, secure, httpOnly, sameSite, expirationDate }. Personal data — admin only by default.',
  argsSchema: GetCookiesArgs,
  run: async (args) => {
    if (!chrome.cookies) return { ok: false, reason: 'cookies API unavailable' };
    if (args.name && (args.url || args.domain)) {
      const c = await chrome.cookies.get({
        url: args.url ?? `https://${args.domain}/`,
        name: args.name,
      });
      return { ok: true, count: c ? 1 : 0, cookies: c ? [c] : [] };
    }
    const list = await chrome.cookies.getAll({
      url: args.url,
      domain: args.domain,
      name: args.name,
    });
    return { ok: true, count: list.length, cookies: list };
  },
};

const SetCookieArgs = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  http_only: z.boolean().optional(),
  same_site: z.enum(['no_restriction', 'lax', 'strict', 'unspecified']).optional(),
  /** Seconds since epoch. Omit for session cookie. */
  expiration: z.number().int().nonnegative().optional(),
});
type SetCookieArgs = z.infer<typeof SetCookieArgs>;

export const set_cookie: ToolHandler<SetCookieArgs, unknown> = {
  name: 'set_cookie',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['cookies'],
  description:
    'Write a cookie. Privileged because it can hijack a user session (CSRF / token-overwrite). Always prompts. Returns the set cookie or { ok:false, reason }.',
  argsSchema: SetCookieArgs,
  run: async (args) => {
    if (!chrome.cookies) return { ok: false, reason: 'cookies API unavailable' };
    try {
      const set = await chrome.cookies.set({
        url: args.url,
        name: args.name,
        value: args.value,
        domain: args.domain,
        path: args.path,
        secure: args.secure,
        httpOnly: args.http_only,
        sameSite: args.same_site,
        expirationDate: args.expiration,
      });
      return { ok: true, cookie: set };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

const DeleteCookieArgs = z.object({
  url: z.string().url(),
  name: z.string().min(1),
});
type DeleteCookieArgs = z.infer<typeof DeleteCookieArgs>;

export const delete_cookie: ToolHandler<DeleteCookieArgs, unknown> = {
  name: 'delete_cookie',
  tier: 'privileged',
  admin_only: true,
  required_optional_permissions: ['cookies'],
  description: 'Delete a cookie by url + name.',
  argsSchema: DeleteCookieArgs,
  run: async (args) => {
    if (!chrome.cookies) return { ok: false, reason: 'cookies API unavailable' };
    const r = await chrome.cookies.remove({ url: args.url, name: args.name });
    return { ok: !!r, removed: r };
  },
};

// ─── pageCapture ──────────────────────────────────────────────────────────

const SaveAsMhtmlArgs = z
  .object({ tab_id: z.number().int().optional() })
  .default({});
type SaveAsMhtmlArgs = z.infer<typeof SaveAsMhtmlArgs>;

export const save_page_as_mhtml: ToolHandler<SaveAsMhtmlArgs, unknown> = {
  name: 'save_page_as_mhtml',
  tier: 'action',
  admin_only: true,
  required_optional_permissions: ['pageCapture'],
  supportedBrowsers: ['chrome'],
  description:
    'Snapshot a tab as a self-contained MHTML archive (HTML + every resource inlined). Returns base64 MHTML data. Use for: archival, sharing a frozen page, feeding the agent a stable snapshot it can reanalyze later.',
  argsSchema: SaveAsMhtmlArgs,
  run: async (args, ctx) => {
    let tabId: number | null | undefined = args.tab_id;
    if (tabId == null) {
      tabId = await getAssignedTabId(ctx);
    }
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    if (!chrome.pageCapture) return { ok: false, reason: 'pageCapture API unavailable' };
    return new Promise((resolve) => {
      chrome.pageCapture.saveAsMHTML({ tabId: tabId! }, async (blob) => {
        if (chrome.runtime.lastError || !blob) {
          resolve({
            ok: false,
            reason: chrome.runtime.lastError?.message ?? 'capture failed',
          });
          return;
        }
        const buf = await blob.arrayBuffer();
        const arr = new Uint8Array(buf);
        let bin = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < arr.length; i += chunkSize) {
          bin += String.fromCharCode.apply(null, Array.from(arr.subarray(i, i + chunkSize)));
        }
        const base64 = btoa(bin);
        resolve({ ok: true, mhtml_base64: base64, byte_length: arr.length });
      });
    });
  },
};

// ─── sessions ────────────────────────────────────────────────────────────

const ListClosedArgs = z
  .object({
    /** Max entries. Default 25. */
    max_results: z.number().int().positive().max(25).optional().default(25),
  })
  .default({});
type ListClosedArgs = z.infer<typeof ListClosedArgs>;

export const list_recently_closed: ToolHandler<ListClosedArgs, unknown> = {
  name: 'list_recently_closed',
  tier: 'read',
  required_optional_permissions: ['sessions'],
  description:
    'List recently-closed tabs and windows the user can restore. Each entry has { id, last_modified, tab? | window? }. Useful when the user says "what was that page I just closed?".',
  argsSchema: ListClosedArgs,
  run: async (args) => {
    if (!chrome.sessions) return { ok: false, reason: 'sessions API unavailable' };
    const list = await chrome.sessions.getRecentlyClosed({
      maxResults: args.max_results,
    });
    return {
      ok: true,
      count: list.length,
      entries: list.map((s) => ({
        last_modified_ms: s.lastModified ? s.lastModified * 1000 : null,
        tab: s.tab
          ? { id: s.tab.sessionId, url: s.tab.url, title: s.tab.title }
          : undefined,
        window: s.window
          ? {
              id: s.window.sessionId,
              tab_count: s.window.tabs?.length ?? 0,
              tabs: (s.window.tabs ?? []).map((t) => ({ url: t.url, title: t.title })),
            }
          : undefined,
      })),
    };
  },
};

const RestoreClosedArgs = z
  .object({
    /** sessionId from list_recently_closed. Omit to restore the most recent. */
    session_id: z.string().optional(),
  })
  .default({});
type RestoreClosedArgs = z.infer<typeof RestoreClosedArgs>;

export const restore_recently_closed: ToolHandler<RestoreClosedArgs, unknown> = {
  name: 'restore_recently_closed',
  tier: 'action',
  required_optional_permissions: ['sessions'],
  description:
    'Restore a recently-closed tab or window. Pass `session_id` from list_recently_closed, or omit to restore the most recent.',
  argsSchema: RestoreClosedArgs,
  run: async (args) => {
    if (!chrome.sessions) return { ok: false, reason: 'sessions API unavailable' };
    const restored = await chrome.sessions.restore(args.session_id);
    return { ok: true, restored };
  },
};

export const cookies_handlers = [get_cookies, set_cookie, delete_cookie];
export const pagecapture_handlers = [save_page_as_mhtml];
export const sessions_handlers = [list_recently_closed, restore_recently_closed];
