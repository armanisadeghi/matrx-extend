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

async function sendToTab(tabId: number, kind: string, payload: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, envelope(kind, payload));
  } catch {
    // Overlay not mounted on that tab — caller handles by re-injecting.
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
  existing: HighlightListItem[] = [],
): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/highlighter.js'],
    });
  } catch (err) {
    console.warn('[highlights] overlay injection failed', err);
    return false;
  }
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
      await sendToTab(tabId, CHANNELS.HIGHLIGHT_PAINT, { items });
    }
  }
  return true;
}

export async function stopHighlighter(tabId: number): Promise<void> {
  await sendToTab(tabId, CHANNELS.HIGHLIGHT_STOP, {});
}

export async function setHighlighterMode(tabId: number, mode: HighlightMode): Promise<void> {
  await sendToTab(tabId, CHANNELS.HIGHLIGHT_SET_MODE, { mode });
}
