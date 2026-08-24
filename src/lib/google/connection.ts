/**
 * Which connected Google account would a reviewed send come FROM?
 *
 * The browser answers this itself: connection metadata is ordinary user data,
 * so it comes straight from Supabase (root CLAUDE.md — the client never routes
 * a DB read through the Python server). Only SAFE metadata is read. The refresh
 * token is not here to read: it lives in aidream's vault, and
 * `credential_item_id` / `vault_secret_key` are REFERENCES (an item id and a key
 * name), never secrets. Reading them is what lets this module tell the truth
 * about a connection's health without a server round trip.
 *
 * Returns `null` rather than throwing: "no Google account connected" is a
 * normal state with a one-click fix, not an error. Every caller turns it into
 * an offer to connect.
 *
 * Mirrors matrx-frontend's `features/google-workspace/connection.ts` +
 * `features/marketing/google/service.ts#connectionSummary` — same table, same
 * health rule, same scope gate. The two surfaces must agree about which
 * mailbox is usable, or the same user sees a different answer in each.
 */

import { log } from '@/lib/debug/log';
import { usersDb } from '@/lib/supabase/schemas';

/**
 * The one scope this module gates on. Canonical registries:
 * matrx-frontend `lib/googleScopes.ts` · aidream
 * `services/google_integrations/scopes.py`.
 *
 * `gmail.send` sends ONE reviewed message. It grants no reading of the
 * mailbox, and nothing here may ever widen it.
 */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/**
 * The scope behind every registered Doc / Sheet. `drive.file` is per-file
 * consent: it reaches ONLY files the user picked with the Google Picker (or
 * that AI Matrx created for them). It is not a Drive listing and can never
 * become one. Canonical registries are the same two files as above.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Where AI Matrx connects to Google. Every refusal points here. */
export const GOOGLE_WORKSPACE_SETTINGS_URL =
  'https://aimatrx.com/user-settings/integrations/google-workspace';

export interface GoogleConnectionRef {
  connectionId: string;
  accountEmail: string | null;
  accountName: string | null;
}

interface ConnectionRow {
  id: string;
  account_email: string | null;
  account_name: string | null;
  scopes: string[] | null;
  status: string | null;
  credential_item_id: string | null;
  vault_secret_key: string | null;
}

/**
 * "We asked and got an answer" vs "we could not ask."
 *
 * These are NOT the same state and must never render the same. An empty list
 * means the user has no qualifying Google account — a real fact with a
 * one-click fix. A failed read means we do not know, and telling that user
 * "nothing is connected" is a lie that sends them to re-connect an account
 * that was fine all along. Callers discriminate on `ok`; the repo convention
 * for an unavailable dependency is `{ ok: false, reason: 'unavailable' }`.
 */
export type GoogleConnectionsResult =
  | { ok: true; connections: GoogleConnectionRef[] }
  | { ok: false; reason: 'unavailable' };

/**
 * Every Google connection this user may actually use, for the ONE scope the
 * caller needs — most-recently-updated first.
 *
 * This is the single health rule in this repo; a second one would let two
 * surfaces disagree about whether the same account works. A row whose
 * credential reference is gone CANNOT authorize anything no matter what
 * `status` claims — the same precondition aidream enforces. Reach (mine, or my
 * organization's) is not re-implemented here: the RLS policy on
 * `users.integration_connections` already answers it, so the rows that come
 * back are exactly the ones the server would consider reachable.
 */
export async function listHealthyGoogleConnections(
  scope: string,
): Promise<GoogleConnectionsResult> {
  const { data, error } = await usersDb()
    .from('integration_connections')
    .select('id, account_email, account_name, scopes, status, credential_item_id, vault_secret_key')
    .eq('provider', 'google')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error || !data) {
    log.error('supabase', 'could not read Google connections', { scope, error });
    return { ok: false, reason: 'unavailable' };
  }

  const connections = (data as ConnectionRow[])
    .filter(
      (row) =>
        row.status === 'connected' &&
        Boolean(row.credential_item_id || row.vault_secret_key) &&
        (row.scopes ?? []).includes(scope),
    )
    .map((row) => ({
      connectionId: row.id,
      accountEmail: row.account_email,
      accountName: row.account_name,
    }));
  return { ok: true, connections };
}

/**
 * The mailbox a reviewed message would be sent from, or null when there isn't
 * one. Deliberately collapses "none" and "couldn't check" into null: every
 * caller is a refusal path that offers to connect, and a reviewed send must
 * never proceed on an unverified connection. The failure is not silent — it is
 * logged in `listHealthyGoogleConnections`.
 */
export async function resolveGmailSendConnection(): Promise<GoogleConnectionRef | null> {
  const result = await listHealthyGoogleConnections(GMAIL_SEND_SCOPE);
  if (!result.ok) return null;
  return result.connections[0] ?? null;
}
