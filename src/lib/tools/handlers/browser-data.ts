/**
 * Personal-history reads — bookmarks, browsing history, recent downloads.
 *
 *   search_bookmarks   (read) — search the user's bookmarks tree.
 *   list_bookmark_tree (read) — return the bookmarks folder structure.
 *   search_history     (read) — search browsing history with time range +
 *                              text query.
 *   list_recent_history(read) — last N visits across all sites.
 *   list_downloads     (read) — recent download records.
 *
 * These are personal data. Even though they're read-only, the agent's use
 * of them is auditable through the tool timeline. The Pilot surface
 * advertises them; the Assistant surface does too because they're read.
 */

import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

const SearchBookmarksArgs = z.object({
  query: z.string().min(1),
  /** Cap on returned matches. Default 50. */
  limit: z.number().int().positive().max(500).optional().default(50),
});
type SearchBookmarksArgs = z.infer<typeof SearchBookmarksArgs>;

export const search_bookmarks: ToolHandler<SearchBookmarksArgs, unknown> = {
  name: 'search_bookmarks',
  tier: 'read',
  argsSchema: SearchBookmarksArgs,
  run: async (args) => {
    if (!chrome.bookmarks) return { ok: false, reason: 'bookmarks API unavailable' };
    const results = await chrome.bookmarks.search(args.query);
    return {
      count: Math.min(results.length, args.limit),
      total_match: results.length,
      bookmarks: results.slice(0, args.limit).map((b) => ({
        id: b.id,
        title: b.title,
        url: b.url,
        parent_id: b.parentId,
        date_added: b.dateAdded,
        date_group_modified: b.dateGroupModified,
      })),
    };
  },
};

const ListBookmarkTreeArgs = z
  .object({
    /** Optional folder id to root the tree at. Default = root. */
    folder_id: z.string().optional(),
    /** Maximum depth to walk. Default 3. */
    max_depth: z.number().int().min(1).max(10).optional().default(3),
  })
  .default({});
type ListBookmarkTreeArgs = z.infer<typeof ListBookmarkTreeArgs>;

export const list_bookmark_tree: ToolHandler<ListBookmarkTreeArgs, unknown> = {
  name: 'list_bookmark_tree',
  tier: 'read',
  argsSchema: ListBookmarkTreeArgs,
  run: async (args) => {
    if (!chrome.bookmarks) return { ok: false, reason: 'bookmarks API unavailable' };
    const tree = args.folder_id
      ? await chrome.bookmarks.getSubTree(args.folder_id)
      : await chrome.bookmarks.getTree();
    type Node = chrome.bookmarks.BookmarkTreeNode;
    function trim(node: Node, depth: number): Record<string, unknown> {
      return {
        id: node.id,
        title: node.title,
        url: node.url ?? null,
        date_added: node.dateAdded,
        children:
          depth < args.max_depth && node.children
            ? node.children.map((c) => trim(c, depth + 1))
            : undefined,
      };
    }
    return { tree: tree.map((n) => trim(n, 0)) };
  },
};

const SearchHistoryArgs = z.object({
  /** Free-text query against page title and URL. Pass empty string for all. */
  query: z.string().default(''),
  /** Earliest visit timestamp (ms epoch). Default = 30 days ago. */
  start_time_ms: z.number().int().nonnegative().optional(),
  /** Latest visit timestamp (ms epoch). Default = now. */
  end_time_ms: z.number().int().nonnegative().optional(),
  /** Cap on matches. Default 100. */
  max_results: z.number().int().positive().max(1000).optional().default(100),
});
type SearchHistoryArgs = z.infer<typeof SearchHistoryArgs>;

export const search_history: ToolHandler<SearchHistoryArgs, unknown> = {
  name: 'search_history',
  tier: 'read',
  argsSchema: SearchHistoryArgs,
  run: async (args) => {
    if (!chrome.history) return { ok: false, reason: 'history API unavailable' };
    const startTime = args.start_time_ms ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    const endTime = args.end_time_ms;
    const items = await chrome.history.search({
      text: args.query,
      startTime,
      endTime,
      maxResults: args.max_results,
    });
    return {
      count: items.length,
      items: items.map((h) => ({
        url: h.url,
        title: h.title,
        last_visit_ms: h.lastVisitTime,
        visit_count: h.visitCount,
        typed_count: h.typedCount,
      })),
    };
  },
};

const ListRecentHistoryArgs = z
  .object({
    /** Look back this many minutes. Default 60. */
    minutes: z
      .number()
      .int()
      .positive()
      .max(60 * 24 * 30)
      .optional()
      .default(60),
    max_results: z.number().int().positive().max(1000).optional().default(50),
  })
  .default({});
type ListRecentHistoryArgs = z.infer<typeof ListRecentHistoryArgs>;

export const list_recent_history: ToolHandler<ListRecentHistoryArgs, unknown> = {
  name: 'list_recent_history',
  tier: 'read',
  argsSchema: ListRecentHistoryArgs,
  run: async (args) => {
    if (!chrome.history) return { ok: false, reason: 'history API unavailable' };
    const items = await chrome.history.search({
      text: '',
      startTime: Date.now() - args.minutes * 60 * 1000,
      maxResults: args.max_results,
    });
    items.sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0));
    return {
      count: items.length,
      items: items.map((h) => ({
        url: h.url,
        title: h.title,
        last_visit_ms: h.lastVisitTime,
        visit_count: h.visitCount,
      })),
    };
  },
};

const ListDownloadsArgs = z
  .object({
    /** Free-text query against filename or URL. */
    query: z.string().optional(),
    /** Filter by state. */
    state: z.enum(['in_progress', 'interrupted', 'complete']).optional(),
    limit: z.number().int().positive().max(500).optional().default(50),
  })
  .default({});
type ListDownloadsArgs = z.infer<typeof ListDownloadsArgs>;

export const list_downloads: ToolHandler<ListDownloadsArgs, unknown> = {
  name: 'list_downloads',
  tier: 'read',
  argsSchema: ListDownloadsArgs,
  run: async (args) => {
    if (!chrome.downloads) return { ok: false, reason: 'downloads API unavailable' };
    const items = await chrome.downloads.search({
      query: args.query ? [args.query] : undefined,
      state: args.state,
      limit: args.limit,
      orderBy: ['-startTime'],
    });
    return {
      count: items.length,
      downloads: items.map((d) => ({
        id: d.id,
        filename: d.filename,
        url: d.url,
        mime: d.mime,
        total_bytes: d.totalBytes,
        bytes_received: d.bytesReceived,
        state: d.state,
        start_time: d.startTime,
        end_time: d.endTime,
        paused: d.paused,
      })),
    };
  },
};

export const browser_data_handlers = [
  search_bookmarks,
  list_bookmark_tree,
  search_history,
  list_recent_history,
  list_downloads,
];
