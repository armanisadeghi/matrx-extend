/** Stamp only Chrome's sender identity; page/content payload identity is untrusted. */
export function stampDocumentSender<T extends Record<string, unknown>>(
  payload: T,
  sender: Pick<chrome.runtime.MessageSender, 'tab' | 'documentId'>,
): (T & { tab_id: number; document_id: string }) | null {
  const tabId = sender.tab?.id;
  if (tabId == null || !sender.documentId) return null;
  return { ...payload, tab_id: tabId, document_id: sender.documentId };
}
