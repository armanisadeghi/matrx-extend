import { describe, expect, it } from 'vitest';
import { createWebLocks } from '../helpers/web-locks';

// This fixture is a global browser dependency; skipping either request overload
// silently prevents production callers from performing their storage work.
describe('Web Locks test dependency contract', () => {
  it('executes both request overloads and preserves their distinct results', async () => {
    const locks: Pick<LockManager, 'request'> = createWebLocks();
    const writes: string[] = [];
    const first = await locks.request('capture-queue', () => {
      writes.push('capture');
      return 'capture persisted';
    });
    const second = await locks.request('audit-key', { mode: 'exclusive' }, () => {
      writes.push('audit');
      return 'audit persisted';
    });
    expect([first, second]).toEqual(['capture persisted', 'audit persisted']);
    expect(writes).toEqual(['capture', 'audit']);
  });

  it('serializes mixed overloads on one name and releases after rejection', async () => {
    const locks: Pick<LockManager, 'request'> = createWebLocks();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failed = locks.request('capture-queue', { mode: 'exclusive' }, async () => {
      events.push('first entered');
      await gate;
      throw new Error('storage refused');
    });
    const failedResult = failed.catch((error: Error) => error.message);
    const next = locks.request('capture-queue', () => {
      events.push('second entered');
      return 'recovered';
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first entered']);
    release();
    expect(await failedResult).toBe('storage refused');
    expect(await next).toBe('recovered');
    expect(events).toEqual(['first entered', 'second entered']);
  });

  it('supplies the granted lock metadata to callbacks', async () => {
    const locks: Pick<LockManager, 'request'> = createWebLocks();
    expect(await locks.request('capture-queue', (lock) => lock && [lock.name, lock.mode])).toEqual([
      'capture-queue',
      'exclusive',
    ]);
  });
});

it('fails explicitly when a caller needs unmodeled lock options', async () => {
  const locks = createWebLocks();
  let performed = false;
  await expect(
    locks.request('capture-queue', { mode: 'shared' }, () => {
      performed = true;
    }),
  ).rejects.toThrow('fixture does not implement');
  expect(performed).toBe(false);
});
