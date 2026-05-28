/**
 * Submit client-side tool execution results back to the AI loop.
 *
 *   POST /ai/conversations/{conversation_id}/tool_results
 *   body: { results: ClientToolResult[] }
 *
 * The route is durable: if the originating SSE is still live, the existing
 * loop resumes inline. If it's gone, the response sets `continuation_needed`
 * and we open `/ai/conversations/{id}/resume` to keep the agent moving.
 *
 * 5xx + network errors: retried with exponential backoff (3 attempts total).
 * Dropping a result is the worst possible outcome — the conversation goes
 * deaf and the user has to start over. Better to delay by a few seconds.
 */

import { apiPost } from '@/lib/api/client';
import type { ApiResult } from '@/lib/api/client';
import { log } from '@/lib/debug/log';

export interface ClientToolResultBody {
  call_id: string;
  tool_name: string;
  output?: unknown;
  is_error?: boolean;
  error_message?: string | null;
}

export interface ToolResultsResponse {
  resolved: string[];
  already_resolved: string[];
  not_found: string[];
  continuation_needed: boolean;
  user_request_id: string | null;
  conversation_id: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Whether a failed POST is worth retrying. We retry transient network /
 * upstream errors but NOT semantic 4xx (404 = unknown call_id, 422 = bad
 * payload — retrying these just delays the inevitable user-facing fix).
 */
function shouldRetry(status: number): boolean {
  if (status === 0) return true; // network error / DNS / TLS / CORS
  if (status === 408) return true; // request timeout
  if (status === 429) return true; // rate limited
  if (status >= 500) return true; // 5xx
  return false;
}

export async function postToolResults(
  conversationId: string,
  results: ClientToolResultBody[],
): Promise<ApiResult<ToolResultsResponse>> {
  log.info('msg', `→ POST /ai/conversations/${conversationId}/tool_results (${results.length})`, {
    results,
  });
  const path = `/ai/conversations/${encodeURIComponent(conversationId)}/tool_results`;
  const maxAttempts = 3;
  const baseDelayMs = 500;
  let last: ApiResult<ToolResultsResponse> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await apiPost<ToolResultsResponse>(path, { results });
    last = r;
    if (r.ok) {
      // Defensive shape check — server bugs / a stale gateway returning HTML
      // shouldn't silently look like a successful submit (continuation_needed
      // would be undefined, and the resume handshake would never fire).
      const data = r.data as Partial<ToolResultsResponse> | undefined;
      if (!data || typeof data !== 'object' || typeof data.continuation_needed !== 'boolean') {
        log.error('msg', '← tool_results returned 200 but body is malformed', data);
        return {
          ok: false,
          status: 200,
          error: 'malformed_tool_results_response',
        };
      }
      log.success('msg', '← tool_results ok', r.data);
      return r;
    }
    log.error(
      'msg',
      `✗ tool_results attempt ${attempt}/${maxAttempts} status=${r.status} (${r.error})`,
    );
    if (!shouldRetry(r.status) || attempt === maxAttempts) {
      return r;
    }
    // Exponential backoff with light jitter so two parallel tool results
    // racing the same transient outage don't synchronize their retries.
    const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
    log.warn('msg', `tool_results retrying in ${delay}ms`);
    await sleep(delay);
  }
  // Defensive — loop guarantees at least one assignment, but TypeScript
  // can't see that without an explicit fallback.
  return last ?? { ok: false, status: 0, error: 'tool_results: unreachable retry exit' };
}

/**
 * Open a continuation SSE if the original stream died. The endpoint mirrors
 * /ai/agent/{id} — same NDJSON format. The caller wires it through the same
 * offscreen-buffered consumer.
 */
export const conversationResumePath = (conversationId: string): string =>
  `/ai/conversations/${encodeURIComponent(conversationId)}/resume`;
