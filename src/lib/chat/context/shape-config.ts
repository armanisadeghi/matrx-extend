/**
 * Which context shape to ship to the server.
 *
 * 'v2-bundled' (default) — the bundled, opinionated shape. ~12 keys, big rich
 *                          values. Designed for Matrx's auto-context-fetch
 *                          where each key costs ~one line in the model's
 *                          available-keys menu, regardless of payload size.
 *
 * 'v1-flat'             — the legacy 65-key flat shape. Kept behind an admin
 *                          toggle so we can A/B compare on real conversations.
 *                          Slated for removal once v2 proves out.
 */

export type ContextShape = 'v1-flat' | 'v2-bundled';

const STORAGE_KEY = 'matrx.context.shape';
const DEFAULT_SHAPE: ContextShape = 'v2-bundled';

export async function getContextShape(): Promise<ContextShape> {
  try {
    const r = await chrome.storage.local.get([STORAGE_KEY]);
    const v = r[STORAGE_KEY];
    if (v === 'v1-flat' || v === 'v2-bundled') return v;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_SHAPE;
}

export async function setContextShape(shape: ContextShape): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: shape });
}

export const CONTEXT_SHAPE_STORAGE_KEY = STORAGE_KEY;
export const DEFAULT_CONTEXT_SHAPE = DEFAULT_SHAPE;
