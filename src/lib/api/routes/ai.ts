import { apiPost } from '@/lib/api/client';
import { z } from 'zod';

export const UnifiedChatRequestSchema = z.object({
  conversation_id: z.string().optional(),
  prompt_id: z.string().optional(),
  agent_id: z.string().optional(),
  message: z.string(),
  variables: z.record(z.unknown()).optional(),
  ai_model_id: z.string().optional(),
});
export type UnifiedChatRequest = z.infer<typeof UnifiedChatRequestSchema>;

export const AgentExecuteRequestSchema = z.object({
  conversation_id: z.string().optional(),
  prompt_id: z.string(),
  message: z.string(),
  is_builtin: z.boolean().optional(),
  variables: z.record(z.unknown()).optional(),
  tools: z.array(z.unknown()).optional(),
});
export type AgentExecuteRequest = z.infer<typeof AgentExecuteRequestSchema>;

export const WARM_PATH = '/ai/agent/warm';
export const CANCEL_PATH = (requestId: string) => `/ai/cancel/${encodeURIComponent(requestId)}`;
export const UNIFIED_CHAT_PATH = '/ai/chat/unified';
export const AGENT_EXECUTE_PATH = '/ai/agent/execute';

export function warmAgent(promptId: string, isBuiltin = false) {
  return apiPost<{ status: string; prompt_id: string }>(WARM_PATH, {
    prompt_id: promptId,
    is_builtin: isBuiltin,
  });
}

export function cancelRequest(requestId: string) {
  return apiPost<{ status: string; request_id: string }>(CANCEL_PATH(requestId), {});
}
