import type { DetachedWindowAPI } from 'happy-dom';
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
vi.mock('@/lib/debug/log', () => ({ log: { warn: vi.fn() } }));
vi.mock('@/lib/chat/context/check-auth-state', () => ({
  checkAuthState: vi.fn(async () => ({ signed_in: 'no' })),
}));
vi.mock('./approvals', () => ({
  localBrowserApprovalGeneration: () => 0,
  onLocalBrowserApprovalGenerationChange: () => () => undefined,
  requestLocalBrowserApproval: vi.fn(async () => ({ decision: 'allow', policy: {} })),
}));

import { log } from '@/lib/debug/log';
import { requestLocalBrowserApproval } from './approvals';
import {
  LocalBrowserController,
  type LocalBrowserControllerDeps,
  canonicalGrantDeadlineMs,
  postSubmitDocumentObserver,
} from './controller';

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

function opaqueAdmitGrant(
  extensionGeneration: string,
  connectionId: string,
  expiresAtSecond = Math.floor(Date.now() / 1000) + 30,
): string {
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
    exp: expiresAtSecond,
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

function opaqueDiscoverGrant(): string {
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
    operation: 'discover',
    challenge_id: ids.challenge,
  };
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

function opaqueCleanupGrant(
  extensionGeneration: string,
  connectionId: string,
  expiresAtSecond = Math.floor(Date.now() / 1000) + 30,
): string {
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
    exp: expiresAtSecond,
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

function opaqueApproveGrant(
  extensionGeneration: string,
  connectionId: string,
  expiresAtSecond: number,
  controllerRevision = 0,
): string {
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
    exp: expiresAtSecond,
    iss: 'https://server.example',
    tier_policy: 'none',
    scopes: [],
    operation: 'approve',
    admission_id: ids.admission,
    extension_generation: extensionGeneration,
    connection_id: connectionId,
    controller_revision: controllerRevision,
    command_id: ids.call,
    sequence: 1,
    command_digest: 'a'.repeat(64),
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
  let removed: ((tabId: number) => void) | null = null;
  const sent: unknown[] = [];
  let authChanged: (() => void) | null = null;
  let organizationChanged: (() => void) | null = null;
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
    onAuthChanged: (handler) => {
      authChanged = handler;
      return () => undefined;
    },
    onOrganizationChanged: (handler) => {
      organizationChanged = handler;
      return () => undefined;
    },
    tabs: {
      create,
      remove,
      get: vi.fn(async () => ({ id: 42 }) as chrome.tabs.Tab),
      update: vi.fn(async () => ({ id: 42 }) as chrome.tabs.Tab),
      onUpdated: () => () => undefined,
      onRemoved: (handler) => {
        removed = handler;
        return () => undefined;
      },
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
  return {
    controller,
    create,
    deps,
    emit,
    invalidated: () => invalidated?.(),
    removed: (tabId: number) => removed?.(tabId),
    authChanged: () => authChanged?.(),
    organizationChanged: () => organizationChanged?.(),
    remove,
    sent,
  };
}

async function register(
  h: ReturnType<typeof harness>,
  revision = 0,
): Promise<{ generation: string; connection: string }> {
  await h.emit(
    {
      type: 'local_browser.register_required',
      version: 1,
      engine_boot_id: ids.boot,
      revision,
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
      expected_revision: revision,
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

async function frozenDigest(spec: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`matrx.local-login-verification.v1\0${spec}`),
    ),
  );
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

describe('owned local-browser tab controller', () => {
  async function inspectLoginProbe(
    probe: unknown,
    currentDocument: { documentId: string; url: string } = {
      documentId: ids.challenge,
      url: 'https://example.test/login',
    },
  ) {
    const h = harness();
    const originalChrome = globalThis.chrome;
    Object.assign(globalThis, {
      chrome: {
        ...originalChrome,
        scripting: {
          executeScript: vi.fn(async () => [{ result: probe }]),
        },
      },
    });
    const document = { documentId: ids.challenge, url: 'https://example.test/login' };
    h.deps.command = {
      currentDocument: vi.fn(async () => currentDocument),
    } as unknown as NonNullable<LocalBrowserControllerDeps['command']>;
    const invoke = h.controller as unknown as {
      performClaimedCommand: (...args: unknown[]) => Promise<unknown>;
    };
    try {
      return await invoke.performClaimedCommand(
        { operation: 'inspect_login' },
        42,
        document,
        { command_id: ids.call, deadline_ms: Date.now() + 10_000 },
        () => true,
        async () => {
          const current = await h.deps.command?.currentDocument(42);
          return current?.documentId === document.documentId && current.url === document.url;
        },
      );
    } finally {
      h.controller.stop();
      Object.assign(globalThis, { chrome: originalChrome });
    }
  }

  it('returns a sane MFA selector from an otherwise safe inspect probe', async () => {
    await expect(
      inspectLoginProbe({
        is_top_frame: true,
        origin: 'https://example.test',
        destination_safe: true,
        username_selector: '#username',
        password_selector: null,
        mfa_selector: ' input[name="one-time-code"] ',
      }),
    ).resolves.toMatchObject({
      outcome: 'completed',
      reason: 'none',
      data: {
        origin: 'https://example.test',
        form: 'username_first',
        challenge: 'mfa',
        mfa_selector: 'input[name="one-time-code"]',
      },
    });
  });

  it('keeps inspect challenge unknown when the optional MFA selector is absent or malformed', async () => {
    const baseProbe = {
      is_top_frame: true,
      origin: 'https://example.test',
      destination_safe: true,
      username_selector: null,
      password_selector: '#password',
    };
    for (const mfa_selector of [undefined, '', ' '.repeat(513), 'input\u0000[name=code]', {}]) {
      const result = await inspectLoginProbe({ ...baseProbe, mfa_selector });
      expect(result).toMatchObject({
        outcome: 'completed',
        reason: 'none',
        data: { challenge: 'unknown' },
      });
      expect((result as { data: Record<string, unknown> }).data).not.toHaveProperty('mfa_selector');
    }
  });

  it('refuses MFA inspection when the top-frame, origin, safe-form, or current-document fence fails', async () => {
    const safeProbe = {
      is_top_frame: true,
      origin: 'https://example.test',
      destination_safe: true,
      username_selector: null,
      password_selector: '#password',
      mfa_selector: '#mfa-code',
    };
    const unsafeProbes = [
      { ...safeProbe, is_top_frame: false },
      { ...safeProbe, origin: 'https://other.test' },
      { ...safeProbe, destination_safe: false },
    ];
    for (const probe of unsafeProbes)
      await expect(inspectLoginProbe(probe)).resolves.toMatchObject({
        outcome: 'outcome_unknown',
        reason: 'unsafe_destination',
      });
    await expect(
      inspectLoginProbe(safeProbe, {
        documentId: ids.admission,
        url: 'https://example.test/login',
      }),
    ).resolves.toMatchObject({ outcome: 'outcome_unknown', reason: 'binding_changed' });
  });

  it('does not treat a Chrome network-error document as a completed navigation', async () => {
    const originalChrome = globalThis.chrome;
    let onUpdated: ((tabId: number, changeInfo: { status?: string }) => void) | null = null;
    const getFrame = vi.fn(async () => ({
      documentId: 'network-error-document',
      url: 'https://unreachable.example.test/login',
      errorOccurred: true,
    }));
    Object.assign(globalThis, {
      chrome: {
        webNavigation: { getFrame },
        tabs: {
          onUpdated: {
            addListener: (handler: typeof onUpdated) => {
              onUpdated = handler;
            },
            removeListener: () => {
              onUpdated = null;
            },
          },
          update: async () => {
            queueMicrotask(() => onUpdated?.(42, { status: 'complete' }));
            return { id: 42 };
          },
        },
      },
    });
    try {
      const controller = new LocalBrowserController();
      const deps = (controller as unknown as { deps: LocalBrowserControllerDeps }).deps;
      expect(await deps.command?.currentDocument(42)).toBeNull();
      getFrame.mockResolvedValue({
        documentId: 'loaded-document',
        url: 'https://unreachable.example.test/login',
        errorOccurred: false,
      });
      expect(await deps.command?.currentDocument(42)).toEqual({
        documentId: 'loaded-document',
        url: 'https://unreachable.example.test/login',
      });
      getFrame.mockRejectedValueOnce(new Error('private-navigation-error-sentinel'));
      expect(await deps.command?.currentDocument(42)).toBeNull();
      getFrame.mockRejectedValueOnce(new Error('private-navigation-error-sentinel'));
      vi.mocked(log.warn).mockClear();
      const startedAt = Date.now();
      const result = await (
        controller as unknown as {
          navigateOwnedTab: (
            tabId: number,
            original: { documentId: string; url: string },
            target: URL,
            deadlineMs: number,
            isCurrent: () => boolean,
          ) => Promise<boolean>;
        }
      ).navigateOwnedTab(
        42,
        { documentId: 'original-document', url: 'about:blank' },
        new URL('https://unreachable.example.test/login'),
        startedAt + 5_000,
        () => true,
      );
      expect(result).toBe(false);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(
        'private-navigation-error-sentinel',
      );
    } finally {
      Object.assign(globalThis, { chrome: originalChrome });
    }
  });

  it('reports a fixed delivery diagnostic after a completed command result is not sent', async () => {
    const happyWindow = window as typeof window & { happyDOM: DetachedWindowAPI };
    happyWindow.happyDOM.setURL('https://example.test/login');
    const lateTextMarker = 'Harbor Dental patient portal is ready for your next appointment.';
    let settled = false;
    let selectorProbedBeforeSettlement = false;
    document.body.innerHTML = `<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="submit">go</button></form><p>${'x'.repeat(4001)}${lateTextMarker}</p>`;
    document.getElementById('submit')?.addEventListener('click', () => {
      document.querySelector('form')?.remove();
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<a href="/logout">out</a>');
        settled = true;
      }, 500);
    });
    const originalChrome = globalThis.chrome;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    const scriptStages: string[] = [];
    Object.assign(globalThis.chrome as object, {
      tabs: { get: async () => ({ id: 42, url: window.location.href }) },
      scripting: {
        executeScript: async (request: {
          func: (...args: never[]) => unknown;
          args?: never[];
        }) => {
          const firstArgument = request.args?.[0];
          const stage = (firstArgument as { operation?: string } | undefined)?.operation;
          if (stage) scriptStages.push(stage);
          if (firstArgument === 'a[href="/logout"]' && !settled)
            selectorProbedBeforeSettlement = true;
          return [{ result: await request.func(...(request.args ?? [])) }];
        },
      },
    });
    const spec = JSON.stringify({
      version: 1,
      expect: { success_selector: 'a[href="/logout"]', timeout_ms: 1000 },
      url_vocabulary: { version: 1, challenge: ['challenge'], sign_in: ['login'] },
      recipe_id: '00000000-0000-4000-8000-000000000099',
      recipe_version: 1,
      descriptors: [
        {
          kind: 'selector_present',
          value: 'a[href="/logout"]',
          label: null,
          direction: 'authenticated',
          weight: 1,
        },
        {
          kind: 'selector_absent',
          value: '#missing',
          label: null,
          direction: 'authenticated',
          weight: 1,
        },
        {
          kind: 'text_present',
          value: lateTextMarker,
          label: null,
          direction: 'authenticated',
          weight: 1,
        },
      ],
    });
    const commandJson = JSON.stringify({
      operation: 'vault_login',
      credential_item_id: ids.call,
      fields: [
        { selector: '#username', field_key: 'username', clear_first: true },
        { selector: '#password', field_key: 'password', clear_first: true },
      ],
      submit: { kind: 'click', selector: '#submit' },
      expect: { success_selector: 'a[href="/logout"]', timeout_ms: 1000 },
      verification_spec_json: spec,
      verification_digest: await frozenDigest(spec),
    });
    const h = harness();
    const registration = await register(h);
    vi.mocked(log.warn).mockClear();
    const expiresAtSecond = Math.floor(Date.now() / 1000) + 30;
    const deadlineMs = expiresAtSecond * 1000;
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    const currentDocument = { documentId: ids.challenge, url: 'https://example.test/login' };
    const claim = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 'claimed' as const,
        command_id: ids.call,
        deadline_ms: deadlineMs,
        completion_grant: 'complete',
        injection: {
          origin: 'https://example.test',
          expires_at_ms: deadlineMs - 1000,
          fields: { username: 'user', password: 'secret' },
        },
      },
    }));
    const complete = vi.fn<NonNullable<LocalBrowserControllerDeps['command']>['complete']>(
      async (request) => ({
        ok: true as const,
        data: { status: 'completed' as const, result: request.result },
      }),
    );
    h.deps.command = {
      verify: vi.fn(
        async () =>
          ({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'approve',
              actor_id: ids.user,
              organization_id: ids.org,
              profile_id: ids.profile,
              admission_id: ids.admission,
              command_id: ids.call,
              sequence: 1,
              command_digest: 'a'.repeat(64),
              approval_id: ids.jti,
              deadline_ms: deadlineMs,
              expires_at_ms: deadlineMs,
              extension_generation: registration.generation,
              connection_id: registration.connection,
              run_id: ids.run,
              app_instance_id: ids.app,
              controller_revision: 0,
              jti: ids.jti,
            },
          }) as never,
      ),
      approve: vi.fn(async () => ({
        ok: true as const,
        data: {
          status: 'allowed' as const,
          approval_id: ids.jti,
          command_id: ids.call,
          claim_grant: 'claim',
          deadline_ms: deadlineMs,
        },
      })),
      claim,
      complete,
      currentDocument: vi.fn(async () => currentDocument),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;
    vi.mocked(h.deps.send).mockImplementation(async (_epoch, payload) => {
      if ((payload as { type?: string }).type === 'local_browser.result') return false;
      return true;
    });
    await h.emit(
      {
        type: 'local_browser.execute',
        version: 1,
        call_id: ids.call,
        operation: 'approve',
        grant: opaqueApproveGrant(
          registration.generation,
          registration.connection,
          expiresAtSecond,
        ),
        command_json: commandJson,
      },
      false,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ command_json: commandJson }));
    expect(scriptStages).toEqual(expect.arrayContaining(['fill', 'submit_explicit']));
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      result: { outcome: 'completed', reason: 'none' },
    });
    const receipt = (complete.mock.calls[0]?.[0] as { result: { data: Record<string, unknown> } })
      .result.data;
    expect(receipt).toMatchObject({ verification_digest: await frozenDigest(spec) });
    expect(receipt.verification).toBe('verified');
    expect(receipt.observation).toMatchObject({
      success_selector: true,
      recipe_matches: [true, true, true],
    });
    expect(selectorProbedBeforeSettlement).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain('secret');
    expect(JSON.stringify(receipt)).not.toContain('https://example.test/login');
    expect(scriptStages).toContain('fill');
    expect(scriptStages).toContain('submit_explicit');
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_result_delivery_failed'],
    ]);
    h.controller.stop();
    Object.assign(globalThis, { chrome: originalChrome });
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });
  it('returns field_unavailable when an admitted vault selector is missing before observation', async () => {
    const happyWindow = window as typeof window & { happyDOM: DetachedWindowAPI };
    happyWindow.happyDOM.setURL('https://example.test/login');
    document.body.innerHTML = '<form><input id="username"></form>';
    const originalChrome = globalThis.chrome;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    Object.assign(globalThis.chrome as object, {
      tabs: { get: async () => ({ id: 42, url: window.location.href }) },
      scripting: {
        executeScript: async (request: { func: (...args: never[]) => unknown; args?: never[] }) => [
          { result: await request.func(...(request.args ?? [])) },
        ],
      },
    });
    const spec = JSON.stringify({
      version: 1,
      expect: { timeout_ms: 1000 },
      url_vocabulary: { version: 1, challenge: ['challenge'], sign_in: ['login'] },
      recipe_id: '00000000-0000-4000-8000-000000000099',
      recipe_version: 1,
      descriptors: [],
    });
    const commandJson = JSON.stringify({
      operation: 'vault_login',
      credential_item_id: ids.call,
      fields: [
        { selector: '#username', field_key: 'username', clear_first: true },
        { selector: '#password', field_key: 'password', clear_first: true },
      ],
      submit: { kind: 'click', selector: '#submit' },
      expect: { timeout_ms: 1000 },
      verification_spec_json: spec,
      verification_digest: await frozenDigest(spec),
    });
    const h = harness();
    const registration = await register(h);
    vi.mocked(log.warn).mockClear();
    const expiresAtSecond = Math.floor(Date.now() / 1000) + 30;
    const deadlineMs = expiresAtSecond * 1000;
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    const complete = vi.fn<NonNullable<LocalBrowserControllerDeps['command']>['complete']>(
      async (request) => ({
        ok: true as const,
        data: { status: 'completed' as const, result: request.result },
      }),
    );
    h.deps.command = {
      verify: vi.fn(
        async () =>
          ({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'approve',
              actor_id: ids.user,
              organization_id: ids.org,
              profile_id: ids.profile,
              admission_id: ids.admission,
              command_id: ids.call,
              sequence: 1,
              command_digest: 'a'.repeat(64),
              approval_id: ids.jti,
              deadline_ms: deadlineMs,
              expires_at_ms: deadlineMs,
              extension_generation: registration.generation,
              connection_id: registration.connection,
              run_id: ids.run,
              app_instance_id: ids.app,
              controller_revision: 0,
              jti: ids.jti,
            },
          }) as never,
      ),
      approve: vi.fn(async () => ({
        ok: true as const,
        data: {
          status: 'allowed' as const,
          approval_id: ids.jti,
          command_id: ids.call,
          claim_grant: 'claim',
          deadline_ms: deadlineMs,
        },
      })),
      claim: vi.fn(async () => ({
        ok: true as const,
        data: {
          status: 'claimed' as const,
          command_id: ids.call,
          deadline_ms: deadlineMs,
          completion_grant: 'complete',
          injection: {
            origin: 'https://example.test',
            expires_at_ms: deadlineMs - 1000,
            fields: { username: 'portal-user', password: 'private-password' },
          },
        },
      })),
      complete,
      currentDocument: vi.fn(async () => ({
        documentId: ids.challenge,
        url: 'https://example.test/login',
      })),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;
    await h.emit(
      {
        type: 'local_browser.execute',
        version: 1,
        call_id: ids.call,
        operation: 'approve',
        grant: opaqueApproveGrant(
          registration.generation,
          registration.connection,
          expiresAtSecond,
        ),
        command_json: commandJson,
      },
      false,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    const result = complete.mock.calls[0]?.[0].result;
    expect(result).toMatchObject({
      operation: 'vault_login',
      outcome: 'outcome_unknown',
      reason: 'field_unavailable',
    });
    const diagnostic = vi.mocked(log.warn).mock.calls;
    expect(diagnostic).toEqual([
      ['desktop', 'local_browser_terminal:vault_login:selector_check:filled=false:submitted=false'],
    ]);
    const safeReceipt = JSON.stringify(result);
    const safeDiagnostic = JSON.stringify(diagnostic);
    for (const sentinel of [
      'private-password',
      'https://example.test/login',
      '#password',
      'selector_not_found',
      'admitted_document_lost',
    ])
      expect(`${safeReceipt}${safeDiagnostic}`).not.toContain(sentinel);
    expect(safeDiagnostic).not.toContain(ids.call);
    h.controller.stop();
    Object.assign(globalThis, { chrome: originalChrome });
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  it('maps a local step wait timeout to form_changed before the command deadline', async () => {
    const happyWindow = window as typeof window & { happyDOM: DetachedWindowAPI };
    happyWindow.happyDOM.setURL('https://example.test/login');
    document.body.innerHTML =
      '<form method="post" action="/login"><input id="username"><input id="password" type="password"></form>';
    const originalChrome = globalThis.chrome;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    Object.assign(globalThis.chrome as object, {
      scripting: {
        executeScript: async (request: { func: (...args: never[]) => unknown; args?: never[] }) => [
          { result: await request.func(...(request.args ?? [])) },
        ],
      },
    });
    const spec = JSON.stringify({
      version: 1,
      expect: { timeout_ms: 1000 },
      url_vocabulary: { version: 1, challenge: ['challenge'], sign_in: ['login'] },
      recipe_id: '00000000-0000-4000-8000-000000000099',
      recipe_version: 1,
      descriptors: [],
    });
    const original = { documentId: ids.challenge, url: 'https://example.test/login' };
    const h = harness();
    h.deps.command = {
      currentDocument: vi.fn(async () => original),
    } as unknown as NonNullable<LocalBrowserControllerDeps['command']>;
    vi.mocked(log.warn).mockClear();
    const invoke = h.controller as unknown as {
      performClaimedCommand: (...args: unknown[]) => Promise<{ reason: string }>;
    };
    const result = await invoke.performClaimedCommand(
      {
        operation: 'vault_login',
        credential_item_id: ids.call,
        fields: [
          { selector: '#username', field_key: 'username', clear_first: true },
          { selector: '#password', field_key: 'password', clear_first: true },
        ],
        steps: [
          {
            fields: ['#username', '#password'],
            submit: { kind: 'none' },
            wait_for: { selector: '#account-home', timeout_ms: 1000 },
          },
        ],
        expect: { timeout_ms: 1000 },
        verification_spec_json: spec,
        verification_digest: await frozenDigest(spec),
      },
      42,
      original,
      {
        status: 'claimed',
        command_id: ids.call,
        deadline_ms: Date.now() + 10_000,
        completion_grant: 'complete',
        injection: {
          origin: 'https://example.test',
          expires_at_ms: Date.now() + 9_000,
          fields: { username: 'portal-user', password: 'private-password' },
        },
      },
      () => true,
      async () => true,
    );
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_terminal:vault_login:wait:filled=true:submitted=false'],
    ]);
    expect(result.reason).toBe('form_changed');
    h.controller.stop();
    Object.assign(globalThis, { chrome: originalChrome });
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  }, 10_000);

  it('keeps a submitted same-origin transition out of original-document binding checks', async () => {
    const happyWindow = window as typeof window & { happyDOM: DetachedWindowAPI };
    happyWindow.happyDOM.setURL('https://example.test/login');
    document.body.innerHTML =
      '<form method="post" action="/login"><input id="username"><input id="password" type="password"><button id="submit">Sign in</button></form>';
    let submitted = false;
    document.getElementById('submit')?.addEventListener('click', () => {
      submitted = true;
    });
    const originalChrome = globalThis.chrome;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    Object.assign(globalThis.chrome as object, {
      scripting: {
        executeScript: async (request: { func: (...args: never[]) => unknown; args?: never[] }) => [
          { result: await request.func(...(request.args ?? [])) },
        ],
      },
    });
    const spec = JSON.stringify({
      version: 1,
      expect: { timeout_ms: 1000 },
      url_vocabulary: { version: 1, challenge: ['challenge'], sign_in: ['login'] },
      recipe_id: '00000000-0000-4000-8000-000000000099',
      recipe_version: 1,
      descriptors: [],
    });
    const original = { documentId: ids.challenge, url: 'https://example.test/login' };
    const h = harness();
    h.deps.command = {
      currentDocument: vi.fn(async () =>
        submitted ? { documentId: ids.challenge, url: 'https://other.test/after-login' } : original,
      ),
    } as unknown as NonNullable<LocalBrowserControllerDeps['command']>;
    vi.mocked(log.warn).mockClear();
    const invoke = h.controller as unknown as {
      performClaimedCommand: (...args: unknown[]) => Promise<{ reason: string }>;
    };
    const result = await invoke.performClaimedCommand(
      {
        operation: 'vault_login',
        credential_item_id: ids.call,
        fields: [
          { selector: '#username', field_key: 'username', clear_first: true },
          { selector: '#password', field_key: 'password', clear_first: true },
        ],
        submit: { kind: 'click', selector: '#submit' },
        expect: { timeout_ms: 1000 },
        verification_spec_json: spec,
        verification_digest: await frozenDigest(spec),
      },
      42,
      original,
      {
        status: 'claimed',
        command_id: ids.call,
        deadline_ms: Date.now() + 10_000,
        completion_grant: 'complete',
        injection: {
          origin: 'https://example.test',
          expires_at_ms: Date.now() + 9_000,
          fields: { username: 'portal-user', password: 'private-password' },
        },
      },
      () => true,
      async () => !submitted,
    );
    expect(result.reason).toBe('tab_lost');
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      [
        'desktop',
        'local_browser_terminal:vault_login:post_submit_document:filled=true:submitted=true',
      ],
    ]);
    h.controller.stop();
    Object.assign(globalThis, { chrome: originalChrome });
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  it('freezes one same-origin post-submit transition for readonly observation and rejects further transitions', async () => {
    let submitted = false;
    let current = { documentId: 'original', url: 'https://example.test/login' };
    const observe = postSubmitDocumentObserver({
      original: current,
      deadlineMs: Date.now() + 10_000,
      isCurrent: () => true,
      isSubmitted: () => submitted,
      currentDocument: async () => current,
    });
    expect(await observe()).toBeNull();
    submitted = true;
    current = { documentId: 'original', url: 'https://example.test/home' };
    expect(await observe()).toEqual(current);
    current = { documentId: 'original', url: 'https://example.test/login' };
    expect(await observe()).toBeNull();
    current = { documentId: 'replacement', url: 'https://example.test/mfa' };
    expect(await observe()).toBeNull();
    current = { documentId: 'cross-origin', url: 'https://other.test/mfa' };
    expect(await observe()).toBeNull();
    current = { documentId: 'second-replacement', url: 'https://example.test/home' };
    expect(await observe()).toBeNull();
  });

  it('refuses observation when binding or deadline changes during current-document read', async () => {
    let current = true;
    let release!: (value: { documentId: string; url: string }) => void;
    const observe = postSubmitDocumentObserver({
      original: { documentId: 'original', url: 'https://example.test/login' },
      deadlineMs: Date.now() + 10_000,
      isCurrent: () => current,
      isSubmitted: () => true,
      currentDocument: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const pending = observe();
    current = false;
    release({ documentId: 'replacement', url: 'https://example.test/home' });
    expect(await pending).toBeNull();

    const expired = postSubmitDocumentObserver({
      original: { documentId: 'original', url: 'https://example.test/login' },
      deadlineMs: Date.now() - 1,
      isCurrent: () => true,
      isSubmitted: () => true,
      currentDocument: async () => ({
        documentId: 'replacement',
        url: 'https://example.test/home',
      }),
    });
    expect(await expired()).toBeNull();
  });

  it('waits through a transient missing document after submit without changing the owned tab', async () => {
    let reads = 0;
    const replacement = { documentId: 'replacement', url: 'https://example.test/home' };
    const observe = postSubmitDocumentObserver({
      original: { documentId: 'original', url: 'https://example.test/login' },
      deadlineMs: Date.now() + 5_000,
      isCurrent: () => true,
      isSubmitted: () => true,
      currentDocument: async () => (++reads === 1 ? null : replacement),
    });
    expect(await observe()).toEqual(replacement);
    expect(reads).toBe(2);
  });

  it('stops retrying a missing document at the configured command deadline', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const observe = postSubmitDocumentObserver({
        original: { documentId: 'original', url: 'https://example.test/login' },
        deadlineMs: Date.now() + 800,
        isCurrent: () => true,
        isSubmitted: () => true,
        currentDocument: async () => {
          reads += 1;
          return null;
        },
      });
      const pending = observe();
      await vi.advanceTimersByTimeAsync(800);
      expect(await pending).toBeNull();
      const readsAtDeadline = reads;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reads).toBe(readsAtDeadline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('canonicalizes server millisecond projections to the grant expiry second', () => {
    // The server's projection is millisecond precision; the signed `exp` claim is seconds.
    expect(canonicalGrantDeadlineMs(1_700_000_000_999)).toBe(1_700_000_000_000);
    expect(canonicalGrantDeadlineMs(1_700_000_001_000)).toBe(1_700_000_001_000);
  });

  it('binds approval to the signed run revision and keeps deadline checks independent', async () => {
    const expiresAtSecond = Math.floor(Date.now() / 1000) + 30;
    const projectedDeadlineMs = expiresAtSecond * 1000 + 999;
    const commandJson = JSON.stringify({
      operation: 'navigate',
      url: 'https://example.test/after',
    });
    const h = harness();
    const desktopContextRevision = 7;
    const serverRunRevision = 0;
    const registration = await register(h, desktopContextRevision);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });

    let currentDocument = {
      documentId: ids.challenge,
      url: 'https://example.test/before',
    };
    let onUpdated: ((tabId: number, changeInfo: { status?: string }) => void) | undefined;
    h.deps.tabs.onUpdated = (handler) => {
      onUpdated = handler;
      return () => undefined;
    };
    h.deps.tabs.update = vi.fn(async () => {
      currentDocument = { documentId: ids.admission, url: 'https://example.test/after' };
      onUpdated?.(42, { status: 'complete' });
      return { id: 42 } as chrome.tabs.Tab;
    });
    const approve = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 'allowed' as const,
        approval_id: ids.jti,
        command_id: ids.call,
        claim_grant: 'claim-grant',
        deadline_ms: expiresAtSecond * 1000,
      },
    }));
    const claim = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 'claimed' as const,
        command_id: ids.call,
        deadline_ms: expiresAtSecond * 1000,
        completion_grant: 'completion-grant',
      },
    }));
    const complete = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: 'completed' as const,
        result: {
          command_id: ids.call,
          operation: 'navigate' as const,
          outcome: 'completed' as const,
          reason: 'none' as const,
          data: { origin: 'https://example.test' },
        },
      },
    }));
    h.deps.command = {
      verify: vi.fn(
        async () =>
          ({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'approve',
              actor_id: ids.user,
              organization_id: ids.org,
              profile_id: ids.profile,
              admission_id: ids.admission,
              command_id: ids.call,
              sequence: 1,
              command_digest: 'a'.repeat(64),
              approval_id: ids.jti,
              deadline_ms: projectedDeadlineMs,
              expires_at_ms: projectedDeadlineMs,
              extension_generation: registration.generation,
              connection_id: registration.connection,
              run_id: ids.run,
              app_instance_id: ids.app,
              controller_revision: serverRunRevision,
              jti: ids.jti,
            },
          }) as never,
      ),
      approve,
      claim,
      complete,
      currentDocument: vi.fn(async () => currentDocument),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;

    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'approve',
      grant: opaqueApproveGrant(
        registration.generation,
        registration.connection,
        expiresAtSecond,
        serverRunRevision,
      ),
      command_json: commandJson,
    });
    expect(approve).toHaveBeenCalledOnce();
    expect(vi.mocked(requestLocalBrowserApproval)).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({ controllerRevision: serverRunRevision }),
      }),
    );
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: ids.call, command_json: commandJson }),
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(h.sent.at(-1)).toMatchObject({ operation: 'approve', status: 'acknowledged' });
    h.controller.stop();

    const mismatch = harness();
    const mismatchRegistration = await register(mismatch);
    await mismatch.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(mismatchRegistration.generation, mismatchRegistration.connection),
    });
    const mismatchApprove = vi.fn();
    mismatch.deps.command = {
      verify: vi.fn(
        async () =>
          ({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'approve',
              actor_id: ids.user,
              organization_id: ids.org,
              profile_id: ids.profile,
              admission_id: ids.admission,
              command_id: ids.call,
              sequence: 1,
              command_digest: 'a'.repeat(64),
              approval_id: ids.jti,
              deadline_ms: expiresAtSecond * 1000 + 1000,
              expires_at_ms: expiresAtSecond * 1000 + 1000,
              extension_generation: mismatchRegistration.generation,
              connection_id: mismatchRegistration.connection,
              run_id: ids.run,
              app_instance_id: ids.app,
              controller_revision: serverRunRevision + 1,
              jti: ids.jti,
            },
          }) as never,
      ),
      approve: mismatchApprove,
      claim: vi.fn(),
      complete: vi.fn(),
      currentDocument: vi.fn(async () => ({
        documentId: ids.challenge,
        url: 'https://example.test/before',
      })),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;
    await mismatch.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'approve',
      grant: opaqueApproveGrant(
        mismatchRegistration.generation,
        mismatchRegistration.connection,
        expiresAtSecond,
      ),
      command_json: commandJson,
    });
    expect(mismatchApprove).not.toHaveBeenCalled();
    expect(mismatch.sent.at(-1)).toMatchObject({
      operation: 'approve',
      status: 'refused',
      reason: 'binding_changed',
    });
    mismatch.controller.stop();
  });

  it('refuses approval when the desktop registration changes during verification', async () => {
    const expiresAtSecond = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(log.warn).mockClear();
    const h = harness();
    const registration = await register(h, 7);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    type VerifyResult = Awaited<
      ReturnType<NonNullable<LocalBrowserControllerDeps['command']>['verify']>
    >;
    let resolveVerify!: (value: VerifyResult) => void;
    const approve = vi.fn();
    h.deps.command = {
      verify: vi.fn(
        () =>
          new Promise<VerifyResult>((resolve) => {
            resolveVerify = resolve;
          }),
      ),
      approve,
      claim: vi.fn(),
      complete: vi.fn(),
      currentDocument: vi.fn(),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;
    const pending = h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'approve',
      grant: opaqueApproveGrant(registration.generation, registration.connection, expiresAtSecond),
      command_json: JSON.stringify({ operation: 'inspect_login' }),
    });
    await vi.waitFor(() => expect(resolveVerify).toBeTypeOf('function'));
    h.invalidated();
    resolveVerify({
      ok: true,
      data: {
        status: 'accepted',
        operation: 'approve',
        actor_id: ids.user,
        organization_id: ids.org,
        profile_id: ids.profile,
        admission_id: ids.admission,
        command_id: ids.call,
        sequence: 1,
        command_digest: 'a'.repeat(64),
        approval_id: ids.jti,
        deadline_ms: expiresAtSecond * 1000,
        expires_at_ms: expiresAtSecond * 1000,
        extension_generation: registration.generation,
        connection_id: registration.connection,
        run_id: ids.run,
        app_instance_id: ids.app,
        controller_revision: 0,
        jti: ids.jti,
      },
    } as VerifyResult);
    await pending;
    expect(approve).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatchObject({
      operation: 'approve',
      status: 'refused',
      reason: 'binding_changed',
    });
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_approve_projection_fence_failed:context,registration,entry'],
    ]);
    h.controller.stop();
  });

  it('refuses approval when the verified run revision differs from its signed grant', async () => {
    const expiresAtSecond = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(log.warn).mockClear();
    const h = harness();
    const registration = await register(h, 7);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    const approve = vi.fn();
    h.deps.command = {
      verify: vi.fn(
        async () =>
          ({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'approve',
              actor_id: ids.user,
              organization_id: ids.org,
              profile_id: ids.profile,
              admission_id: ids.admission,
              command_id: ids.call,
              sequence: 1,
              command_digest: 'a'.repeat(64),
              approval_id: ids.jti,
              deadline_ms: expiresAtSecond * 1000,
              expires_at_ms: expiresAtSecond * 1000,
              extension_generation: registration.generation,
              connection_id: registration.connection,
              run_id: ids.run,
              app_instance_id: ids.app,
              controller_revision: 1,
              jti: ids.jti,
            },
          }) as never,
      ),
      approve,
      claim: vi.fn(),
      complete: vi.fn(),
      currentDocument: vi.fn(),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'approve',
      grant: opaqueApproveGrant(registration.generation, registration.connection, expiresAtSecond),
      command_json: JSON.stringify({ operation: 'inspect_login' }),
    });
    expect(approve).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatchObject({
      operation: 'approve',
      status: 'refused',
      reason: 'binding_changed',
    });
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_approve_projection_fence_failed:controller_revision'],
    ]);
    h.controller.stop();
  });

  it('logs only the closed verification-error label before the projection fence', async () => {
    const expiresAtSecond = Math.floor(Date.now() / 1000) + 30;
    vi.mocked(log.warn).mockClear();
    const h = harness();
    const registration = await register(h, 7);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    h.deps.command = {
      verify: vi.fn(async () => ({ ok: false as const, error: 'identity_changed' as const })),
      approve: vi.fn(),
      claim: vi.fn(),
      complete: vi.fn(),
      currentDocument: vi.fn(),
    } satisfies NonNullable<LocalBrowserControllerDeps['command']>;
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'approve',
      grant: opaqueApproveGrant(registration.generation, registration.connection, expiresAtSecond),
      command_json: JSON.stringify({ operation: 'inspect_login' }),
    });
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_approve_verify_failed:verify_identity_changed'],
    ]);
    expect(h.sent.at(-1)).toMatchObject({
      operation: 'approve',
      status: 'refused',
      reason: 'binding_changed',
    });
    h.controller.stop();
  });

  it('re-registers with fresh private binding after an organization change on a healthy socket', async () => {
    const h = harness();
    const first = await register(h);
    h.organizationChanged();
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    const second = h.sent[1] as Record<string, string>;
    expect(second.extension_generation).not.toBe(first.generation);
    expect(second.connection_id).not.toBe(first.connection);
    h.controller.stop();
  });
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

  it('does not acknowledge a discovery whose verification was refused', async () => {
    const h = harness();
    await register(h);
    h.deps.verify = vi.fn(async () => ({
      ok: true as const,
      data: { status: 'refused' as const, reason: 'forbidden' as const },
    }));
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'discover',
      grant: opaqueDiscoverGrant(),
    });
    expect(h.sent.at(-1)).toMatchObject({ operation: 'discover', status: 'refused' });
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

  it('acknowledges cleanup after Chrome reports the owned tab removed during close', async () => {
    vi.mocked(log.warn).mockClear();
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
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    h.remove.mockImplementation(async () => {
      h.removed(42);
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000024',
      operation: 'cleanup',
      grant: opaqueCleanupGrant(registration.generation, registration.connection),
    });
    expect(h.remove).toHaveBeenCalledWith(42);
    expect(h.deps.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: 'cleanup',
        receipt: { stop_id: stopId, status: 'closed' },
      }),
    );
    expect(h.sent.at(-1)).toMatchObject({ operation: 'cleanup', receipt: 'closed' });
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled();
  });

  it('retains cleanup identity when the original admission tombstone expires during close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
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
      await h.emit({
        type: 'local_browser.execute',
        version: 1,
        call_id: ids.call,
        operation: 'admit',
        grant: opaqueAdmitGrant(
          registration.generation,
          registration.connection,
          Math.floor(Date.now() / 1000) + 1,
        ),
      });
      let releaseRemove!: () => void;
      h.remove.mockImplementation(
        () =>
          new Promise<undefined>((resolve) => {
            h.removed(42);
            releaseRemove = () => resolve(undefined);
          }),
      );
      const cleanup = h.emit({
        type: 'local_browser.execute',
        version: 1,
        call_id: '00000000-0000-4000-8000-000000000026',
        operation: 'cleanup',
        grant: opaqueCleanupGrant(registration.generation, registration.connection),
      });
      await vi.waitFor(() => expect(releaseRemove).toBeTypeOf('function'));
      await vi.advanceTimersByTimeAsync(1_001);
      releaseRemove();
      await cleanup;
      expect(h.deps.acknowledge).toHaveBeenCalledTimes(2);
      expect(h.sent.at(-1)).toMatchObject({ operation: 'cleanup', receipt: 'closed' });
      h.controller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs only closed currentness labels when cleanup is invalidated after close', async () => {
    vi.mocked(log.warn).mockClear();
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
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    h.remove.mockImplementation(async () => {
      h.invalidated();
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000025',
      operation: 'cleanup',
      grant: opaqueCleanupGrant(registration.generation, registration.connection),
    });
    expect(h.remove).toHaveBeenCalledWith(42);
    expect(h.deps.acknowledge).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'cleanup' }),
    );
    expect(h.sent.at(-1)).toMatchObject({
      operation: 'cleanup',
      status: 'refused',
      reason: 'binding_changed',
    });
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      [
        'desktop',
        'local_browser_cleanup_fence_after_remove:context,registration,entry,cleanup_record',
      ],
    ]);
  });

  it('never closes a tab when cleanup verification is HTTP-successful but refused', async () => {
    vi.mocked(log.warn).mockClear();
    const h = harness();
    const registration = await register(h);
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    h.deps.verify = vi.fn(async () => ({
      ok: true as const,
      data: { status: 'refused' as const, reason: 'forbidden' as const },
    }));
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000022',
      operation: 'cleanup',
      grant: opaqueCleanupGrant(registration.generation, registration.connection),
    });
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatchObject({ operation: 'cleanup', status: 'refused' });
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_cleanup_verify_not_accepted:none'],
    ]);
  });

  it('does not acknowledge a cleanup when its registration is invalidated during ack', async () => {
    vi.mocked(log.warn).mockClear();
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
    let releaseCleanupAck!: () => void;
    h.deps.acknowledge = vi.fn((request) => {
      if (request.operation === 'cleanup') {
        return new Promise<Awaited<ReturnType<LocalBrowserControllerDeps['acknowledge']>>>(
          (resolve) => {
            releaseCleanupAck = () =>
              resolve({
                ok: true as const,
                data: {
                  status: 'accepted' as const,
                  operation: 'cleanup' as const,
                  receipt: { stop_id: stopId, status: 'closed' as const },
                },
              });
          },
        );
      }
      return Promise.resolve({
        ok: true as const,
        data: {
          status: 'accepted' as const,
          operation: 'admit' as const,
          receipt: { admission_id: ids.admission, status: 'created' as const },
          lease_expires_at_ms: Date.now() + 10_000,
        },
      });
    });
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    const cleanup = h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000023',
      operation: 'cleanup',
      grant: opaqueCleanupGrant(registration.generation, registration.connection),
    });
    await vi.waitFor(() => expect(releaseCleanupAck).toBeTypeOf('function'));
    h.invalidated();
    releaseCleanupAck();
    await cleanup;
    expect(h.sent.at(-1)).toMatchObject({ operation: 'cleanup', status: 'refused' });
    expect(vi.mocked(log.warn).mock.calls).toEqual([
      ['desktop', 'local_browser_cleanup_ack_fence:context,registration,cleanup_record'],
    ]);
  });

  it('serializes two concurrent cleanup calls behind one exact close', async () => {
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
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'admit',
      grant: opaqueAdmitGrant(registration.generation, registration.connection),
    });
    let release!: () => void;
    h.deps.tabs.remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const grant = opaqueCleanupGrant(registration.generation, registration.connection);
    const first = h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000020',
      operation: 'cleanup',
      grant,
    });
    await vi.waitFor(() => expect(h.deps.tabs.remove).toHaveBeenCalledTimes(1));
    const second = h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: '00000000-0000-4000-8000-000000000021',
      operation: 'cleanup',
      grant,
    });
    release();
    await Promise.all([first, second]);
    expect(h.deps.tabs.remove).toHaveBeenCalledTimes(1);
  });
});

