/**
 * Sidepanel-side listener for the right-click context-menu protocol.
 *
 * Two paths feed the same `applySelection` action:
 *   - Cold open: the SW stashed the selected text in
 *     `chrome.storage.session` before the sidepanel mounted. We drain
 *     and clear that key on the first effect run.
 *   - Warm open: the SW broadcast `CHAT_DRAFT_FROM_SELECTION`. The
 *     listener registered below catches it and applies immediately.
 *
 * Behavior: switch to the chat tab and prepend/append the selected text
 * to the existing draft (we never clobber typed text — the user might
 * have been mid-thought).
 */

import { log } from '@/lib/debug/log';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useChatStore } from '@/state/chat';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { useEffect } from 'react';

const PENDING_DRAFT_KEY = 'matrx.chat.pending_draft';

export function useContextMenuListener(): void {
  useEffect(() => {
    void drainPendingDraft();

    const unsubscribe = on<{ text: string }, { ack: true }>(
      CHANNELS.CHAT_DRAFT_FROM_SELECTION,
      (payload) => {
        applySelection(payload.text);
        return { ack: true };
      },
    );
    return unsubscribe;
  }, []);
}

function applySelection(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const chat = useChatStore.getState();
  const existing = chat.draft;
  const next = existing.length > 0 ? `${existing}\n\n${trimmed}` : trimmed;
  chat.setDraft(next);
  useSidepanelTabStore.getState().setTab('chat');
}

async function drainPendingDraft(): Promise<void> {
  try {
    if (!chrome.storage?.session) return;
    const r = await chrome.storage.session.get([PENDING_DRAFT_KEY]);
    const pending = r[PENDING_DRAFT_KEY] as string | undefined;
    if (!pending) return;
    await chrome.storage.session.remove([PENDING_DRAFT_KEY]);
    applySelection(pending);
  } catch (err) {
    log.warn('sys', 'context-menu pending draft drain failed', err);
  }
}
