/** One represented overlay, pinned to the document where the user started it. */
import { getActiveTabIdentitySnapshot, isCurrentPageIdentity } from '@/hooks/use-active-tab';
import { setHighlighterMode, startHighlighter, stopHighlighter } from '@/lib/highlights/control';
import { listHighlightsForUrl } from '@/lib/highlights/queries';
import type { HighlightMode } from '@/lib/highlights/types';
import { useHighlightStore, type HighlightOverlaySession } from '@/state/highlights';

function sameSession(a: HighlightOverlaySession | null, b: HighlightOverlaySession): boolean {
  return a === b;
}

export async function startHighlightSession(): Promise<boolean> {
  const page = getActiveTabIdentitySnapshot();
  if (page.identityStatus !== 'ready' || !page.id || !page.documentId || !page.pageKey || !page.url) return false;
  const previous = useHighlightStore.getState().overlaySession;
  if (previous) {
    useHighlightStore.getState().setOverlaySession(null);
    await stopHighlighter(previous.tabId, previous.documentId, previous.sessionId);
  }
  if (!isCurrentPageIdentity(page.pageKey)) return false;
  const session: HighlightOverlaySession = {
    sessionId: crypto.randomUUID(),
    tabId: page.id, documentId: page.documentId, pageKey: page.pageKey,
    url: page.url, status: 'starting',
  };
  // Publish the pending identity before the first await so navigation can
  // cancel this start, even while the saved-highlight lookup is in flight.
  useHighlightStore.getState().setOverlaySession(session);
  try {
    const existing = await listHighlightsForUrl(session.url);
    if (!sameSession(useHighlightStore.getState().overlaySession, session) || !isCurrentPageIdentity(session.pageKey)) return false;
    const mounted = await startHighlighter(session.tabId, session.documentId, session.sessionId, existing);
    if (!sameSession(useHighlightStore.getState().overlaySession, session) || !isCurrentPageIdentity(session.pageKey)) {
      if (mounted) await stopHighlighter(session.tabId, session.documentId, session.sessionId);
      return false;
    }
    if (!mounted) {
      useHighlightStore.getState().setOverlaySession(null);
      return false;
    }
    useHighlightStore.getState().setOverlaySession({ ...session, status: 'active' });
    await setHighlighterMode(session.tabId, session.documentId, session.sessionId, useHighlightStore.getState().mode);
    return true;
  } catch (error) {
    if (sameSession(useHighlightStore.getState().overlaySession, session)) useHighlightStore.getState().setOverlaySession(null);
    throw error;
  }
}

export async function stopHighlightSession(): Promise<void> {
  const session = useHighlightStore.getState().overlaySession;
  if (!session) return;
  useHighlightStore.getState().setOverlaySession(null);
  await stopHighlighter(session.tabId, session.documentId, session.sessionId);
}

export async function setHighlightSessionMode(mode: HighlightMode): Promise<void> {
  useHighlightStore.getState().setMode(mode);
  const session = useHighlightStore.getState().overlaySession;
  if (session?.status === 'active') await setHighlighterMode(session.tabId, session.documentId, session.sessionId, mode);
}
