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

import { useEffect } from 'react';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  clearHighlightsForUrl,
  createHighlight,
  listMyHighlights,
} from '@/lib/highlights/queries';
import type { CreateHighlightInput, HighlightListItem } from '@/lib/highlights/types';
import { useHighlightStore } from '@/state/highlights';

function toListItem(h: {
  id: string;
  user_id: string;
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
    user_id: h.user_id,
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
        const saved = await createHighlight(draft);
        if (!saved) return { __error: 'save failed' };
        upsertItem(toListItem(saved));
        broadcast(CHANNELS.HIGHLIGHTS_CHANGED, { reason: 'create', url: saved.url });
        return { id: saved.id };
      },
    );

    const offClear = on<{ url: string }, { ok: true }>(
      CHANNELS.HIGHLIGHT_CLEAR_REQUEST,
      async ({ url }) => {
        await clearHighlightsForUrl(url);
        const items = await listMyHighlights();
        setItems(items);
        broadcast(CHANNELS.HIGHLIGHTS_CHANGED, { reason: 'clear', url });
        return { ok: true };
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
}
