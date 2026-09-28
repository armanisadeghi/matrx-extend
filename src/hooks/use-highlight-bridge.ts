/**
 * Highlight capture bridge — mount ONCE at the side-panel root.
 *
 * The on-page overlay can't talk to Supabase (no auth session in the page), so
 * it relays every capture here. This hook owns the DB write and keeps the
 * Highlight store in sync, regardless of which side-panel tab is active.
 *
 *   overlay ──HIGHLIGHT_CAPTURED──▶ this hook → createHighlight() → reply {id}
 *   overlay ──HIGHLIGHT_CLEAR_REQUEST──▶ clearHighlightsForUrl()
 *   overlay ──HIGHLIGHT_OVERLAY_STATE──▶ mirror overlay status into the store
 *   (any write) ──HIGHLIGHTS_CHANGED──▶ re-list so every surface refreshes
 */

import { confirmDestructive } from '@/lib/destructive/confirm';
import { clearHighlightsForUrl, createHighlight, listMyHighlights } from '@/lib/highlights/queries';
import type { CreateHighlightInput, HighlightListItem } from '@/lib/highlights/types';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { isDbFailureError } from '@/lib/supabase/db-failure';
import { useHighlightStore } from '@/state/highlights';
import { useEffect } from 'react';

function fromRepresentedDocument(sender: chrome.runtime.MessageSender, url: string): boolean {
  const session = useHighlightStore.getState().overlaySession;
  return !!session && sender.tab?.id === session.tabId && sender.documentId === session.documentId
    && sender.frameId === 0 && sender.url === session.url && url === session.url;
}

function toListItem(h: {
  id: string;
  created_by: string | null;
  conversation_id: string | null;
  mode: 'text' | 'element';
  url: string;
  domain: string;
  page_title: string | null;
  color: string;
  text: string | null;
  anchor: HighlightListItem['anchor'];
  created_at: string;
  updated_at: string;
}): HighlightListItem {
  return {
    id: h.id,
    created_by: h.created_by,
    conversation_id: h.conversation_id,
    mode: h.mode,
    url: h.url,
    domain: h.domain,
    page_title: h.page_title,
    color: h.color,
    text: h.text,
    anchor: h.anchor,
    created_at: h.created_at,
    updated_at: h.updated_at,
  };
}

export function useHighlightBridge(): void {
  const upsertItem = useHighlightStore((s) => s.upsertItem);
  const setItems = useHighlightStore((s) => s.setItems);
  const setOverlay = useHighlightStore((s) => s.setOverlay);
  const setMode = useHighlightStore((s) => s.setMode);

  useEffect(() => {
    const offCaptured = on<CreateHighlightInput, { id: string } | { __error: string }>(
      CHANNELS.HIGHLIGHT_CAPTURED,
      async (draft, sender) => {
        if (!fromRepresentedDocument(sender, draft.url)) return { __error: 'This highlight came from a page that is no longer being highlighted. Start highlighting that page again.' };
        // A refused insert throws; the user has already been told in a
        // sentence by the error seam. Hand the overlay the real reason so the
        // mark is removed instead of sitting there looking saved.
        let saved: Awaited<ReturnType<typeof createHighlight>>;
        try {
          saved = await createHighlight(draft);
        } catch (err) {
          return { __error: isDbFailureError(err) ? err.userMessage : String(err) };
        }
        upsertItem(toListItem(saved));
        broadcast(CHANNELS.HIGHLIGHTS_CHANGED, { reason: 'create', url: saved.url });
        return { id: saved.id };
      },
    );

    const offClear = on<{ url: string; count?: number }, { ok: boolean; reason?: string }>(
      CHANNELS.HIGHLIGHT_CLEAR_REQUEST,
      async ({ url, count }, sender) => {
        if (!fromRepresentedDocument(sender, url)) return { ok: false, reason: 'This page is no longer being highlighted. Start highlighting it again.' };
        // The overlay's trash button lands here. The confirmation is raised
        // HERE, not on the page, because the side panel is where the dialog
        // host is — and the overlay unpaints only when this answers ok.
        //
        // A refused clear throws (the user has been told why by the notice).
        // ANSWER the overlay with the reason instead of rejecting its request:
        // a rejected bridge call is indistinguishable from a dropped message,
        // and the overlay has no way to tell them apart. Resync the list either
        // way so the panel shows what the database actually holds.
        let outcome: { ok: boolean; reason?: string } = { ok: true };
        const n = typeof count === 'number' && count > 0 ? count : null;
        try {
          const confirmed = await confirmDestructive({
            title: n
              ? `Clear ${n === 1 ? 'the highlight' : `all ${n} highlights`} on this page?`
              : 'Clear every highlight on this page?',
            consequence: `${n === 1 ? 'The highlight' : 'Every highlight'} you saved on this page is removed from your highlights and stops being available to the agent. This cannot be undone from the extension.`,
            alternative:
              'To remove just one, cancel and use the trash icon on that row in the Highlights tab.',
            confirmLabel: n ? `Clear ${n}` : 'Clear all',
            run: async () => {
              if (!fromRepresentedDocument(sender, url)) throw new Error('This page is no longer being highlighted. Start highlighting it again.');
              await clearHighlightsForUrl(url);
              broadcast(CHANNELS.HIGHLIGHTS_CHANGED, { reason: 'clear', url });
            },
          });
          if (!confirmed) outcome = { ok: false, reason: 'cancelled' };
        } catch (err) {
          outcome = {
            ok: false,
            reason: isDbFailureError(err) ? err.userMessage : String(err),
          };
        } finally {
          setItems(await listMyHighlights());
        }
        return outcome;
      },
    );

    const offState = on<
      { mounted: boolean; mode: 'text' | 'element'; count: number; url: string },
      { ok: true }
    >(CHANNELS.HIGHLIGHT_OVERLAY_STATE, (p, sender) => {
      if (!fromRepresentedDocument(sender, p.url)) return { ok: true };
      if (!p.mounted) useHighlightStore.getState().setOverlaySession(null);
      else if (useHighlightStore.getState().overlaySession?.status === 'active') {
        setOverlay({ active: true, count: p.count });
      }
      if (p.mode) setMode(p.mode);
      return { ok: true };
    });

    const offChanged = on<{ reason?: string }, { ok: true }>(
      CHANNELS.HIGHLIGHTS_CHANGED,
      async () => {
        const items = await listMyHighlights();
        setItems(items);
        return { ok: true };
      },
    );

    return () => {
      offCaptured();
      offClear();
      offState();
      offChanged();
    };
  }, [upsertItem, setItems, setOverlay, setMode]);

  // The content-script overlay dies silently on navigation/reload — the
  // panel kept showing "Stop highlighting" for a dead overlay and the first
  // toggle click was eaten "stopping" it. Watch the overlay tab and reset.
  useEffect(() => {
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (tabId === useHighlightStore.getState().overlaySession?.tabId && change.status === 'loading') {
        useHighlightStore.getState().setOverlaySession(null);
      }
    };
    const onRemoved = (tabId: number) => {
      if (tabId === useHighlightStore.getState().overlaySession?.tabId) useHighlightStore.getState().setOverlaySession(null);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, []);
}
