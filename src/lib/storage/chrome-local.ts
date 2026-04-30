/**
 * Thin async wrappers around chrome.storage.* — promise-based and typed.
 * Use these instead of the raw API everywhere.
 */

type StorageArea = 'local' | 'session' | 'sync' | 'managed';

const area = (a: StorageArea): chrome.storage.StorageArea => chrome.storage[a];

export async function getOne<T>(key: string, a: StorageArea = 'local'): Promise<T | null> {
  const result = await area(a).get([key]);
  return (result[key] as T | undefined) ?? null;
}

export async function getMany<T extends Record<string, unknown>>(
  keys: (keyof T & string)[],
  a: StorageArea = 'local',
): Promise<Partial<T>> {
  const result = await area(a).get(keys);
  return result as Partial<T>;
}

export async function setOne<T>(key: string, value: T, a: StorageArea = 'local'): Promise<void> {
  await area(a).set({ [key]: value });
}

export async function setMany(
  values: Record<string, unknown>,
  a: StorageArea = 'local',
): Promise<void> {
  await area(a).set(values);
}

export async function removeKeys(keys: string | string[], a: StorageArea = 'local'): Promise<void> {
  await area(a).remove(keys);
}

export async function clear(a: StorageArea = 'local'): Promise<void> {
  await area(a).clear();
}

/**
 * Subscribe to changes for a given key. Returns an unsubscribe function.
 */
export function onChange<T>(
  key: string,
  cb: (newValue: T | null, oldValue: T | null) => void,
  a: StorageArea = 'local',
): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName !== a) return;
    if (!(key in changes)) return;
    const change = changes[key];
    if (!change) return;
    cb((change.newValue as T | undefined) ?? null, (change.oldValue as T | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
