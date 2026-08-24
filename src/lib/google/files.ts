/**
 * The Google Docs and Sheets this user already registered with AI Matrx.
 *
 * This is NOT a Drive browse, and there is no Drive browse anywhere in the
 * platform. A row in `users.integration_connection_resources` exists only
 * because the user picked that file in the Google Picker on the web app (or
 * because AI Matrx created it for them). So this list can never disclose the
 * existence of a file the user has not shared with AI Matrx — the same
 * boundary aidream enforces in `services/google_workspace/service.py`
 * (`list_registered_resources`). Attaching does not widen reach; it narrows
 * attention.
 *
 * Connection metadata and its resources are ordinary user data, so they come
 * straight from Supabase (root CLAUDE.md — the client never routes a DB read
 * through the Python server). RLS on both tables already restricts rows to the
 * connections this user owns or reaches through an organization, which is the
 * same reach rule the server applies.
 *
 * Never throws, and never flattens two different truths into one. "No Google
 * account connected" and "nothing picked yet" are normal states with a
 * one-click fix, so they come back as `{ok: true, files: []}` and the composer
 * chip turns them into an offer to connect. A read that FAILED comes back as
 * `{ok: false}` and is logged, because showing that user the connect pitch
 * would be telling them their files are gone when they are not.
 */

import { log } from '@/lib/debug/log';
import { DRIVE_FILE_SCOPE, listHealthyGoogleConnections } from '@/lib/google/connection';
import { usersDb } from '@/lib/supabase/schemas';

/** The two resource types that can be attached to a turn. */
const ATTACHABLE_RESOURCE_TYPES = ['google_document', 'google_spreadsheet'] as const;

export interface RegisteredGoogleFile {
  /** Google Drive file id — the value that rides in `__google_files`. */
  fileId: string;
  name: string;
  isSheet: boolean;
  connectionEmail: string | null;
}

interface ResourceRow {
  connection_id: string;
  display_name: string | null;
  resource_ref: string;
  resource_type: string;
}

/**
 * "Here is your list" vs "we could not look."
 *
 * Kept distinct all the way to the UI on purpose: rendering a failed read as
 * an empty account tells a user with ten registered files that AI Matrx lost
 * them, and sends them to re-pick files that were never gone.
 */
export type RegisteredGoogleFilesResult =
  | { ok: true; files: RegisteredGoogleFile[] }
  | { ok: false; reason: 'unavailable' };

export async function listRegisteredGoogleFiles(): Promise<RegisteredGoogleFilesResult> {
  const connections = await listHealthyGoogleConnections(DRIVE_FILE_SCOPE);
  // A failed connection read is already logged by the health rule; propagate
  // the distinction rather than flattening it into "no files".
  if (!connections.ok) return connections;
  if (connections.connections.length === 0) return { ok: true, files: [] };

  const emailByConnection = new Map(
    connections.connections.map((c) => [c.connectionId, c.accountEmail] as const),
  );

  const { data, error } = await usersDb()
    .from('integration_connection_resources')
    .select('connection_id, display_name, resource_ref, resource_type')
    .in('connection_id', [...emailByConnection.keys()])
    .in('resource_type', [...ATTACHABLE_RESOURCE_TYPES])
    .is('deleted_at', null);
  if (error || !data) {
    log.error('supabase', 'could not read registered Google files', { error });
    return { ok: false, reason: 'unavailable' };
  }

  const files = (data as ResourceRow[])
    .map((row) => ({
      fileId: row.resource_ref,
      name: row.display_name?.trim() || 'Untitled',
      isSheet: row.resource_type === 'google_spreadsheet',
      connectionEmail: emailByConnection.get(row.connection_id) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(a.isSheet) - Number(b.isSheet) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  return { ok: true, files };
}
