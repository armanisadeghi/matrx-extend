/**
 * Agent-callable guidance tools.
 *
 * The Guidance sidepanel tab is the primary capture surface for the
 * user — they record demos, snap screenshots, and create GIFs through
 * the UI. These tools give the agent a smaller, complementary surface:
 *
 *   save_guidance_note   — drop a free-form note for a domain
 *   list_guidance        — see what's been saved (filterable by domain)
 *   get_guidance_item    — read one item in detail
 *   delete_guidance_item — remove an item
 *
 * Capture flows for screenshots / GIFs / demos are intentionally NOT
 * exposed as agent tools yet — those need a robust file_id pipeline
 * the agent doesn't have today (the user's UI handles the upload).
 */

import { log } from '@/lib/debug/log';
import {
  deleteGuidanceItem as storageDelete,
  getGuidanceItem,
  listAllGuidance,
  listGuidanceForDomain,
  makeGuidanceId,
  saveGuidanceItem,
} from '@/lib/guidance/storage';
import type { GuidanceNote } from '@/lib/guidance/types';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

// ── save_guidance_note ────────────────────────────────────────────────
const SaveGuidanceNoteArgs = z.object({
  domain: z.string().min(1),
  text: z.string().min(1),
  caption: z.string().optional(),
  origin_url: z.string().optional(),
});
type SaveGuidanceNoteArgs = z.infer<typeof SaveGuidanceNoteArgs>;

export const save_guidance_note: ToolHandler<SaveGuidanceNoteArgs, unknown> = {
  name: 'save_guidance_note',
  tier: 'action',
  argsSchema: SaveGuidanceNoteArgs,
  run: async (args) => {
    const now = Date.now();
    const item: GuidanceNote = {
      id: makeGuidanceId(),
      kind: 'note',
      domain: args.domain,
      text: args.text,
      caption: args.caption,
      origin_url: args.origin_url,
      created_at: now,
      updated_at: now,
    };
    await saveGuidanceItem(item);
    log.info('sw', `guidance note saved id=${item.id} domain=${item.domain}`);
    return { ok: true, id: item.id, domain: item.domain };
  },
};

// ── list_guidance ─────────────────────────────────────────────────────
const ListGuidanceArgs = z
  .object({
    /** Optional domain filter. Parent-domain match (a note on `atlassian.net` matches `foo.atlassian.net`). */
    domain: z.string().optional(),
  })
  .default({});
type ListGuidanceArgs = z.infer<typeof ListGuidanceArgs>;

export const list_guidance: ToolHandler<ListGuidanceArgs, unknown> = {
  name: 'list_guidance',
  tier: 'read',
  argsSchema: ListGuidanceArgs,
  run: async (args) => {
    const items = args.domain
      ? await listGuidanceForDomain(args.domain)
      : await listAllGuidance();
    return { ok: true, count: items.length, items };
  },
};

// ── get_guidance_item ─────────────────────────────────────────────────
const GetGuidanceItemArgs = z.object({ id: z.string().min(1) });
type GetGuidanceItemArgs = z.infer<typeof GetGuidanceItemArgs>;

export const get_guidance_item: ToolHandler<GetGuidanceItemArgs, unknown> = {
  name: 'get_guidance_item',
  tier: 'read',
  argsSchema: GetGuidanceItemArgs,
  run: async (args) => {
    const item = await getGuidanceItem(args.id);
    if (!item) return { ok: false, reason: `No guidance item with id=${args.id}` };
    return { ok: true, item };
  },
};

// ── delete_guidance_item ──────────────────────────────────────────────
const DeleteGuidanceItemArgs = z.object({ id: z.string().min(1) });
type DeleteGuidanceItemArgs = z.infer<typeof DeleteGuidanceItemArgs>;

export const delete_guidance_item: ToolHandler<DeleteGuidanceItemArgs, unknown> = {
  name: 'delete_guidance_item',
  tier: 'action',
  argsSchema: DeleteGuidanceItemArgs,
  run: async (args) => {
    const ok = await storageDelete(args.id);
    return ok ? { ok: true, deleted: true } : { ok: false, reason: `No guidance item with id=${args.id}` };
  },
};

export const guidance_handlers = [
  save_guidance_note,
  list_guidance,
  get_guidance_item,
  delete_guidance_item,
];
