import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFrameworkSources } from '@/lib/data-pattern/framework-sources';
import { runMode, runPattern } from '@/lib/data-pattern/run-pattern';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Public page capture, 2026-09-28: https://nuxt.com/docs/4.x/getting-started/introduction
// Its serialized slot 7 has repo:10, and slot 10 contains "nuxt/nuxt".
const nuxtPayload = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/showcase-nuxt-introduction-20260928.json'),
  'utf8',
);

function setScript(id: string, text: string): void {
  const script = document.createElement('script');
  script.id = id;
  script.type = 'application/json';
  script.textContent = text;
  document.body.append(script);
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('chrome', {
    scripting: {
      executeScript: vi.fn(
        async ({
          func,
          args,
        }: {
          func: (...values: unknown[]) => unknown;
          args?: unknown[];
        }) => [{ frameId: 0, result: func(...(args ?? [])) }],
      ),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('Nuxt Framework source decoding', () => {
  it('resolves captured Nuxt references in the tree, preview, and saved replay', async () => {
    setScript('__NUXT_DATA__', nuxtPayload);
    const sources = await readFrameworkSources(37);
    const root = sources.find((source) => source.source === '__NUXT_DATA__')?.data as {
      state: { $sstats: { repo: string; description: string } };
    };
    expect(root.state.$sstats.repo).toBe('nuxt/nuxt');
    expect(root.state.$sstats.description).toBe('The full-stack Vue framework.');

    const config = { source: '__NUXT_DATA__', key_path: ['state', '$sstats', 'repo'] };
    await expect(runMode('next_data', 37, config)).resolves.toEqual([{ value: 'nuxt/nuxt' }]);
    await expect(
      runPattern({ kind: 'next_data', config } as Parameters<typeof runPattern>[0], 37),
    ).resolves.toEqual([{ value: 'nuxt/nuxt' }]);
  });

  it('follows a different devalue reference rather than returning a fixed value', async () => {
    // Exact devalue stringify example from https://github.com/sveltejs/devalue#stringify-and-parse
    setScript('__NUXT_DATA__', '[{"message":1},"hello"]');
    await expect(
      runMode('next_data', 37, {
        source: '__NUXT_DATA__',
        key_path: ['message'],
      }),
    ).resolves.toEqual([{ value: 'hello' }]);
  });

  it('refuses a saved path into old serialized slots rather than returning no rows', async () => {
    setScript('__NUXT_DATA__', nuxtPayload);
    await expect(
      runPattern(
        {
          kind: 'next_data',
          config: { source: '__NUXT_DATA__', key_path: ['7', 'repo'] },
        } as Parameters<typeof runPattern>[0],
        37,
      ),
    ).rejects.toThrow(/choose a field in the decoded tree/);
  });

  it('reports an unsupported Nuxt custom type instead of raw indexes', async () => {
    setScript('__NUXT_DATA__', '[["SiteSpecificWidget",1],{"title":2},"News"]');
    await expect(readFrameworkSources(37)).rejects.toThrow(/Nuxt page data could not be decoded/);
  });
});
