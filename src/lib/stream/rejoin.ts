/**
 * Rejoin a run that is STILL RUNNING.
 *
 * A `/resume` answered a live-run 409 (`run_in_progress`, or a
 * `resume_conflict` that names a live run). Its body carries `rejoin_path`
 * (read by `readLiveRunRejoin` in `@ai-matrx/agents/matrx` — never a URL built
 * here, never the envelope's own `request_id`). The client POSTs that path
 * (NDJSON replay, then follow; body `{}`) through the SAME STREAM_START
 * plumbing as every chat stream, under the RUN's organization (the
 * conversation's own), never the session's selection.
 */

import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { chatDb } from '@/lib/supabase/schemas';

/** The conversation's own organization, or null when it cannot be read. */
export async function readConversationOrganizationId(
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await chatDb()
    .from('conversation')
    .select('organization_id')
    .eq('id', conversationId)
    .maybeSingle();
  const organizationId = (data as { organization_id?: unknown } | null)?.organization_id;
  if (error || typeof organizationId !== 'string' || !organizationId) {
    log.warn('stream', 'rejoin: conversation organization unreadable — using the active one', {
      conversationId,
      error: error?.message ?? null,
    });
    return null;
  }
  return organizationId;
}

export interface RejoinStreamArgs {
  runId: string;
  conversationId: string;
  /** Server-relative path from the refusal body (`rejoin_path`). */
  rejoinPath: string;
  permissionMode: 'ask' | 'act';
  assignedTabId: number | null;
}

/** Open the rejoin stream at `rejoinPath` under `runId`. */
export async function startRejoinStream(args: RejoinStreamArgs): Promise<void> {
  const organizationId = await readConversationOrganizationId(args.conversationId);
  log.info('stream', `rejoining live run at ${args.rejoinPath}`, {
    runId: args.runId,
    conversationId: args.conversationId,
  });
  await send(CHANNELS.STREAM_START, {
    runId: args.runId,
    endpoint: args.rejoinPath,
    body: {},
    parser: 'rich-events' as const,
    agentName: null,
    permissionMode: args.permissionMode,
    assignedTabId: args.assignedTabId,
    ...(organizationId ? { organizationId } : {}),
  });
}
