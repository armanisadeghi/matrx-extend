import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The package bodies need the chat store; the layer's own job (open / close / move) is under test.
vi.mock('@ai-matrx/chat/agents/components/context-policies-display/ContextRulesPanel', () => ({
  ContextRulesPanel: ({ selectedKey }: { selectedKey: string | null }) => <p>{selectedKey}</p>,
}));
vi.mock('@ai-matrx/chat/agents/components/context-policies-display/MessageContextReceipt', () => ({
  MessageContextReceiptView: () => <p>receipt</p>,
}));

import { resetTabLayer, toggleTab } from './canvas-tabs';

const ref = { kind: 'conversation-context', key: 'c1' } as const;
const open = (selected?: string) => ({
  title: 'Values',
  data: { conversationId: 'c1', agentId: null },
  ...(selected !== undefined ? { selected } : {}),
});

describe('the side panel tab layer', () => {
  afterEach(() => resetTabLayer());

  it('a press with no value opens, a second closes', async () => {
    const { ExtensionTabLayer } = await import('./canvas-tabs');
    render(<ExtensionTabLayer />);
    expect(document.querySelector('[data-extension-tab-layer]')).toBeNull();
    act(() => toggleTab(ref, open()));
    expect(document.querySelector('[data-extension-tab-layer]')).not.toBeNull();
    act(() => toggleTab(ref, open()));
    expect(document.querySelector('[data-extension-tab-layer]')).toBeNull();
  });

  it('a value row opens the layer on that value; the same row again closes it; another row moves it', async () => {
    const { ExtensionTabLayer } = await import('./canvas-tabs');
    render(<ExtensionTabLayer />);
    act(() => toggleTab(ref, open('page_brief')));
    expect(document.querySelector('[data-extension-tab-layer]')).not.toBeNull();
    act(() => toggleTab(ref, open('page_meta')));
    expect(document.querySelector('[data-extension-tab-layer]')).not.toBeNull();
    act(() => toggleTab(ref, open('page_meta')));
    expect(document.querySelector('[data-extension-tab-layer]')).toBeNull();
  });
});
