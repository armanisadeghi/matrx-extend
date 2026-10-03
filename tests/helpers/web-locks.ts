/** Browser Web Locks dependency double for Node 22 CI (which has no native locks).
 * Shared across independently imported modules; never replaces audit code.
 * Models the default/exclusive requests used by this repo. Other options fail
 * explicitly so a newly exercised browser contract cannot silently skip work.
 */
type GrantedCallback<T> = (lock: Lock | null) => T | PromiseLike<T>;

export function createWebLocks() {
  const tails = new Map<string, Promise<unknown>>();

  function request<T>(name: string, callback: GrantedCallback<T>): Promise<T>;
  function request<T>(name: string, options: LockOptions, callback: GrantedCallback<T>): Promise<T>;
  function request<T>(
    name: string,
    optionsOrCallback: LockOptions | GrantedCallback<T>,
    suppliedCallback?: GrantedCallback<T>,
  ): Promise<T> {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback;
    if (typeof callback !== 'function') {
      return Promise.reject(new TypeError('Web Locks request requires a callback'));
    }
    if (
      (options.mode !== undefined && options.mode !== 'exclusive') ||
      options.ifAvailable ||
      options.steal ||
      options.signal !== undefined
    ) {
      return Promise.reject(
        new Error('Web Locks fixture does not implement these request options'),
      );
    }
    const previous = tails.get(name) ?? Promise.resolve();
    const lock: Lock = { name, mode: 'exclusive' };
    const current = previous.catch(() => {}).then(() => callback(lock));
    tails.set(name, current);
    void current
      .finally(() => {
        if (tails.get(name) === current) tails.delete(name);
      })
      .catch(() => {});
    return current;
  }

  return { request } satisfies Pick<LockManager, 'request'>;
}

/** Opt in only in suites exercising these Web Locks contracts. */
export function installWebLocksForTest(): void {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: createWebLocks() });
}
