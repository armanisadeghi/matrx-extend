import { requestContextFromValues } from '@/lib/chat/context';
import { useAuthStore } from '@/state/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureContextRulesReady,
  loadContextRules,
  saveContextRule,
  useContextRulesStore,
} from './context-rules';

const { select, upsert } = vi.hoisted(() => ({ select: vi.fn(), upsert: vi.fn() }));

vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId: async () => '7912bccd-208c-4543-a4cb-2d506a98c468',
  isOrganizationNotSelectedError: () => false,
  isOrganizationNoMembershipsError: () => false,
}));

vi.mock('@/lib/supabase/schemas', () => ({
  usersDb: () => ({
    from: () => ({ select, upsert }),
  }),
}));

beforeEach(() => {
  useAuthStore.getState().setUser(null);
  select.mockReset();
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  select.mockImplementation(() => ({
    eq: () => ({ is: async () => ({ data: [], error: null }) }),
  }));
});

afterEach(() => {
  useAuthStore.getState().setUser(null);
});

describe('owner-only context rules', () => {
  it('does not query the owner table for a fingerprint guest send or chip open', async () => {
    await ensureContextRulesReady();
    await loadContextRules(true);
    expect(select).not.toHaveBeenCalled();
    expect(useContextRulesStore.getState().rows).toEqual({});
  });

  it('drops a previous signed-in person’s rules before a guest send', async () => {
    useAuthStore.getState().setUser({
      id: 'df7e9e94-657e-4d40-9ad8-351621438808',
      email: 'test@test.com',
    });
    await ensureContextRulesReady();
    useContextRulesStore.setState({
      rows: { _default: { page_brief: { include: false } } },
      loaded: true,
    });
    useAuthStore.getState().setUser(null);
    await ensureContextRulesReady();
    expect(useContextRulesStore.getState().rows).toEqual({});
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('keeps a guest rule local through the next send without a database write', async () => {
    await saveContextRule('_default', 'page_brief', { include: false });
    await ensureContextRulesReady();
    const built = requestContextFromValues({
      page_brief: { url: 'https://www.aimatrx.com/matrx-extend-demo', title: 'Matrx Extend' },
      client: { surface: 'chrome-extension-chat' },
    });
    expect(useContextRulesStore.getState().rows).toEqual({
      _default: { page_brief: { include: false } },
    });
    expect(built.context).not.toHaveProperty('page_brief');
    expect(built.withheld).toContain('page_brief');
    expect(built.context).toHaveProperty('client');
    expect(select).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('discards an older owner read that completes after another person signs in', async () => {
    let finishOldRead: (value: unknown) => void = () => {};
    select.mockImplementationOnce(() => ({
      eq: () => ({
        is: () =>
          new Promise((resolve) => {
            finishOldRead = resolve;
          }),
      }),
    }));
    select.mockImplementationOnce(() => ({
      eq: () => ({
        is: async () => ({
          data: [{ surface_key: '_default', state: { page_brief: { include: true } } }],
          error: null,
        }),
      }),
    }));
    useAuthStore.getState().setUser({
      id: 'df7e9e94-657e-4d40-9ad8-351621438808',
      email: 'test@test.com',
    });
    const oldRead = loadContextRules();
    useAuthStore.getState().setUser({
      id: '7cd90a64-d2e5-4f0e-9f9d-495f8dc38668',
      email: 'admin@admin.com',
    });
    await loadContextRules();
    finishOldRead({
      data: [{ surface_key: '_default', state: { page_brief: { include: false } } }],
      error: null,
    });
    await oldRead;
    expect(useContextRulesStore.getState().rows).toEqual({
      _default: { page_brief: { include: true } },
    });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('does not let a prior session of the same person replace a newer session read', async () => {
    let finishOldRead: (value: unknown) => void = () => {};
    select.mockImplementationOnce(() => ({
      eq: () => ({
        is: () =>
          new Promise((resolve) => {
            finishOldRead = resolve;
          }),
      }),
    }));
    select.mockImplementationOnce(() => ({
      eq: () => ({
        is: async () => ({
          data: [{ surface_key: '_default', state: { page_brief: { include: true } } }],
          error: null,
        }),
      }),
    }));
    const personA = { id: 'df7e9e94-657e-4d40-9ad8-351621438808', email: 'test@test.com' };
    useAuthStore.getState().setUser(personA);
    const oldRead = loadContextRules();
    useAuthStore.getState().setUser(null);
    useAuthStore.getState().setUser(personA);
    await loadContextRules();
    finishOldRead({
      data: [{ surface_key: '_default', state: { page_brief: { include: false } } }],
      error: null,
    });
    await oldRead;
    expect(useContextRulesStore.getState().rows).toEqual({
      _default: { page_brief: { include: true } },
    });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('does not carry an old owner’s queued rule write into a new account', async () => {
    useAuthStore.getState().setUser({
      id: 'df7e9e94-657e-4d40-9ad8-351621438808',
      email: 'test@test.com',
    });
    const oldWrite = saveContextRule('_default', 'page_brief', { include: false });
    useAuthStore.getState().setUser({
      id: '7cd90a64-d2e5-4f0e-9f9d-495f8dc38668',
      email: 'admin@admin.com',
    });
    await oldWrite;
    expect(upsert).not.toHaveBeenCalled();
    expect(useContextRulesStore.getState().rows).toEqual({});
  });
});
