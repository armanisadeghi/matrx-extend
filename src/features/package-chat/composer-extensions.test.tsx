import { HighlightAttachmentChip } from '@/features/chat/HighlightAttachmentChip';
import { highlightsContextValue } from '@/lib/chat/attached-context';
import { useGoogleFilesStore } from '@/state/google-files';
import { useHighlightStore } from '@/state/highlights';
/**
 * The extension's registrations on the package chat's composer extensions
 * (`@ai-matrx/chat/host/composer-extensions`): the highlight and Google-file attachment sources and
 * the task-panel companion. Real stores, real package registry — only the highlight DB read is a
 * double. The payload must be the SAME context keys the extension's own send path builds.
 */
import {
  collectAttachmentSourceContext,
  listConversationCompanions,
  resetComposerExtensionsForTests,
} from '@ai-matrx/chat/host/composer-extensions';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerExtensionComposerExtensions } from './composer-extensions';

vi.mock('@/lib/highlights/queries', () => ({
  getHighlightsByIds: async (ids: string[]) =>
    ids.map((id) => ({
      id,
      mode: 'text',
      text: 'Crowns need a two-week lab turnaround',
      url: 'https://harborlightdental.com/lab-policy',
      anchor: { text_quote: { exact: 'Crowns need a two-week lab turnaround' } },
    })),
}));

const CONV = '3b9f1c2e-4d5a-4e6f-8a7b-9c0d1e2f3a4b';

describe('extension composer extensions', () => {
  beforeEach(async () => {
    resetComposerExtensionsForTests();
    useHighlightStore.setState({ attachedIds: [] });
    useGoogleFilesStore.setState({ attachedIds: [] });
  });

  async function register() {
    registerExtensionComposerExtensions();
  }

  it('contributes nothing when nothing is attached', async () => {
    await register();
    expect(await collectAttachmentSourceContext(CONV)).toBeNull();
  });

  it("puts attached highlights and Google files on the turn as the extension's own context keys", async () => {
    await register();
    useHighlightStore.setState({ attachedIds: ['h1'] });
    useGoogleFilesStore.setState({ attachedIds: ['drive-file-7'] });
    const context = await collectAttachmentSourceContext(CONV);
    expect(context?.__google_files).toEqual(['drive-file-7']);
    const highlights = context?.highlights as {
      count: number;
      items: Array<{ id: string; text: string }>;
    };
    expect(highlights.count).toBe(1);
    expect(highlights.items[0]).toMatchObject({
      id: 'h1',
      text: 'Crowns need a two-week lab turnaround',
    });
    // The same builder the extension's send path uses.
    expect(highlights).toEqual(highlightsContextValue(highlights.items as never));
  });

  it('registers the task-panel companion once, even if registration runs twice', async () => {
    await register();
    await register();
    expect(listConversationCompanions().map((c) => c.id)).toEqual(['tasks']);
  });

  it('the highlight chip draws an inline pill in the rail, and nothing when none is attached', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<HighlightAttachmentChip inline />));
    expect(host.innerHTML).toBe('');
    act(() => useHighlightStore.setState({ attachedIds: ['h1', 'h2'] }));
    expect(host.innerHTML).toContain('data-rail-entry');
    expect(host.textContent).toContain('2 highlights');
    act(() => root.unmount());
  });
});
