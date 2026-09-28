import { JsonTree } from '@/components/ui/json-tree';
import { rowsFromBody } from '@/lib/data-pattern/run-interactive';
import { runMode, runPattern } from '@/lib/data-pattern/run-pattern';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A publisher extracts articles from API responses and embedded framework state.
const payload = {
  'feeds.news': [{ title: 'Literal edition' }],
  feeds: { news: [{ title: 'Nested edition' }] },
  '["literal"]': [{ title: 'Bracket-key edition' }],
  literal: [{ title: 'Other edition' }],
  groups: [{ 'a.b': [{ title: 'Indexed edition' }] }],
  '': [{ title: 'Empty-key edition' }],
  odd: { '': { path: [{ title: 'Double-dot edition' }] } },
};

async function pickTreePath(label: string): Promise<string[]> {
  let selected: string[] | undefined;
  render(
    <JsonTree
      data={payload}
      defaultDepth={4}
      onSelectPath={(path) => {
        selected = path;
      }}
    />,
  );
  const text =
    screen.queryByText(label) ??
    (label === '["feeds.news"]' ? screen.getAllByText('feeds.news')[0] : null);
  const button = text?.closest('button');
  if (!button) throw new Error(`Missing selectable JSON node ${label}`);
  await userEvent.setup().click(button);
  cleanup();
  if (!selected) throw new Error(`JSON node ${label} did not select a path`);
  return selected;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Showcase JSON key paths', () => {
  it('keeps exact segments distinct through tree selection and Network extraction', async () => {
    const selections = [
      { label: '["feeds.news"]', path: ['feeds.news'], title: 'Literal edition' },
      { label: 'feeds.news', path: ['feeds', 'news'], title: 'Nested edition' },
      { label: '["[\\"literal\\"]"]', path: ['["literal"]'], title: 'Bracket-key edition' },
      { label: 'groups.0["a.b"]', path: ['groups', '0', 'a.b'], title: 'Indexed edition' },
      { label: '[""]', path: [''], title: 'Empty-key edition' },
    ];
    for (const { label, path, title } of selections) {
      const selected = await pickTreePath(label);
      expect(rowsFromBody(JSON.stringify(payload), selected)).toEqual([{ title }]);
      expect(selected).toEqual(path);
    }
  });

  it('uses exact paths in Framework preview and saved-pattern replay', async () => {
    const literal = await pickTreePath('["feeds.news"]');
    const nested = await pickTreePath('feeds.news');
    const script = document.createElement('script');
    script.id = '__NEXT_DATA__';
    script.type = 'application/json';
    script.textContent = JSON.stringify(payload);
    document.body.append(script);
    Object.assign(chrome, {
      scripting: {
        executeScript: vi.fn(
          async ({ func, args }: { func: (config: unknown) => unknown; args?: unknown[] }) => [
            { frameId: 0, result: func(args?.[0]) },
          ],
        ),
      },
    });

    const config = { source: '__NEXT_DATA__', key_path: literal };
    await expect(runMode('next_data', 37, config, 'document-a')).resolves.toEqual([
      { title: 'Literal edition' },
    ]);
    await expect(
      runMode('next_data', 37, { source: '__NEXT_DATA__', key_path: nested }, 'document-a'),
    ).resolves.toEqual([{ title: 'Nested edition' }]);
    await expect(
      runPattern(
        { kind: 'next_data', config } as Parameters<typeof runPattern>[0],
        37,
        'document-a',
      ),
    ).resolves.toEqual([{ title: 'Literal edition' }]);
    await expect(
      runMode('next_data', 37, { source: '__NEXT_DATA__', key_path: 'odd..path' }, 'document-a'),
    ).resolves.toEqual([{ title: 'Double-dot edition' }]);
    await expect(
      runMode('next_data', 37, { source: '__NEXT_DATA__', key_path: '' }, 'document-a'),
    ).resolves.toEqual([payload]);
    await expect(
      runMode('next_data', 37, { source: '__NEXT_DATA__', key_path: '["literal"]' }, 'document-a'),
    ).resolves.toEqual([{ title: 'Bracket-key edition' }]);
  });

  it('preserves the meaning of old dotted strings and bracket-looking literal keys', () => {
    const body = JSON.stringify(payload);
    expect(rowsFromBody(body, 'feeds.news')).toEqual([{ title: 'Nested edition' }]);
    expect(rowsFromBody(body, '["literal"]')).toEqual([{ title: 'Bracket-key edition' }]);
    expect(rowsFromBody(body, ['literal'])).toEqual([{ title: 'Other edition' }]);
    expect(rowsFromBody(body, '')).toEqual([payload]);
  });
});
