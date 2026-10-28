/**
 * "Act without asking" is ONE setting (Arman, 2026-10-22): the extension's chips (chat header,
 * Pilot, Settings › Default mode) and the package chat's composer switch read and write the SAME
 * platform knob the web chat and the server use — `chat.act_without_asking`, the person's rung in
 * the active organization. Unanswered = Act (the platform default).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const knob = { value: undefined as unknown };
const identity = { userId: 'person-1' as string | null, organizationId: 'org-1' as string | null };
let writeFailure = false;
const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
  if (writeFailure) return { data: null, error: { message: 'write refused' } };
  knob.value = args.p_value;
  return { data: { ok: true }, error: null };
});
vi.mock('@/lib/settings/platform-knobs', () => ({
  peekPlatformKnob: (k: string) => (k === 'chat.act_without_asking' ? knob.value : undefined),
  platformKnobsVersion: () => 0,
  resolvePlatformKnob: async () => undefined,
  subscribePlatformKnobs: () => () => undefined,
  warmPlatformKnobs: async () => undefined,
}));
vi.mock('@/lib/settings/platform-knob-snapshot', () => ({
  invalidateKnobSnapshot: () => undefined,
  resolvePlatformKnobInWorker: async (k: string) =>
    k === 'chat.act_without_asking' ? knob.value : undefined,
}));
vi.mock('@/lib/supabase/schemas', () => ({ platformDb: () => ({ schema: () => ({ rpc }) }) }));
vi.mock('@/hooks/use-request-organization', () => ({
  ensureRequestOrganizationId: async () => identity.organizationId,
}));
vi.mock('@/state/auth', () => ({
  useAuthStore: { getState: () => ({ user: identity.userId ? { id: identity.userId } : null }) },
}));

import { extensionKnobs } from '@/features/package-chat/knobs';
import {
  carryOverExplicitAsk,
  readActMode,
  readActModeInWorker,
  writeActMode,
} from './act-without-asking';

beforeEach(() => {
  knob.value = undefined;
  identity.userId = 'person-1';
  identity.organizationId = 'org-1';
  writeFailure = false;
  rpc.mockClear();
});

describe('act without asking — one setting', () => {
  it('unanswered is Act, in the panel and in the service worker', async () => {
    expect(readActMode()).toBe('act');
    expect(await readActModeInWorker()).toBe('act');
  });

  it("the extension's chip writes the person's rung of chat.act_without_asking", async () => {
    await writeActMode('ask');
    expect(rpc).toHaveBeenCalledWith(
      'knob_override_set',
      expect.objectContaining({
        p_feature: 'chat',
        p_key: 'act_without_asking',
        p_scope_kind: 'user',
        p_scope_id: 'person-1',
        p_organization_id: 'org-1',
        p_value: false,
        p_note: expect.any(String),
      }),
    );
    expect(await readActModeInWorker()).toBe('ask');
  });

  it("the package chat's composer switch writes the SAME knob through the same door", async () => {
    const result = await extensionKnobs.setOverride({
      feature: 'chat',
      key: 'act_without_asking',
      scopeKind: 'user',
      scopeId: 'person-1',
      organizationId: 'org-1',
      value: true,
    });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith(
      'knob_override_set',
      expect.objectContaining({ p_feature: 'chat', p_key: 'act_without_asking', p_value: true }),
    );
    expect(readActMode()).toBe('act');
  });

  it('a value the web wrote is what the extension reads', () => {
    knob.value = false;
    expect(extensionKnobs.peekSession('chat.act_without_asking')).toBe(false);
  });

  it('refuses a guest choice and restores the effective mode for subscribers', async () => {
    identity.userId = null;
    knob.value = true;
    const observed: string[] = [];
    const { subscribeActMode } = await import('./act-without-asking');
    const unsubscribe = subscribeActMode(() => observed.push(readActMode()));
    try {
      const result = await writeActMode('ask');
      expect(result).toEqual({ ok: false, detail: 'not signed in' });
      expect(observed).toEqual(['ask', 'act']);
      expect(readActMode()).toBe('act');
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('restores the effective mode when an organization or the real write refuses', async () => {
    knob.value = true;
    identity.organizationId = null;
    expect((await writeActMode('ask')).ok).toBe(false);
    expect(readActMode()).toBe('act');
    expect(rpc).not.toHaveBeenCalled();

    identity.organizationId = 'org-1';
    writeFailure = true;
    expect((await writeActMode('ask')).ok).toBe(false);
    expect(readActMode()).toBe('act');
    expect(rpc).toHaveBeenCalledOnce();
  });
});

it.each(['matrx.chat.v1', 'matrx.pilot-chat.v1'])(
  'retains explicit Ask in %s when guest carry-over is refused',
  async (key) => {
    await chrome.storage.local.remove([
      'matrx.chat.v1',
      'matrx.pilot-chat.v1',
      'matrx.act-without-asking.carried-over.v1',
    ]);
    const value = JSON.stringify({ state: { permissionMode: { browserAgent: 'ask' } } });
    await chrome.storage.local.set({ [key]: value });
    identity.userId = null;
    expect(await carryOverExplicitAsk()).toBe(false);
    const saved = await chrome.storage.local.get([key, 'matrx.act-without-asking.carried-over.v1']);
    expect(saved[key]).toBe(value);
    expect(saved).not.toHaveProperty('matrx.act-without-asking.carried-over.v1');
  },
);
