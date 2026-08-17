/** Canonical server-resolved target for a brand-new extension chat. */
export const DEFAULT_CHAT_MANDATE_KEY = 'chat.default_new_chat' as const;

/**
 * Stable UI identity for a Mandate-backed choice. This is not an agent id and
 * is never sent to an agent-id route; the stream path uses `mandateKey`.
 */
export const DEFAULT_CHAT_MANDATE_REF = `mandate:${DEFAULT_CHAT_MANDATE_KEY}` as const;

export const STRUCTURED_EXTRACTOR_MANDATE_KEY = 'extend.structured_extractor' as const;
export const STRUCTURED_EXTRACTOR_MANDATE_REF =
  `mandate:${STRUCTURED_EXTRACTOR_MANDATE_KEY}` as const;

export const PATTERN_FROM_DATA_MANDATE_KEY = 'extend.pattern_from_data' as const;

export function isMandateAgentRef(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('mandate:');
}

export function mandateKeyFromAgentRef(value: string | null | undefined): string | null {
  if (!isMandateAgentRef(value)) return null;
  const key = value?.slice('mandate:'.length) ?? '';
  return key.length > 0 ? key : null;
}
