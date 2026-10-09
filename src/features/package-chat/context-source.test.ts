/**
 * The extension's package-chat context source: the page context the package asks for on every turn.
 * It must return the same keys `buildChatContext` builds, and nothing (not a throw) when the build
 * fails or is empty.
 */
import { describe, expect, it, vi } from 'vitest';

const build = vi.fn();
vi.mock('@/lib/chat/build-context', () => ({ buildChatContext: (...a: unknown[]) => build(...a) }));
vi.mock('@/lib/chat/active-tab', () => ({
  resolveActiveTab: async () => ({ id: 7, url: 'https://harborlightdental.com/lab-policy' }),
}));

import { extensionPageContextSource } from './context-source';

const input = {
  conversationId: '3b9f1c2e-4d5a-4e6f-8a7b-9c0d1e2f3a4b',
  agentId: null,
  phase: 'start' as const,
};

describe('extension page context source', () => {
  it('hands the built page context to the turn', async () => {
    build.mockResolvedValueOnce({
      context: { page_brief: { url: 'https://harborlightdental.com/lab-policy' } },
      rows: [],
      withheld: [],
    });
    const out = await extensionPageContextSource.contribute(input);
    expect(out).toEqual({
      context: { page_brief: { url: 'https://harborlightdental.com/lab-policy' } },
    });
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: input.conversationId }),
    );
  });
  it('contributes nothing when the page gave nothing', async () => {
    build.mockResolvedValueOnce({ context: undefined, rows: [], withheld: [] });
    expect(await extensionPageContextSource.contribute(input)).toBeNull();
  });
  it('a failed build is skipped, not thrown', async () => {
    build.mockRejectedValueOnce(new Error('tab gone'));
    expect(await extensionPageContextSource.contribute(input)).toBeNull();
  });
});
