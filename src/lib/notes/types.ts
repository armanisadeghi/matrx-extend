/**
 * Notes — types for the extension's Notes tab.
 *
 * The same `notes` and `note_folders` tables are used by the main React app at
 * matrx-frontend. We deliberately mirror only the columns the extension reads
 * or writes; the main app keeps using its full schema. RLS in Supabase scopes
 * every row to `auth.uid() = user_id` so we never need to filter manually.
 */

import { z } from 'zod';

export const NoteListItemSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  label: z.string(),
  folder_name: z.string().nullable(),
  folder_id: z.string().uuid().nullable(),
  tags: z.array(z.string()).nullable(),
  updated_at: z.string(),
  position: z.number().nullable(),
  is_public: z.boolean().nullable(),
});
export type NoteListItem = z.infer<typeof NoteListItemSchema>;

export const NoteSchema = NoteListItemSchema.extend({
  content: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  is_deleted: z.boolean().nullable(),
  version: z.number().nullable(),
  created_at: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

export const NoteFolderSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  position: z.number().nullable(),
  is_deleted: z.boolean().nullable(),
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
