import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
        select: () => ({ eq: () => ({ is: select }) }),
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
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({
    id: 7,
    url: 'https://example.com/pricing',
    title: 'Pricing',
    documentId: 'd1',
    identityStatus: 'ready',
    identityError: null,
    pageKey: 'k1',
  }),
}));
vi.mock('@/lib/chat/active-tab', () => ({ resolveActiveTab: vi.fn(async () => null) }));

import { buildChatContextValues } from '@/lib/chat/context';
import { ContextRulesComposerChip } from '@/features/chat/ContextRulesComposerChip';
import { useAuthStore } from '@/state/auth';
import { useChatStore } from '@/state/chat';
import {
  ensureContextRulesReady,
  saveContextRule,
  useContextRulesStore,
} from '@/state/context-rules';
import { usePilotChatStore } from '@/state/pilot-chat';
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
        deleted_at: null,
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
    usePilotChatStore.setState({ selectedConversationId: 'pilot-1' } as never);
    useContextRulesStore.setState({
      rows: {},
      previewSourcesByComposer: {},
      lastSentRowsByComposer: { chat: [PAGE_ROW] },
      receiptByConversation: {},
    });
  });

  it('shows the values the last send carried', () => {
    render(<ContextRulesComposerChip composer="chat" />);
    const face = screen.getByRole('button', { name: '1 included' });
    // The compact face counts included values; sizes are in the popover table.
    expect(face.textContent).toBe('1');
    expect(face.getAttribute('data-mismatch')).toBeNull();
  });

  it('counts the page it is on before the chip is ever opened or anything is sent', async () => {
    // The break (2026-10-09): the face read 0 on every web page until the chip was opened.
    vi.mocked(buildChatContextValues).mockResolvedValueOnce({
      page_brief: { title: 'Pricing' },
      tab_state: { id: 7 },
    });
    useContextRulesStore.setState({
      lastSentRowsByComposer: {},
      previewSourcesByComposer: {},
      loaded: true,
    });
    useAuthStore.setState({ user: { id: 'user-1' } } as never);
    render(<ContextRulesComposerChip composer="chat" />);
    expect(await screen.findByRole('button', { name: '2 included' })).toBeTruthy();
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
    render(<ContextRulesComposerChip composer="chat" />);
    expect(screen.getByRole('button', { name: '1 included' }).getAttribute('data-mismatch')).toBe(
      'true',
    );
  });

  it("Pilot shows its own last send and its own receipt, never the Assistant chat's", () => {
    useContextRulesStore.setState({
      lastSentRowsByComposer: {
        chat: [PAGE_ROW],
        pilot: [PAGE_ROW, { ...PAGE_ROW, key: 'page_brief' }],
      },
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
    render(<ContextRulesComposerChip composer="pilot" />);
    const face = screen.getByRole('button', { name: '2 included' });
    expect(face.textContent).toBe('2');
    expect(face.getAttribute('data-mismatch')).toBeNull();
    cleanup();
    useContextRulesStore.setState((st) => ({
      receiptByConversation: {
        ...st.receiptByConversation,
        'pilot-1': st.receiptByConversation['conv-1']!,
      },
    }));
    render(<ContextRulesComposerChip composer="pilot" />);
    expect(screen.getByRole('button', { name: '2 included' }).getAttribute('data-mismatch')).toBe(
      'true',
    );
  });

  it('shows the values the server added (attachments, scope seeds) as their own rows', () => {
    useContextRulesStore.setState({
      receiptByConversation: {
        'conv-1': {
          receipt: {
            version: 1,
            surface: null,
            cap: 50000,
            model_reads_context: true,
            rules_error: null,
            rows: [
              {
                key: 'page_full_content',
                label: 'Page content',
                surface_key: '_default',
                origin: 'client',
                chars: 48000,
                include: true,
                max_inline_chars: 200,
                delivery: 'on_request',
                decided_by: { include: 'default', max_inline_chars: 'default' },
                user_rule: null,
                clamped: false,
                client_sent_excluded: false,
                blocked_by: null,
              },
              {
                key: 'project_brief',
                label: 'Project brief',
                surface_key: '_default',
                origin: 'server',
                chars: 900,
                include: true,
                max_inline_chars: 200,
                delivery: 'on_request',
                decided_by: { include: 'default', max_inline_chars: 'default' },
                user_rule: null,
                clamped: false,
                client_sent_excluded: false,
                blocked_by: null,
              },
            ],
          },
          mismatches: [],
          receivedAt: 1,
        },
      },
    });
    render(<ContextRulesComposerChip composer="chat" />);
    expect(screen.getByRole('button', { name: '2 included' }).textContent).toBe('2');
  });

  it('counts the Organization catalog block in a server-added Organization row', () => {
    useContextRulesStore.setState({
      lastSentRowsByComposer: { chat: [] },
      receiptByConversation: {
        'conv-1': {
          receipt: {
            version: 1,
            surface: null,
            cap: 50000,
            model_reads_context: true,
            rules_error: null,
            rows: [
              {
                key: 'organization',
                label: 'Organization',
                surface_key: '_default',
                origin: 'server',
                chars: 20,
                include: true,
                max_inline_chars: 200,
                delivery: 'inline',
                decided_by: { include: 'default', max_inline_chars: 'default' },
                user_rule: null,
                clamped: false,
                client_sent_excluded: false,
                blocked_by: null,
                delivered: { chars: 20, sha256: 'a'.repeat(64) },
              },
            ],
            blocks: [
              {
                id: 'organization_catalog',
                label: 'Organization catalog',
                delivered: { chars: 80, sha256: 'b'.repeat(64) },
              },
            ],
          },
          mismatches: [],
          receivedAt: 1,
        },
      },
    });
    render(<ContextRulesComposerChip composer="chat" />);
    fireEvent.click(screen.getByRole('button', { name: '1 included' }));
    const row = screen.getByRole('row', { name: /Organization/ });
    expect(within(row).getByText('100')).toBeTruthy();
  });
});