it.each(['jti', 'bytes'])('refuses an admission retry with changed %s', async (change) => {
  const h = harness();
  const r = await register(h);
  const grant = opaqueAdmitGrant(r.generation, r.connection);
  const frame = {
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'admit',
    grant,
  };
  await h.emit(frame);
  let altered = `${grant}changed`;
  if (change === 'jti') {
    const parts = grant.split('.');
    if (!parts[1]) throw new Error('fixture payload missing');
    const claims = JSON.parse(atob(parts[1]));
    claims.jti = stopId;
    altered = `header.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
  }
  await h.emit({ ...frame, grant: altered });
  expect(h.sent.at(-1)).toMatchObject({ status: 'refused', reason: 'retry_conflict' });
  expect(h.create).toHaveBeenCalledTimes(1);
  h.controller.stop();
});

it('fences a saved cleanup receipt when registration changes during replay acknowledgement', async () => {
  const h = harness();
  const r = await register(h);
  await h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'admit',
    grant: opaqueAdmitGrant(r.generation, r.connection),
  });
  h.deps.verify = vi.fn(async () => ({
    ok: true as const,
    data: { status: 'accepted' as const, stop_id: stopId },
  }));
  h.deps.acknowledge = vi.fn(async () => ({ ok: false as const, error: 'network_error' as const }));
  const frame = {
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'cleanup',
    grant: opaqueCleanupGrant(r.generation, r.connection),
  };
  await h.emit(frame);
  let release!: () => void;
  h.deps.acknowledge = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<LocalBrowserControllerDeps['acknowledge']>>>((resolve) => {
        release = () =>
          resolve({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'cleanup',
              receipt: { stop_id: stopId, status: 'closed' },
            },
          });
      }),
  );
  const replay = h.emit(frame);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  h.invalidated();
  release();
  await replay;
  expect(h.sent.at(-1)).toMatchObject({ status: 'refused', reason: 'binding_changed' });
  h.controller.stop();
});

it('refuses discovery when its original deadline passes during verification', async () => {
  const h = harness();
  await register(h);
  const now = Date.now();
  h.deps.verify = vi.fn(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    return {
      ok: true as const,
      data: { status: 'accepted' as const, challenge_id: ids.challenge },
    };
  });
  try {
    await h.emit({
      type: 'local_browser.execute',
      version: 1,
      call_id: ids.call,
      operation: 'discover',
      grant: opaqueDiscoverGrant(),
    });
    expect(h.sent.at(-1)).toMatchObject({ status: 'refused' });
  } finally {
    vi.restoreAllMocks();
    h.controller.stop();
  }
});
// Append inside src/lib/desktop/local-browser/controller.test.ts.
// Both cases passed against extension commit 2e3c33bc33983b4ce3599709eb1a182d48d12b1a.

it('refuses both cleanup joiners when registration changes during shared acknowledgement', async () => {
  const h = harness();
  const r = await register(h);
  await h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'admit',
    grant: opaqueAdmitGrant(r.generation, r.connection),
  });
  h.deps.verify = vi.fn(async () => ({
    ok: true as const,
    data: { status: 'accepted' as const, stop_id: stopId },
  }));
  let release!: () => void;
  h.deps.acknowledge = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<LocalBrowserControllerDeps['acknowledge']>>>((resolve) => {
        release = () =>
          resolve({
            ok: true,
            data: {
              status: 'accepted',
              operation: 'cleanup',
              receipt: { stop_id: stopId, status: 'closed' },
            },
          });
      }),
  );
  const grant = opaqueCleanupGrant(r.generation, r.connection);
  const first = h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'cleanup',
    grant,
  });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const second = h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: '00000000-0000-4000-8000-000000000020',
    operation: 'cleanup',
    grant,
  });
  await Promise.resolve();
  h.invalidated();
  release();
  await Promise.all([first, second]);
  expect(h.sent.slice(-2)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: 'cleanup',
        status: 'refused',
        reason: 'binding_changed',
      }),
      expect.objectContaining({
        operation: 'cleanup',
        status: 'refused',
        reason: 'binding_changed',
      }),
    ]),
  );
  h.controller.stop();
});

it('rejects changed cleanup bytes while the original cleanup is in flight', async () => {
  const h = harness();
  const r = await register(h);
  await h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'admit',
    grant: opaqueAdmitGrant(r.generation, r.connection),
  });
  let releaseVerify!: () => void;
  h.deps.verify = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<LocalBrowserControllerDeps['verify']>>>((resolve) => {
        releaseVerify = () => resolve({ ok: true, data: { status: 'accepted', stop_id: stopId } });
      }),
  );
  const grant = opaqueCleanupGrant(r.generation, r.connection);
  const first = h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: ids.call,
    operation: 'cleanup',
    grant,
  });
  await vi.waitFor(() => expect(releaseVerify).toBeTypeOf('function'));
  await h.emit({
    type: 'local_browser.execute',
    version: 1,
    call_id: '00000000-0000-4000-8000-000000000021',
    operation: 'cleanup',
    grant: `${grant}changed`,
  });
  expect(h.sent.at(-1)).toMatchObject({
    operation: 'cleanup',
    status: 'refused',
    reason: 'retry_conflict',
  });
  releaseVerify();
  await first;
  expect(h.remove).toHaveBeenCalledTimes(1);
  h.controller.stop();
});
