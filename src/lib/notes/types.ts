/**
 * Notes — types for the extension's Notes tab.
 *
 * The same `notes` table is used by the main React app at
 * matrx-frontend. Every note has exactly ONE home (`home_scope_id`, a scope);
 * note folders are retired. They live in the `workbench` Postgres schema (NOT `public`).
 * We deliberately mirror only the columns the extension reads or writes; the
 * main app keeps using its full schema. RLS in Supabase scopes every row to the
 * owner via `created_by`, so we never need to filter manually.
 *
 * Ownership/soft-delete columns (canonical base-entity shape):
 *   - `created_by` (uuid)            — owner; replaced the old `user_id`.
 * Row access (`shown_to`, `published_to_web`) is neither read nor written here.
 *   - `deleted_at` (timestamptz)     — null = live; replaced the old `is_deleted`.
 */

import type { HomeChoice } from '@/lib/homes/queries';
import { z } from 'zod';

export const NoteListItemSchema = z.object({
  id: z.string().uuid(),
  created_by: z.string().uuid().nullable(),
  label: z.string(),
  home_scope_id: z.string().uuid(),
  tags: z.array(z.string()).nullable(),
  updated_at: z.string(),
  position: z.number().nullable(),
});
export type NoteListItem = z.infer<typeof NoteListItemSchema>;

export const NoteSchema = NoteListItemSchema.extend({
  content: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  deleted_at: z.string().nullable(),
  version: z.number().nullable(),
  created_at: z.string().nullable(),
});
export type Note = z.infer<typeof NoteSchema>;

/** Shared home option contract; lazy General has a stable UI identity. */
export type NoteHomeChoice = HomeChoice;

/** A new note carries the active organization and NO home: the database files
 * it in that organization's General. */
export interface CreateNoteInput {
  label?: string;
  content?: string;
}

export interface UpdateNotePatch {
  label?: string;
  content?: string;
  tags?: string[] | null;
}
