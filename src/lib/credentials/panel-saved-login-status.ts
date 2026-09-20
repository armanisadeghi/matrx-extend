import { isSafeDestination } from './login-urls';

export type PanelSavedLoginSnapshot =
  | {
      status: 'ready';
      offerId: string;
      itemIds: string[];
      matches: { item_id: string; display_name: string }[];
      pageUrl: string;
      frameId: number;
    }
  | { status: 'none' | 'disabled' | 'loading' | 'unavailable'; itemIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Metadata-only UI boundary. An invalid reply never falls back to login actions. */
export function parsePanelSavedLoginStatus(value: unknown): PanelSavedLoginSnapshot {
  const unavailable: PanelSavedLoginSnapshot = { status: 'unavailable', itemIds: [] };
  if (!record(value)) return unavailable;
  if (value.status === 'none' || value.status === 'disabled') {
    return exactKeys(value, ['status', 'itemIds']) && Array.isArray(value.itemIds) && value.itemIds.length === 0
      ? { status: value.status, itemIds: [] } : unavailable;
  }
  if (value.status !== 'ready' || !exactKeys(value, ['status', 'offerId', 'itemIds', 'matches', 'pageUrl', 'frameId'])) return unavailable;
  if (typeof value.offerId !== 'string' || !/^[0-9a-f]{36}$/.test(value.offerId)
    || typeof value.pageUrl !== 'string' || !Number.isSafeInteger(value.frameId) || (value.frameId as number) < 0
    || !Array.isArray(value.itemIds) || value.itemIds.length === 0 || !Array.isArray(value.matches)) return unavailable;
  try {
    const url = new URL(value.pageUrl);
    if (!isSafeDestination(url) || url.username || url.password || value.pageUrl !== `${url.origin}${url.pathname}`) return unavailable;
  } catch { return unavailable; }
  if (!value.itemIds.every((id): id is string => typeof id === 'string' && UUID.test(id))) return unavailable;
  const ids = new Set(value.itemIds);
  if (ids.size !== value.itemIds.length || value.matches.length !== ids.size) return unavailable;
  const matches: { item_id: string; display_name: string }[] = [];
  const matched = new Set<string>();
  for (const item of value.matches) {
    if (!record(item) || !exactKeys(item, ['item_id', 'display_name'])
      || typeof item.item_id !== 'string' || !ids.has(item.item_id) || matched.has(item.item_id)
      || typeof item.display_name !== 'string' || item.display_name.length === 0) return unavailable;
    matched.add(item.item_id);
    matches.push({ item_id: item.item_id, display_name: item.display_name });
  }
  return { status: 'ready', offerId: value.offerId, itemIds: [...ids], matches, pageUrl: value.pageUrl, frameId: value.frameId as number };
}
