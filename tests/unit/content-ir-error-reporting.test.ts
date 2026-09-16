import { beforeEach, describe, expect, it, vi } from 'vitest';

const logged = vi.hoisted(() => [] as Array<{ level: 'warn' | 'error'; message: string }>);
vi.mock('@/lib/debug/log', () => ({
  log: {
    warn: (_source: string, message: string) => logged.push({ level: 'warn', message }),
    error: (_source: string, message: string) => logged.push({ level: 'error', message }),
  },
}));

import { reportContentIrError } from '@/lib/content-ir/errors';

describe('Content IR error reporting', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it('keeps a recovering warm-load failure out of the extension error ledger', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportContentIrError({
      source: 'content-ir',
      message: 'kind-definition warm load failed (retrying in 1 second)',
      relation: 'kind-registry',
      raw: new Error('statement timeout'),
    });

    expect(logged).toEqual([
      {
        level: 'warn',
        message: '[content-ir] kind-definition warm load failed (retrying in 1 second)',
      },
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('records one error only after recovery is exhausted', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportContentIrError({
      source: 'content-ir',
      message: 'kind-definition warm load failed (retries exhausted — reopen the side panel)',
      relation: 'kind-registry',
      raw: new Error('statement timeout'),
    });

    expect(logged).toEqual([
      {
        level: 'error',
        message:
          '[content-ir] kind-definition warm load failed (retries exhausted — reopen the side panel)',
      },
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('treats a failed warm refresh as a warning while the compiled bootstrap serves', () => {
    reportContentIrError({
      source: 'content-ir',
      message: 'component-resolver warm load failed (compiled bootstrap still serving)',
      relation: 'component-resolver',
      raw: new Error('statement timeout'),
    });

    expect(logged).toEqual([
      {
        level: 'warn',
        message:
          '[content-ir] component-resolver warm load failed (compiled bootstrap still serving)',
      },
    ]);
  });
});
