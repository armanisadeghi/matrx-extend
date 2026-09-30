/**
 * deliverToolResult — the ONE place a client-answered tool call is both told
 * to the server AND settled on this client.
 *
 * The extension answers a delegated tool (`tool_delegated`) by POSTing the
 * result to `/ai/conversations/{id}/tool_results`. The server learns the call
 * is done from that POST, but it sends no completion event back: it
 * hard-suspended and ended the stream when it delegated. The sidepanel's tool
 * row therefore only settles from the dispatcher's own terminal
 * `TOOL_TIMELINE_EVENT`.
 *
 * Until 2026-09-30 every caller of the POST broadcast that terminal event
 * itself, and one caller — the boot-time replay of results whose first POST
 * failed — never did. The first failure had already painted the row
 * "Network error … the agent loop may be stuck"; the replay then delivered the
 * answer, the agent resumed on it, and the row kept the error forever.
 *
 * Rule: whoever POSTs a result settles the row in the same tick, here, never
 * per call site. Settling happens only when the server accepted the call id
 * (`ok` and not `not_found`); a refused POST is reported by the caller, which
 * knows the remedy to show. The chat store never lets a terminal row fall back
 * to `started`, so a repeat settle is harmless.
 */

import type { ApiResult } from '@/lib/api/client';
import { postToolResults } from '@/lib/api/routes/tool-results';
import type { ClientToolResultBody, ToolResultsResponse } from '@/lib/api/routes/tool-results';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

/** The terminal row event the sidepanel's timeline router consumes. */
export interface ToolSettleEvent {
  callId: string;
  conversationId: string;
  toolName: string;
  phase: 'completed' | 'error';
  output?: unknown;
  message?: string;
}

export interface DeliverToolResultDeps {
  post: (
    conversationId: string,
    results: ClientToolResultBody[],
  ) => Promise<ApiResult<ToolResultsResponse>>;
  settle: (event: ToolSettleEvent) => void;
}

const defaultDeps: DeliverToolResultDeps = {
  post: postToolResults,
  settle: (event) => broadcast(CHANNELS.TOOL_TIMELINE_EVENT, event),
};

export interface DeliveredToolResult {
  /** The raw POST outcome, for callers that report failures or continue. */
  response: ApiResult<ToolResultsResponse>;
  /** True only when the server accepted (or had already accepted) this call id. */
  delivered: boolean;
}

/** The terminal event a server-accepted answer settles its row to. */
export function settleEventFor(
  conversationId: string,
  result: ClientToolResultBody,
): ToolSettleEvent {
  if (result.is_error) {
    return {
      callId: result.call_id,
      conversationId,
      toolName: result.tool_name,
      phase: 'error',
      message: result.error_message ?? 'The tool reported an error.',
    };
  }
  return {
    callId: result.call_id,
    conversationId,
    toolName: result.tool_name,
    phase: 'completed',
    ...(result.output !== undefined && { output: result.output }),
  };
}

export async function deliverToolResult(
  conversationId: string,
  result: ClientToolResultBody,
  deps: DeliverToolResultDeps = defaultDeps,
): Promise<DeliveredToolResult> {
  const response = await deps.post(conversationId, [result]);
  const delivered =
    response.ok &&
    !(Array.isArray(response.data.not_found) && response.data.not_found.includes(result.call_id));
  if (delivered) deps.settle(settleEventFor(conversationId, result));
  return { response, delivered };
}
