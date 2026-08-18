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
 * The mailbox a reviewed message would be sent from, or null when there isn't
 * one. A row whose credential reference is gone CANNOT authorize anything no
 * matter what `status` claims — same precondition aidream enforces.
 */
export async function resolveGmailSendConnection(): Promise<GoogleConnectionRef | null> {
  const { data, error } = await usersDb()
    .from('integration_connections')
    .select('id, account_email, account_name, scopes, status, credential_item_id, vault_secret_key')
    .eq('provider', 'google')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error || !data) return null;

  const usable = (data as ConnectionRow[]).find(
    (row) =>
      row.status === 'connected' &&
      Boolean(row.credential_item_id || row.vault_secret_key) &&
      (row.scopes ?? []).includes(GMAIL_SEND_SCOPE),
  );
  if (!usable) return null;
  return {
    connectionId: usable.id,
    accountEmail: usable.account_email,
    accountName: usable.account_name,
  };
}
