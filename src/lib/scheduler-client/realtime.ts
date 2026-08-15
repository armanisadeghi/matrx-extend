import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type SchedulerBroadcastEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface SchedulerBroadcastPayload<Row = Record<string, unknown>> {
  schema: string;
  table: string;
  new: Row | null;
  old: Row | null;
}

type Handler = (event: SchedulerBroadcastEvent, payload: SchedulerBroadcastPayload) => void;

interface ChannelEntry {
  channel: RealtimeChannel;
  handlers: Set<Handler>;
  active: boolean;
}

const channels = new WeakMap<SupabaseClient, Map<string, ChannelEntry>>();

/** Share one authorized per-user scheduler topic across all local consumers. */
export function subscribeSchedulerBroadcast(
  supabase: SupabaseClient,
  userId: string,
  handler: Handler,
): () => Promise<void> {
  let clientChannels = channels.get(supabase);
  if (!clientChannels) {
    clientChannels = new Map();
    channels.set(supabase, clientChannels);
  }
  const existing = clientChannels.get(userId);
  if (existing) {
    existing.handlers.add(handler);
    return async () => {
      existing.handlers.delete(handler);
    };
  }

  const channel = supabase.channel(`scheduler:user:${userId}`, {
    config: { private: true },
  });
  const entry: ChannelEntry = { channel, handlers: new Set([handler]), active: true };
  clientChannels.set(userId, entry);
  for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    channel.on('broadcast', { event }, (message) => {
      const payload = message.payload as SchedulerBroadcastPayload;
      for (const listener of entry.handlers) listener(event, payload);
    });
  }
  void supabase.realtime.setAuth().then(() => {
    if (entry.active) channel.subscribe();
  });

  return async () => {
    entry.handlers.delete(handler);
    if (entry.handlers.size > 0) return;
    entry.active = false;
    clientChannels?.delete(userId);
    await supabase.removeChannel(channel);
  };
}
