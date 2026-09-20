import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({
  getPrivateExpectedActor: vi.fn(),
  parseStrictPrivateJson: (source: string) => {
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  },
}));
vi.mock('@/lib/api/routes/local-browser', () => ({
  acknowledgeLocalBrowser: vi.fn(),
  verifyLocalBrowser: vi.fn(),
}));
vi.mock('@/lib/desktop/ws-client', () => ({
  getLocalBrowserSocketEpoch: vi.fn(),
  onLocalBrowserEpochInvalidated: vi.fn(),
  onLocalBrowserLifecycle: vi.fn(),
  sendLocalBrowserLifecycle: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({ on: vi.fn() }));
vi.mock('@/lib/org/active-org', () => ({ onActiveOrganizationChange: vi.fn() }));

import { LocalBrowserController, type LocalBrowserControllerDeps } from './controller';

const ids = {
  boot: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  connection: '00000000-0000-4000-8000-000000000003',
  call: '00000000-0000-4000-8000-000000000004',
  user: '00000000-0000-4000-8000-000000000005',
  org: '00000000-0000-4000-8000-000000000006',
  app: '00000000-0000-4000-8000-000000000007',
  run: '00000000-0000-4000-8000-000000000008',
  profile: '00000000-0000-4000-8000-000000000009',
  jti: '00000000-0000-4000-8000-000000000010',
  challenge: '00000000-0000-4000-8000-000000000011',
  admission: '00000000-0000-4000-8000-000000000012',
};
const actor = { userId: ids.user, organizationId: ids.org, sessionId: 'session' };
const stopId = '00000000-0000-4000-8000-000000000015';

function opaqueAdmitGrant(extensionGeneration: string, connectionId: string): string {
  const payload = {
    v: 1,
    aud: 'browser-local-executor',
    sub: ids.user,
    organization_id: ids.org,
    app_instance_id: ids.app,
    run_id: ids.run,
    profile_id: ids.profile,
    jti: ids.jti,
    iat: 1,
    exp: Math.floor(Date.now() / 1000) + 30,
    iss: 'https://server.example',
    tier_policy: 'none',
    scopes: [],
    operation: 'admit',
    challenge_id: ids.challenge,
    admission_id: ids.admission,
    extension_generation: extensionGeneration,
    connection_id: connectionId,
    controller_revision: 0,
  };
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

function opaqueCleanupGrant(extensionGeneration: string, connectionId: string): string {
  const payload = {
    v: 1,
    aud: 'browser-local-executor',
    sub: ids.user,
    organization_id: ids.org,
    app_instance_id: ids.app,
    run_id: ids.run,
    profile_id: ids.profile,
    jti: ids.jti,
    iat: 1,
    exp: Math.floor(Date.now() / 1000) + 30,
    iss: 'https://server.example',
    tier_policy: 'none',
    scopes: [],
    operation: 'cleanup',
    admission_id: ids.admission,
    stop_id: stopId,
    extension_generation: extensionGeneration,
    connection_id: connectionId,
    controller_revision: 0,
  };
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

function harness() {
  let lifecycle: ((payload: unknown, socketEpoch: string) => void) | null = null;
  let invalidated: (() => void) | null = null;
  const sent: unknown[] = [];
  const create = vi.fn(async () => ({ id: 42 }) as chrome.tabs.Tab);
  const remove = vi.fn(async () => undefined);
  const deps: LocalBrowserControllerDeps = {
    getExpectedActor: vi.fn(async () => ({ ok: true as const, data: actor })),
    verify: vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 'accepted' as const,
        admission_id: ids.admission,
        deadline_ms: Date.now() + 10_000,
      },
    })),
    acknowledge: vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 'accepted' as const,
        operation: 'admit' as const,
        receipt: { admission_id: ids.admission, status: 'created' as const },
        lease_expires_at_ms: Date.now() + 10_000,
      },
    })),
    getSocketEpoch: () => 'epoch-1',
    send: vi.fn(async (_epoch, payload) => {
      sent.push(payload);
      return true;
    }),
    onLifecycle: (handler) => {
      lifecycle = handler;
      return () => undefined;
    },
    onEpochInvalidated: (handler) => {
      invalidated = () => handler(null);
      return () => undefined;
    },
    onAuthChanged: () => () => undefined,
    onOrganizationChanged: () => () => undefined,
    tabs: {
      create,
      remove,
      get: vi.fn(async () => ({ id: 42 }) as chrome.tabs.Tab),
      onRemoved: () => () => undefined,
    },
  };
  const controller = new LocalBrowserController(deps);
  controller.start();
  const emit = async (payload: unknown, expectReply = true): Promise<void> => {
    const sentBefore = sent.length;
    lifecycle?.(payload, 'epoch-1');
    if (!expectReply) {
      await Promise.resolve();
      return;
    }
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(sentBefore));
  };
  return { controller, create, deps, emit, invalidated: () => invalidated?.(), remove, sent };
}

async function register(
  h: ReturnType<typeof harness>,
): Promise<{ generation: string; connection: string }> {
  await h.emit(
    {
      type: 'local_browser.register_required',
      version: 1,
      engine_boot_id: ids.boot,
      revision: 0,
    },
    false,
  );
  const registration = h.sent[0] as Record<string, string>;
  if (!registration.extension_generation || !registration.connection_id)
    throw new Error('registration was not sent');
  await h.emit(
    {
      type: 'local_browser.registration',
      version: 1,
      status: 'acknowledged',
      engine_boot_id: ids.boot,
      expected_revision: 0,
      extension_generation: registration.extension_generation,
      connection_id: registration.connection_id,
    },
    false,
  );
  return {
    generation: registration.extension_generation,
    connection: registration.connection_id,
  };
}

