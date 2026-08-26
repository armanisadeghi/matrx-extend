/**
 * Turn-boundary inbox — client-side state for messages the user queues into a
 * still-running agent run.
 *
 * The contract (/Users/armanisadeghi/code/common-docs/systems/agents/execution-runtime/TURN-BOUNDARY-INBOX.md): while a run is streaming for a
 * conversation, the user can keep typing and "send" — instead of starting a
 * second run we POST the text to `/ai/conversations/{id}/inbox`. The running
 * agent drains it at its next natural pause and answers it on the SAME stream.
 *
 * This store holds the in-flight queued items so the composer can float a
 * "waiting its turn" card above the input. Lifecycle of one item:
 *
 *   enqueue (status 'sending')                       — optimistic, before POST returns
 *     → markPending(injectionId)  (status 'pending') — server accepted; now we wait
 *       → markDeliveredByInjectionId (status 'delivered') — stream emitted injection_consumed
 *     → markFailed(error)         (status 'failed')  — POST failed
 *
 * Ephemeral by design — NOT persisted. A reopened side panel loses local items;
 * rebuilding them needs a server "list pending inbox items" endpoint that does
 * not exist yet (see /Users/armanisadeghi/code/common-docs/systems/clients/extension/WIRE_CONTRACT.md).
 */

import { create } from 'zustand';

export type QueuedStatus = 'sending' | 'pending' | 'delivered' | 'failed';

export interface QueuedInjection {
  /** Our own id, assigned at enqueue time before the server's injection_id is known. */
  localId: string;
  /** Server-assigned id; null until the POST resolves. Matches `injection_consumed`. */
  injectionId: string | null;
  conversationId: string | null;
  text: string;
  status: QueuedStatus;
  /** When the user hit send — drives the live "waiting" timer. */
  queuedAt: number;
  /** When the running agent drained it. */
  deliveredAt?: number;
  /** Populated on 'failed'. */
  error?: string;
}

interface TurnInboxState {
  items: QueuedInjection[];
  enqueue: (item: { localId: string; conversationId: string | null; text: string }) => void;
  markPending: (localId: string, injectionId: string) => void;
  markFailed: (localId: string, error: string) => void;
  /** Replace an item's text locally after a successful edit (PATCH). */
  updateText: (localId: string, text: string) => void;
  /**
   * Flip the matching item to 'delivered' and return it (so the caller can
   * render the now-delivered text as a real message bubble). Returns null if
   * we have no local record of this injection (e.g. side panel was reopened).
   */
  markDeliveredByInjectionId: (injectionId: string) => QueuedInjection | null;
  remove: (localId: string) => void;
  clearForConversation: (conversationId: string | null) => void;
  reset: () => void;
}

export const useTurnInboxStore = create<TurnInboxState>()((set, get) => ({
  items: [],
  enqueue: ({ localId, conversationId, text }) =>
    set((s) => ({
      items: [
        ...s.items,
        {
          localId,
          injectionId: null,
          conversationId,
          text,
          status: 'sending',
          queuedAt: Date.now(),
        },
      ],
    })),
  markPending: (localId, injectionId) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.localId === localId ? { ...i, injectionId, status: 'pending' } : i,
      ),
    })),
  markFailed: (localId, error) =>
    set((s) => ({
      items: s.items.map((i) => (i.localId === localId ? { ...i, status: 'failed', error } : i)),
    })),
  updateText: (localId, text) =>
    set((s) => ({
      items: s.items.map((i) => (i.localId === localId ? { ...i, text } : i)),
    })),
  markDeliveredByInjectionId: (injectionId) => {
    const match = get().items.find((i) => i.injectionId === injectionId) ?? null;
    if (!match) return null;
    set((s) => ({
      items: s.items.map((i) =>
        i.injectionId === injectionId ? { ...i, status: 'delivered', deliveredAt: Date.now() } : i,
      ),
    }));
    return { ...match, status: 'delivered', deliveredAt: Date.now() };
  },
  remove: (localId) => set((s) => ({ items: s.items.filter((i) => i.localId !== localId) })),
  clearForConversation: (conversationId) =>
    set((s) => ({
      items: s.items.filter((i) => i.conversationId !== conversationId),
    })),
  reset: () => set({ items: [] }),
}));
