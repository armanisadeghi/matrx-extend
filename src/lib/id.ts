/**
 * Cheap unique IDs. Not crypto-grade — used for runIds, transient message IDs.
 */
export function newId(prefix = 'id'): string {
  const r =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().split('-')[0]
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${r}`;
}
