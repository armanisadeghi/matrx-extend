import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';

/** The account's saved Agent choice is never authority for a guest run. */
export function chatTargetForViewer(userId: string | null, selectedAgentId: string | null): string {
  return userId ? (selectedAgentId ?? DEFAULT_CHAT_MANDATE_REF) : DEFAULT_CHAT_MANDATE_REF;
}

/** In-memory turns belong to the signed-in identity that opened them. */
export function shouldDiscardChatOnIdentityChange(
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return previousUserId !== nextUserId;
}
