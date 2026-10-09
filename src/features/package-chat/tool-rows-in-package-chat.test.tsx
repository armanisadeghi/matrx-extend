/**
 * The extension's browser-tool rows in the package chat: drawn by the package's one config-driven row,
 * through the package's renderer registry, from THIS extension's row configs (the same text the
 * extension's own chat shows). An unregistered tool keeps no tuned row.
 */
import { toolDisplayRegistry } from '@/features/chat/tool-display/registry';
import { CONFIGURED_ROW_NAMES } from '@/features/chat/tool-display/row-names';
import type { ToolLifecycleEntry } from '@ai-matrx/chat/agents/types/request.types';
import {
  getToolChrome,
  hasCustomRenderer,
  toolRendererRegistry,
} from '@ai-matrx/chat/tool-call-visualization/registry/registry';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerExtensionToolRenderers } from './tool-renderers';

const entry = (over: Partial<ToolLifecycleEntry>): ToolLifecycleEntry =>
  ({
    callId: 'call-1',
    toolName: 'read_page',
    displayName: 'read_page',
    status: 'completed',
    arguments: {},
    startedAt: '2026-10-08T10:00:00.000Z',
    completedAt: '2026-10-08T10:00:02.000Z',
    latestMessage: null,
    latestData: null,
    result: null,
    resultPreview: null,
    errorType: null,
    errorMessage: null,
    isDelegated: false,
    events: [],
    ...over,
  }) as ToolLifecycleEntry;

async function draw(e: ToolLifecycleEntry): Promise<string> {
  const Inline = toolRendererRegistry[e.toolName]!.InlineComponent;
  let text = '';
  await act(async () => {
    const view = render(<Inline entry={e} />);
    // The row, and the extension's configs, load the first time a call is drawn.
    for (let i = 0; i < 150 && !(view.container.textContent ?? '').trim(); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    text = view.container.textContent ?? '';
  });
  cleanup();
  return text;
}

afterEach(cleanup);

describe("the extension's browser-tool rows in the package chat", () => {
  registerExtensionToolRenderers();

  it('registers a row for every configured tool, bare and executor-prefixed', () => {
    const plain = Object.keys(toolDisplayRegistry).filter((k) => !toolDisplayRegistry[k]?.CustomComponent);
    expect([...CONFIGURED_ROW_NAMES].sort()).toEqual(plain.sort());
    for (const name of CONFIGURED_ROW_NAMES) {
      expect(hasCustomRenderer(name)).toBe(true);
      expect(hasCustomRenderer(`matrx-extend:${name}`)).toBe(true);
      expect(getToolChrome(name)).toBe('row');
    }
  });

  it('REPORT', { timeout: 120000 }, async () => {
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ['read_page', {}, { title: 'x' }],
      ['navigate', { action: 'goto', url: 'https://example.com' }, {}],
      ['computer', { action: 'left_click', coordinate: [1, 2] }, {}],
      ['tabs', { action: 'list' }, {}],
      ['history', { action: 'search', query: 'invoices' }, {}],
      ['ctx_get', { key: 'page_brief' }, { label: 'L', content: 'C' }],
    ];
    for (const [toolName, args, result] of cases) {
      const t = await draw(entry({ toolName, arguments: args, result }));
      console.log('ROW', toolName, '=>', JSON.stringify(t));
    }
  });
});