describe('owned local-browser tab controller', () => {
  it('never creates a tab for an HTTP-successful authority refusal', async () => {
    const h = harness();
    const registration = await register(h);
    h.deps.verify = vi.fn(async () => ({
      ok: true as const,
      data: { status: 'refused' as const, reason: 'forbidden' as const },
    }));
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatchObject({ status: 'refused' });
  });

  it('creates one inactive blank tab for a duplicated admitted execution and acks the original receipt', async () => {
    const h = harness();
    const registration = await register(h);
    const grant = opaqueAdmitGrant(registration.generation, registration.connection);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant,
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000013',
      operation: 'admit',
      grant,
    });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith({ url: 'about:blank', active: false });
    expect(h.deps.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ receipt: { admission_id: ids.admission, status: 'created' } }),
    );
    expect(h.sent.at(-1)).toMatchObject({ status: 'acknowledged', receipt: 'created' });
  });

  it('closes a tab returned after invalidation and never installs it', async () => {
    const h = harness();
    const registration = await register(h);
    let release!: (tab: chrome.tabs.Tab) => void;
    h.deps.tabs.create = vi.fn(
      () =>
        new Promise<chrome.tabs.Tab>((resolve) => {
          release = resolve;
        }),
    );
    const grant = opaqueAdmitGrant(registration.generation, registration.connection);
    h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant,
    });
    await vi.waitFor(() => expect(h.deps.verify).toHaveBeenCalledTimes(1));
    h.invalidated();
    release({ id: 43 } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(h.remove).toHaveBeenCalledWith(43));
    expect(h.deps.acknowledge).not.toHaveBeenCalled();
  });

  it('retries a lost admission acknowledgement on the same owned tab', async () => {
    const h = harness();
    const registration = await register(h);
    h.deps.acknowledge = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: 'network_error' })
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          status: 'accepted' as const,
          operation: 'admit' as const,
          receipt: { admission_id: ids.admission, status: 'created' as const },
          lease_expires_at_ms: Date.now() + 10_000,
        },
      });
    const grant = opaqueAdmitGrant(registration.generation, registration.connection);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant,
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000014',
      operation: 'admit',
      grant,
    });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.deps.acknowledge).toHaveBeenCalledTimes(2);
    expect(h.sent.at(-1)).toMatchObject({ status: 'acknowledged', receipt: 'created' });
  });

  it('replays a cleanup receipt without adopting or closing a second tab', async () => {
    const h = harness();
    const registration = await register(h);
    h.deps.verify = vi.fn(async (request) =>
      request.proof.operation === 'cleanup'
        ? { ok: true as const, data: { status: 'accepted' as const, stop_id: stopId } }
        : {
            ok: true as const,
            data: {
              status: 'accepted' as const,
              admission_id: ids.admission,
              deadline_ms: Date.now() + 10_000,
            },
          },
    );
    h.deps.acknowledge = vi.fn(async (request) =>
      request.operation === 'cleanup'
        ? {
            ok: true as const,
            data: {
              status: 'accepted' as const,
              operation: 'cleanup' as const,
              receipt: { stop_id: stopId, status: 'closed' as const },
            },
          }
        : {
            ok: true as const,
            data: {
              status: 'accepted' as const,
              operation: 'admit' as const,
              receipt: { admission_id: ids.admission, status: 'created' as const },
              lease_expires_at_ms: Date.now() + 10_000,
            },
          },
    );
    const admission = opaqueAdmitGrant(registration.generation, registration.connection);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: admission,
    });
    const cleanup = opaqueCleanupGrant(registration.generation, registration.connection);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000016',
      operation: 'cleanup',
      grant: cleanup,
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000017',
      operation: 'cleanup',
      grant: cleanup,
    });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.sent.at(-1)).toMatchObject({ operation: 'cleanup', receipt: 'closed' });
  });

  it('keeps the truthful close receipt before a lost cleanup acknowledgement', async () => {
    const h = harness();
    const registration = await register(h);
    h.deps.verify = vi.fn(async (request) =>
      request.proof.operation === 'cleanup'
        ? { ok: true as const, data: { status: 'accepted' as const, stop_id: stopId } }
        : {
            ok: true as const,
            data: {
              status: 'accepted' as const,
              admission_id: ids.admission,
              deadline_ms: Date.now() + 10_000,
            },
          },
    );
    h.deps.acknowledge = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          status: 'accepted' as const,
          operation: 'admit' as const,
          receipt: { admission_id: ids.admission, status: 'created' as const },
          lease_expires_at_ms: Date.now() + 10_000,
        },
      })
      .mockResolvedValueOnce({ ok: false as const, error: 'network_error' })
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          status: 'accepted' as const,
          operation: 'cleanup' as const,
          receipt: { stop_id: stopId, status: 'closed' as const },
        },
      });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    const cleanup = opaqueCleanupGrant(registration.generation, registration.connection);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000018',
      operation: 'cleanup',
      grant: cleanup,
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000019',
      operation: 'cleanup',
      grant: cleanup,
    });
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.sent.at(-1)).toMatchObject({ operation: 'cleanup', receipt: 'closed' });
  });
});
