/** Required conversation-start fields shared by every parallel child run. */
export function buildParallelStartContract(
  organizationId: string,
  conversationId: string = crypto.randomUUID(),
): {
  organization_id: string;
  conversation_id: string;
  is_new: true;
  store: true;
} {
  return {
    organization_id: organizationId,
    conversation_id: conversationId,
    is_new: true,
    store: true,
  };
}
