/**
 * AI route definitions. Endpoint paths and request shapes verified against
 * `types/python-generated/openapi.json` (run `pnpm update-api-types` to refresh).
 */

import { apiPost } from '@/lib/api/client';

/** POST /ai/agent/{agent_id} — start agent stream. agent_id is in the URL. */
export const agentExecutePath = (agentId: string): string =>
  `/ai/agent/${encodeURIComponent(agentId)}`;

/**
 * AgentStartRequest shape (subset — full schema in api-types.ts).
 * Matches the live FastAPI route as of 2026-04-30.
 */
export interface AgentStartRequest {
  user_input?: string;
  variables?: Record<string, unknown> | null;
  conversation_id?: string | null;
  is_new?: boolean | null;
  stream?: boolean;
  store?: boolean;
  debug?: boolean;
  client_tools?: string[];
  custom_tools?: Record<string, unknown>[];
  context?: Record<string, unknown>;
  source_app?: string;
  source_feature?: string;
}

/** POST /ai/chat — direct chat with explicit ai_model_id (not used by extension v1). */
export const CHAT_PATH = '/ai/chat';

/** POST /ai/agents/{agent_id}/warm — warm an agent before sending. */
export const agentWarmPath = (agentId: string): string =>
  `/ai/agents/${encodeURIComponent(agentId)}/warm`;

/** POST /ai/cancel/{request_id} — cancel an in-flight stream. */
export const cancelPath = (requestId: string): string =>
  `/ai/cancel/${encodeURIComponent(requestId)}`;

export function warmAgent(agentId: string) {
  return apiPost<{ status: string }>(agentWarmPath(agentId), {});
}

export function cancelRequest(requestId: string) {
  return apiPost<{ status: string }>(cancelPath(requestId), {});
}
