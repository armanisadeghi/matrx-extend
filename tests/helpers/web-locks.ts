/** Browser Web Locks dependency double for Node 22 CI (which has no native locks).
 * Shared across independently imported modules; never replaces audit code.
 */
export function createWebLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, _options: LockOptions, callback: () => Promise<T>): Promise<T> {
      const previous = tails.get(name) ?? Promise.resolve();
      const current = previous.catch(() => {}).then(callback);
      tails.set(name, current);
      void current
        .finally(() => {
          if (tails.get(name) === current) tails.delete(name);
        })
        .catch(() => {});
      return current;
    },
  };
}
