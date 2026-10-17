import { beforeEach, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  token: null as string | null,
  fingerprint: 'guest-browser-signature' as string,
}));
vi.mock('@/lib/auth/guest-signature', () => ({
  getOrCreateGuestSignature: async () => session.fingerprint,
}));
vi.mock('@/lib/auth/flow', () => ({
  getStoredAccessToken: async () => session.token,
  getAccessToken: async () => session.token,
  getCurrentUser: async () => null,
  describeStoredSession: async () => ({}),
}));
vi.mock('@/lib/api/client', () => ({
  getApiBaseUrl: async () => 'https://server.app.matrxserver.com',
  buildHeaders: async () => ({}),
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => null,
  listMemberOrganizations: async () => [],
  requireActiveOrganizationId: async () => {
    throw new Error('No active organization');
  },
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ rpc: vi.fn(), from: vi.fn() }) }));
vi.mock('@/lib/audio/mic-grant', () => ({ requestMicrophoneGrant: vi.fn() }));
vi.mock('@/lib/messaging/native', () => ({ send: vi.fn() }));
vi.mock('./browser-dom-source', () => ({
  browserDomContextSource: {},
  isBrowserDeviceRef: () => false,
}));
vi.mock('./context-source', () => ({ extensionPageContextSource: {} }));
vi.mock('./composer-extensions', () => ({ registerExtensionComposerExtensions: vi.fn() }));
vi.mock('./tool-renderers', () => ({ registerExtensionToolRenderers: vi.fn() }));
vi.mock('./knobs', () => ({ extensionKnobs: {} }));
vi.mock('./ai-watch-opener', () => ({ createAiWatchWindowOpener: vi.fn() }));

import { createInstanceFull } from '@ai-matrx/chat/agents/redux/execution-system/create-instance-full';
import {
  ensureExecutionOrganization,
  executionOrganizationForRequest,
} from '@ai-matrx/chat/agents/redux/execution-system/utils/required-organization';
import { SIGNED_OUT_IDENTITY } from '@ai-matrx/chat/host';
import { configureChat } from '@ai-matrx/chat/host/configure';
import { syncChatHostIfUnsynced } from '@ai-matrx/chat/store/chat-host-sync';
import { createChatStore } from '@ai-matrx/chat/store/create-chat-store';
import { createExtensionChatHost } from './host';
import { createExtensionChatIdentity } from './identity';

const conversationId = '3b9f1c2e-4d5a-4e6f-8a7b-9c0d1e2f3a4b';
beforeEach(() => {
  session.token = null;
  session.fingerprint = 'guest-browser-signature';
});

// A signed-out extension visitor asks Chat about the page they are reading.
// Break caught: the package must receive the SAME guest identity as the extension transport.
it('lets the extension guest through the real package organization gate', async () => {
  const host = configureChat(await createExtensionChatHost());
  await host.identity.getAccessToken();
  const store = createChatStore();
  syncChatHostIfUnsynced(store, host);
  store.dispatch(
    createInstanceFull({
      conversationId,
      agentId: 'guest-page-agent',
      agentType: 'builtin',
      origin: 'manual',
    }),
  );
  await ensureExecutionOrganization(store.getState(), conversationId);
  expect(() => executionOrganizationForRequest(store.getState(), conversationId)).not.toThrow();
  expect(executionOrganizationForRequest(store.getState(), conversationId)).toBeUndefined();
});

it('still refuses a signed-in member without an organization', async () => {
  session.token = `header.${btoa(JSON.stringify({ sub: 'a29f6d10-f38c-4c14-a222-b782936ee875', user_metadata: {} }))}.signature`;
  const host = configureChat(await createExtensionChatHost());
  const store = createChatStore();
  syncChatHostIfUnsynced(store, host);
  store.dispatch(
    createInstanceFull({
      conversationId,
      agentId: 'guest-page-agent',
      agentType: 'builtin',
      origin: 'manual',
    }),
  );
  await ensureExecutionOrganization(store.getState(), conversationId);
  expect(() => executionOrganizationForRequest(store.getState(), conversationId)).toThrow(
    'Select an organization',
  );
  expect(host.identity.current().fingerprintId).toBeNull();
});

it('does not exempt an anonymous session without its guest fingerprint', async () => {
  session.fingerprint = '';
  const host = configureChat(await createExtensionChatHost());
  const store = createChatStore();
  syncChatHostIfUnsynced(store, host);
  store.dispatch(
    createInstanceFull({
      conversationId,
      agentId: 'guest-page-agent',
      agentType: 'builtin',
      origin: 'manual',
    }),
  );
  await ensureExecutionOrganization(store.getState(), conversationId);
  expect(() => executionOrganizationForRequest(store.getState(), conversationId)).toThrow(
    'Select an organization',
  );
});

it('refreshes guest to member and back without carrying a guest fingerprint into a member', async () => {
  const host = configureChat(await createExtensionChatHost());
  const notify = vi.fn();
  host.identity.subscribe(notify);
  session.token = `header.${btoa(JSON.stringify({ sub: 'a29f6d10-f38c-4c14-a222-b782936ee875', user_metadata: {} }))}.signature`;
  expect(await host.identity.getAccessToken()).toBe(session.token);
  expect(host.identity.current().isAuthenticated).toBe(true);
  expect(host.identity.current().fingerprintId).toBeNull();
  session.token = null;
  expect(await host.identity.getAccessToken()).toBeNull();
  expect(host.identity.current().isAuthenticated).toBe(false);
  expect(host.identity.current().fingerprintId).toBe(session.fingerprint);
  expect(notify).toHaveBeenCalledTimes(2);
});

it('invalidates stale guest readiness when token and identity reads race', async () => {
  const base = {
    current: () => ({ ...SIGNED_OUT_IDENTITY, authReady: true }),
    subscribe: () => () => {},
    getAccessToken: async () => null,
  };
  const identity = await createExtensionChatIdentity(base, vi.fn());
  session.token = 'a-member-session-that-arrived-during-refresh';
  await expect(identity.getAccessToken()).rejects.toThrow('Chat session changed');
  expect(identity.current().authReady).toBe(false);
  expect(identity.current().accessToken).toBeNull();
  expect(identity.current().fingerprintId).toBeNull();
});

it('releases storage and base subscriptions when the last Chat subscriber leaves', async () => {
  const stop = vi.fn();
  const base = {
    current: () => ({ ...SIGNED_OUT_IDENTITY, authReady: true }),
    subscribe: vi.fn(() => stop),
    getAccessToken: async () => null,
  };
  const add = vi.spyOn(chrome.storage.onChanged, 'addListener');
  const remove = vi.spyOn(chrome.storage.onChanged, 'removeListener');
  const identity = await createExtensionChatIdentity(base, vi.fn());
  const first = identity.subscribe(vi.fn());
  const second = identity.subscribe(vi.fn());
  expect(base.subscribe).toHaveBeenCalledTimes(1);
  first();
  expect(stop).not.toHaveBeenCalled();
  second();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith(add.mock.calls[0]?.[0]);
  add.mockRestore();
  remove.mockRestore();
});
