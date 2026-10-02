/**
 * Rejoin a run that is STILL RUNNING.
 *
 * A `/resume` answered `409 run_in_progress`. Its body carries `rejoin_path`
 * (read by `readLiveRunRejoin` in `@ai-matrx/agents/matrx` — never a URL built
 * here, never the envelope's own `request_id`). The client POSTs that path
 * (NDJSON replay, then follow; body `{}`) through the SAME STREAM_START
 * plumbing as every chat stream, under the RUN's organization (the
 * conversation's own), never the session's selection. Chat's
 * `resume_conflict` is retried, never rejoined (the package decides).
 *
 * When the rejoin itself answers `409 live_stream_unavailable` (no journal to
 * replay), `settleUnavailableRejoin` takes the package's ONE fallback —
 * `followUnavailableRejoin` then `settleRunPickup` — so the turn ends exactly
 * as it does in the web app and the desktop: followed to its end, then the
 * saved turn reloaded. Never an empty bubble, never a false failure.
 */

import { matrxTransport } from '@/lib/api/matrx-transport';
import type { StreamRejoinTarget } from '@/lib/api/stream';
import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  dbMessagesToChatMessages,
  fetchConversationMessages,
  fetchConversationToolCalls,
} from '@/lib/supabase/queries';
import { chatDb } from '@/lib/supabase/schemas';
import type { ChatMessage } from '@/state/chat';
import {
  MATRX_RUN_IN_PROGRESS,
  type MatrxRunPickupSettlement,
  followUnavailableRejoin,
  readConversationOrganizationId as readRunConversationOrganizationId,
  settleRunPickup,
} from '@ai-matrx/agents/matrx';

/** The conversation's own organization (the package's reader, fed the extension's db), or null. */
export function readConversationOrganizationId(conversationId: string): Promise<string | null> {
  return readRunConversationOrganizationId(
    conversationId,
    async (id) => {
      const { data, error } = await chatDb()
        .from('conversation')
        .select('organization_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { organization_id?: unknown } | null)?.organization_id;
    },
    (reason) =>
      log.warn('stream', 'rejoin: conversation organization unreadable — using the active one', {
        conversationId,
        error: reason,
      }),
  );
}

export interface RejoinStreamArgs {
  runId: string;
  conversationId: string;
  /** The live run, from the refusal body (`readLiveRunRejoin`). */
  rejoin: StreamRejoinTarget;
  permissionMode: 'ask' | 'act';
  assignedTabId: number | null;
}

/** Open the rejoin stream at the target's `rejoinPath` under `runId`. */
export async function startRejoinStream(args: RejoinStreamArgs): Promise<void> {
  const organizationId = await readConversationOrganizationId(args.conversationId);
  log.info('stream', `rejoining live run at ${args.rejoin.rejoinPath}`, {
    runId: args.runId,
    conversationId: args.conversationId,
  });
  await send(CHANNELS.STREAM_START, {
    runId: args.runId,
    endpoint: args.rejoin.rejoinPath,
    body: {},
    parser: 'rich-events' as const,
    agentName: null,
    permissionMode: args.permissionMode,
    assignedTabId: args.assignedTabId,
    ...(organizationId ? { organizationId } : {}),
  });
}

/** The conversation's saved messages, read the same way the chat view loads them. */
export async function loadSavedConversation(conversationId: string): Promise<ChatMessage[]> {
  const [messages, toolCalls] = await Promise.all([
    fetchConversationMessages(conversationId),
    fetchConversationToolCalls(conversationId),
  ]);
  return dbMessagesToChatMessages(messages.rows, toolCalls.rows).messages;
}

/**
 * A rejoin answered `409 live_stream_unavailable`: follow the run to its end
 * under the conversation's organization, then reload the saved turn
 * (`reloadSavedTurn`). The settlement says what happened (`settled` with the
 * run's real status, or `still_running` when the follow gave up).
 */
export async function settleUnavailableRejoin(args: {
  conversationId: string;
  rejoin: StreamRejoinTarget;
  /** `run_id` the unavailable answer named (workflow legs), else null. */
  unavailableRunId: string | null;
  reloadSavedTurn: () => Promise<void>;
}): Promise<MatrxRunPickupSettlement> {
  const organizationId = await readConversationOrganizationId(args.conversationId);
  log.info('stream', 'rejoin has no live journal — following the run to its end', {
    conversationId: args.conversationId,
    liveRequestId: args.rejoin.liveRequestId,
  });
  let followed: Awaited<ReturnType<typeof followUnavailableRejoin>> | null = null;
  try {
    followed = await followUnavailableRejoin(
      matrxTransport,
      { ...args.rejoin, code: MATRX_RUN_IN_PROGRESS, body: {} },
      { runId: args.unavailableRunId },
      organizationId ? { organizationId } : {},
    );
  } catch (err) {
    // The follow itself failed (network, refused status read): the saved
    // record is still the best truth — reload it rather than leave the turn
    // empty, and report the run as possibly still running.
    log.warn('stream', 'following the run failed — reloading the saved turn', err);
  }
  const settlement = await settleRunPickup(
    followed ?? { kind: 'followed', executionId: 'unknown', ended: false, status: null },
    { reloadSavedTurn: args.reloadSavedTurn },
  );
  log.info('stream', `rejoin settled: ${settlement.state}`, settlement);
  return settlement;
}
