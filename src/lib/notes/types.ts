/**
 * Notes — types for the extension's Notes tab.
 *
 * The same `notes` and `note_folders` tables are used by the main React app at
 * matrx-frontend. They live in the `workbench` Postgres schema (NOT `public`).
 * We deliberately mirror only the columns the extension reads or writes; the
 * main app keeps using its full schema. RLS in Supabase scopes every row to the
 * owner via `created_by`, so we never need to filter manually.
 *
 * Ownership/soft-delete columns (canonical base-entity shape):
 *   - `created_by` (uuid)            — owner; replaced the old `user_id`.
 * Row access (`shown_to`, `published_to_web`) is neither read nor written here.
 *   - `deleted_at` (timestamptz)     — null = live; replaced the old `is_deleted`.
 */

import { z } from 'zod';

export const NoteListItemSchema = z.object({
  id: z.string().uuid(),
  created_by: z.string().uuid().nullable(),
  label: z.string(),
  folder_name: z.string().nullable(),
  folder_id: z.string().uuid().nullable(),
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

export const NoteFolderSchema = z.object({
  id: z.string().uuid(),
  created_by: z.string().uuid().nullable(),
  name: z.string(),
  position: z.number().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type NoteFolder = z.infer<typeof NoteFolderSchema>;

export interface CreateNoteInput {
  label?: string;
  content?: string;
  folder_name?: string | null;
  folder_id?: string | null;
}

export interface UpdateNotePatch {
  label?: string;
  content?: string;
  folder_name?: string | null;
  folder_id?: string | null;
  tags?: string[] | null;
}
