import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { upsert, select, requireActiveOrganizationId } = vi.hoisted(() => ({
  upsert: vi.fn(),
  select: vi.fn(),
  requireActiveOrganizationId: vi.fn(),
}));

vi.mock('@/lib/supabase/schemas', () => ({
  usersDb: () => ({
    from: (table: string) => {
      if (table !== 'user_surface_state') throw new Error(`unexpected table ${table}`);
      return {
        upsert,
        select: () => ({ eq: select }),
      };
    },
  }),
}));
vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId,
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
  getActiveOrganizationId: vi.fn(),
}));
vi.mock('@/hooks/use-chat-stream', () => ({
  resolveAttachedHighlights: vi.fn(async () => null),
  resolveAttachedGoogleFileIds: () => null,
}));
vi.mock('@/lib/chat/context', () => ({ buildChatContextValues: vi.fn(async () => ({})) }));

import { ContextRulesComposerChip } from '@/features/chat/ContextRulesComposerChip';
import { useAuthStore } from '@/state/auth';
import { useChatStore } from '@/state/chat';
import {
  ensureContextRulesReady,
  saveContextRule,
  useContextRulesStore,
} from '@/state/context-rules';
import { resolveContextRow } from '@ai-matrx/agents/context';

const PAGE_ROW = resolveContextRow(
  {
    key: 'page_full_content',
    label: 'Page content',
    surfaceKey: '_default',
    origin: 'page',
    value: undefined,
    chars: 48000,
  },
  null,
);

describe('context rules: the person’s one home', () => {
  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({ error: null });
    select.mockReset().mockResolvedValue({ data: [], error: null });
    requireActiveOrganizationId.mockReset().mockResolvedValue('org-1');
    useAuthStore.setState({ user: { id: 'user-1' } } as never);
    useContextRulesStore.setState({ rows: {}, loaded: true, loadFailed: false });
  });

  it('writes the rule at once, with the organization, upserting the one row', async () => {
    await saveContextRule('_default', 'page_full_content', { include: false });
    await ensureContextRulesReady();
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        organization_id: 'org-1',
        feature: 'context_rules',
        surface_key: '_default',
        state: { page_full_content: { include: false } },
      },
      { onConflict: 'user_id,feature,surface_key' },
    );
    expect(useContextRulesStore.getState().rows._default).toEqual({
      page_full_content: { include: false },
    });
  });

  it('the last of two quick changes is the one saved', async () => {
    const a = saveContextRule('_default', 'page_full_content', { include: false });
    const b = saveContextRule('_default', 'page_full_content', { max_inline_chars: 9000 });
    await Promise.all([a, b]);
    expect(upsert.mock.calls.at(-1)?.[0].state).toEqual({
      page_full_content: { max_inline_chars: 9000 },
    });
  });

  it('a failed write reloads what is saved', async () => {
    upsert.mockResolvedValueOnce({ error: { message: 'denied', code: '42501' } });
    select.mockResolvedValueOnce({ data: [], error: null });
    await saveContextRule('_default', 'page_full_content', { include: false });
    expect(select).toHaveBeenCalled();
    expect(useContextRulesStore.getState().rows).toEqual({});
  });
});

describe('ContextRulesComposerChip', () => {
  afterEach(cleanup);
  beforeEach(() => {
    useAuthStore.setState({ user: null } as never);
    useChatStore.setState({ selectedConversationId: 'conv-1' } as never);
    useContextRulesStore.setState({
      rows: {},
      previewSources: null,
      lastSentRows: [PAGE_ROW],
      receiptByConversation: {},
    });
  });

  it('shows the values the last send carried', () => {
    render(<ContextRulesComposerChip />);
    const face = screen.getByRole('button', { name: 'Context: Context' });
    // The face: label + how many values ride (sizes are in the popover table).
    expect(face.textContent).toBe('Context1');
    expect(face.getAttribute('data-mismatch')).toBeNull();
  });

  it('turns amber when the receipt disagrees with what was sent', () => {
    useContextRulesStore.setState({
      receiptByConversation: {
        'conv-1': {
          receipt: {
            version: 1,
            surface: null,
            cap: 50000,
            model_reads_context: true,
            rules_error: null,
            rows: [],
          },
          mismatches: [
            { key: 'page_full_content', field: 'missing', expected: true, actual: null },
          ],
          receivedAt: 1,
        },
      },
    });
    render(<ContextRulesComposerChip />);
    expect(
      screen.getByRole('button', { name: 'Context: Context' }).getAttribute('data-mismatch'),
    ).toBe('true');
  });
});
