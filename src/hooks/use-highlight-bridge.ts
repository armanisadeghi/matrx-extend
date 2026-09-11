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

import { clearHighlightsForUrl, createHighlight, listMyHighlights } from '@/lib/highlights/queries';
import type { CreateHighlightInput, HighlightListItem } from '@/lib/highlights/types';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { isDbFailureError } from '@/lib/supabase/db-failure';
import { useHighlightStore } from '@/state/highlights';
import { useEffect } from 'react';

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
      async (draft) => {
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

    const offClear = on<{ url: string }, { ok: boolean; reason?: string }>(
      CHANNELS.HIGHLIGHT_CLEAR_REQUEST,
      async ({ url }) => {
        // A refused clear throws (the user has been told why by the notice).
        // ANSWER the overlay with the reason instead of rejecting its request:
        // a rejected bridge call is indistinguishable from a dropped message,
        // and the overlay has no way to tell them apart. Resync the list either
        // way so the panel shows what the database actually holds.
        let outcome: { ok: boolean; reason?: string } = { ok: true };
        try {
          await clearHighlightsForUrl(url);
        } catch (err) {
          outcome = {
            ok: false,
            reason: isDbFailureError(err) ? err.userMessage : String(err),
          };
        } finally {
          setItems(await listMyHighlights());
          broadcast(CHANNELS.HIGHLIGHTS_CHANGED, { reason: 'clear', url });
        }
        return outcome;
      },
    );

    const offState = on<
      { mounted: boolean; mode: 'text' | 'element'; count: number; url: string },
      { ok: true }
    >(CHANNELS.HIGHLIGHT_OVERLAY_STATE, (p, sender) => {
      setOverlay({ active: p.mounted, tabId: sender.tab?.id ?? null, count: p.count });
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
  const overlayTabId = useHighlightStore((s) => s.overlayTabId);
  useEffect(() => {
    if (overlayTabId == null) return;
    const onUpdated = (tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (tabId === overlayTabId && change.status === 'loading') {
        setOverlay({ active: false, tabId: null, count: 0 });
      }
    };
    const onRemoved = (tabId: number) => {
      if (tabId === overlayTabId) setOverlay({ active: false, tabId: null, count: 0 });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [overlayTabId, setOverlay]);
}
