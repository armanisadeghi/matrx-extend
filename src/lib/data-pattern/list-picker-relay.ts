import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

/** Preserve the caller's session on every event, stamping the trusted sender tab. */
export function registerListPickerRelays(): void {
  for (const channel of [
    CHANNELS.LIST_PICKER_RESULT,
    CHANNELS.LIST_PICKER_EXIT,
    CHANNELS.LIST_PICKER_ITEM_DETECTED,
  ]) {
    on<Record<string, unknown>, { ack: true }>(channel, (payload, sender) => {
      // Broadcasts self-deliver inside the SW. Only genuine content events relay.
      if (sender.tab) broadcast(channel, { ...payload, tab_id: sender.tab.id ?? null });
      return { ack: true };
    });
  }
}
