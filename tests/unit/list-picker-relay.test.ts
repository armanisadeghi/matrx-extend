import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (payload: Record<string, unknown>, sender: { tab?: { id: number } }) => unknown
  >(),
  broadcast: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (
    channel: string,
    handler: (payload: Record<string, unknown>, sender: { tab?: { id: number } }) => unknown,
  ) => transport.handlers.set(channel, handler),
  broadcast: transport.broadcast,
}));
import { registerListPickerRelays } from '@/lib/data-pattern/list-picker-relay';
import { CHANNELS } from '@/lib/messaging/schemas';

beforeEach(() => {
  transport.handlers.clear();
  transport.broadcast.mockClear();
  registerListPickerRelays();
});

describe('list picker service worker relay', () => {
  it.each([
    CHANNELS.LIST_PICKER_ITEM_DETECTED,
    CHANNELS.LIST_PICKER_RESULT,
    CHANNELS.LIST_PICKER_EXIT,
  ])('preserves session identity and stamps the actual sender for %s', (channel) => {
    transport.handlers.get(channel)?.(
      { session_id: 'calendar-session', tab_id: 999 },
      { tab: { id: 77 } },
    );
    expect(transport.broadcast.mock.calls).toEqual([
      [channel, { session_id: 'calendar-session', tab_id: 77 }],
    ]);
    transport.broadcast.mockClear();
    transport.handlers.get(channel)?.(
      { session_id: 'replacement-session', tab_id: 77 },
      { tab: { id: 88 } },
    );
    expect(transport.broadcast.mock.calls).toEqual([
      [channel, { session_id: 'replacement-session', tab_id: 88 }],
    ]);
    transport.broadcast.mockClear();
    transport.handlers.get(channel)?.({ session_id: 'replacement-session', tab_id: 88 }, {});
    expect(transport.broadcast).not.toHaveBeenCalled();
  });
});
