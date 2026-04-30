/**
 * Submit client-side tool execution results back to the AI loop.
 *
 *   POST /conversations/{conversation_id}/tool_results
 *   body: { results: ClientToolResult[] }
 *
 * The route is durable: if the originating SSE is still live, the existing
 * loop resumes inline. If it's gone, the response sets `continuation_needed`
 * and we open `/conversations/{id}/resume` to keep the agent moving.
 */

import { apiPost } from '@/lib/api/client';
import { log } from '@/lib/debug/log';

export interface ClientToolResultBody {
  call_id: string;
  tool_name: string;
  output?: unknown;
  is_error?: boolean;
  error_message?: string | null;
}

interface ToolResultsResponse {
  resolved: string[];
  already_resolved: string[];
  not_found: string[];
  continuation_needed: boolean;
  user_request_id: string | null;
  conversation_id: string;
}

export async function postToolResults(conversationId: string, results: ClientToolResultBody[]) {
  log.info('msg', `→ POST /conversations/${conversationId}/tool_results (${results.length})`, {
    results,
  });
  const r = await apiPost<ToolResultsResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/tool_results`,
    { results },
  );
  if (r.ok) {
    log.success('msg', '← tool_results ok', r.data);
  } else {
    log.error('msg', '← tool_results FAILED', r.error);
  }
  return r;
}

/**
 * Open a continuation SSE if the original stream died. The endpoint mirrors
 * /ai/agent/{id} — same NDJSON format. The caller wires it through the same
 * offscreen-buffered consumer.
 */
export const conversationResumePath = (conversationId: string): string =>
  `/conversations/${encodeURIComponent(conversationId)}/resume`;
