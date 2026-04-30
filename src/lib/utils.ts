import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sleep helper. Avoid in tight loops; prefer alarms or events.
 */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lightweight async mutex used to serialize token refresh across SW
 * lifetime. No external dependency needed — single-context, single-thread JS.
 */
export class Mutex {
  private chain: Promise<unknown> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/**
 * Truncate a string for logs. Never log full tokens.
 */
export const truncate = (s: string | undefined, n = 200): string => {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…(+${s.length - n})` : s;
};
