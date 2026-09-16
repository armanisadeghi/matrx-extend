import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '@/lib/debug/log';

describe('debug log console projection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'plain-object',
      { code: 'statement_timeout', message: 'query exceeded deadline' },
      'statement_timeout',
    ],
    ['Error', new Error('extension context invalidated'), 'extension context invalidated'],
  ])('prints %s diagnostic detail as readable text instead of [object Object]', (_kind, detail, expected) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    log.error('sys', 'operation failed', detail);

    expect(consoleError).toHaveBeenCalledTimes(1);
    const line = consoleError.mock.calls[0]?.[0];
    expect(line).toEqual(expect.stringContaining(expected));
    expect(line).not.toEqual(expect.stringContaining('[object Object]'));
    expect(consoleError.mock.calls[0]).toHaveLength(1);
  });
});
