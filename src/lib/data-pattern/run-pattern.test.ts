import type { ExtractionPattern } from '@/lib/supabase/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_TABLE_NOTICE, runPattern } from './run-pattern';

const executeScript = vi.fn();
beforeEach(() => {
  executeScript.mockReset();
  executeScript.mockResolvedValue([{ result: [{ a: '1' }] }]);
  vi.stubGlobal('chrome', { scripting: { executeScript } });
});

const pattern = (config: unknown): ExtractionPattern =>
  ({ kind: 'auto_table', config, fields: [], list_root_selector: null }) as never;

describe('replaying a table saved before table matching', () => {
  it('tells the person it was found by position', async () => {
    const onNotice = vi.fn();
    const rows = await runPattern(pattern({ table_index: 2 }), 1, undefined, onNotice);
    expect(rows).toEqual([{ a: '1' }]);
    expect(onNotice).toHaveBeenCalledWith(LEGACY_TABLE_NOTICE);
  });

  it('stays quiet for a table saved with its signature or a selector', async () => {
    const onNotice = vi.fn();
    await runPattern(
      pattern({ table_index: 0, signature: { headers: ['a'] } }),
      1,
      undefined,
      onNotice,
    );
    await runPattern(pattern({ selector: '#t' }), 1, undefined, onNotice);
    expect(onNotice).not.toHaveBeenCalled();
  });
});
