/**
 * Side-panel → page control for the highlighter overlay.
 *
 * Injects the runtime content script (built to content-scripts/highlighter.js)
 * then drives it via chrome.tabs.sendMessage. Mounting is idempotent in the
 * overlay, so calling start() while already active just re-paints.
 */

import type { HighlightAnchor, HighlightListItem, HighlightMode } from '@/lib/highlights/types';
import { CHANNELS } from '@/lib/messaging/schemas';

function envelope(kind: string, payload: unknown) {
  return { __matrx: true, kind, payload };
}

async function sendToTab(
  tabId: number,
  documentId: string,
  kind: string,
  payload: unknown,
): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, envelope(kind, payload), { documentId });
    return true;
  } catch {
    return false;
  }
}

export interface PaintItem {
  id: string;
  mode: HighlightMode;
  color: string;
  anchor: HighlightAnchor;
}

/**
 * Inject the highlighter into a tab and paint any existing highlights. Safe to
 * call repeatedly. Returns false if injection failed (e.g. chrome:// page).
 */
export async function startHighlighter(
  tabId: number,
  documentId: string,
  sessionId: string,
  existing: HighlightListItem[] = [],
): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      files: ['content-scripts/highlighter.js'],
    });
  } catch (err) {
    console.warn('[highlights] overlay injection failed', err);
    return false;
  }
  // The content entrypoint registers its listener synchronously. No capture
  // or state message is valid until this session token reaches that document.
  if (!(await sendToTab(tabId, documentId, CHANNELS.HIGHLIGHT_START, { sessionId }))) return false;
  if (existing.length > 0) {
    const items: PaintItem[] = existing.map((h) => ({
      id: h.id,
      mode: h.mode,
      color: h.color,
      anchor: h.anchor,
    }));
    // The overlay registers its message listener inside an async main(), so a
    // single immediate PAINT can race the injection. Send a few times — the
    // overlay dedupes by id, so extra sends are harmless.
    for (const delay of [80, 300, 700]) {
      await new Promise((r) => setTimeout(r, delay));
      await sendToTab(tabId, documentId, CHANNELS.HIGHLIGHT_PAINT, { sessionId, items });
    }
  }
  return true;
}

export async function stopHighlighter(
  tabId: number,
  documentId: string,
  sessionId: string,
): Promise<void> {
  await sendToTab(tabId, documentId, CHANNELS.HIGHLIGHT_STOP, { sessionId });
}

export async function setHighlighterMode(
  tabId: number,
  documentId: string,
  sessionId: string,
  mode: HighlightMode,
): Promise<void> {
  await sendToTab(tabId, documentId, CHANNELS.HIGHLIGHT_SET_MODE, { sessionId, mode });
}
