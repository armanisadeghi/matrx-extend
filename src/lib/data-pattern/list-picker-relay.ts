import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

/** Preserve the caller's session and stamp only trusted sender identity. */
export function registerListPickerRelays(): void {
  for (const channel of [
    CHANNELS.LIST_PICKER_RESULT,
    CHANNELS.LIST_PICKER_EXIT,
    CHANNELS.LIST_PICKER_ITEM_DETECTED,
  ]) {
    on<Record<string, unknown>, { ack: true }>(channel, (payload, sender) => {
      // Broadcasts self-deliver inside the SW. Only genuine content events relay.
      if (sender.tab?.id && sender.documentId) {
        broadcast(channel, { ...payload, tab_id: sender.tab.id, document_id: sender.documentId });
      }
      return { ack: true };
    });
  }
}
