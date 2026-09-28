import { readFrameworkSources } from '@/lib/data-pattern/framework-sources';
import { runMode, runPattern } from '@/lib/data-pattern/run-pattern';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('targets the clicked document for tree and extension-run extraction', async () => {
  // A was replaced by B after click but before injection. Chrome must reject
  // the A-targeted injection rather than letting B data answer A's run.
  const executeScript = vi.fn(async ({ target }: { target: { documentIds?: string[] } }) => {
    if (target.documentIds?.[0] === 'document-a') throw new Error('Document not found');
    return [
      { frameId: 0, result: [{ source: '__NEXT_DATA__', data: { items: [{ title: 'B' }] } }] },
    ];
  });
  vi.stubGlobal('chrome', { scripting: { executeScript } });
  await expect(readFrameworkSources(37, 'document-a')).rejects.toThrow(/Document not found/);
  await expect(
    runMode('next_data', 37, { source: '__NEXT_DATA__', key_path: ['items'] }, 'document-a'),
  ).rejects.toThrow(/Document not found/);
  await expect(readFrameworkSources(37, 'document-b')).resolves.toMatchObject([
    { source: '__NEXT_DATA__' },
  ]);
  await expect(
    runPattern(
      { kind: 'next_data', config: { source: '__NEXT_DATA__', key_path: ['items'] } } as Parameters<
        typeof runPattern
      >[0],
      37,
      'document-b',
    ),
  ).resolves.toEqual([{ title: 'B' }]);
  expect(executeScript.mock.calls.every(([call]) => call.target.documentIds?.length === 1)).toBe(
    true,
  );
});
