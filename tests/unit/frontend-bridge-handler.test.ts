import { readIsAdminFromStorage } from '@/lib/auth/is-admin';
import {
  FRONTEND_RPC_CHANNEL,
  FrontendRpcEnvelopeSchema,
  handleFrontendRpc,
} from '@/lib/frontend-bridge/handler';
import { readDefaultPermissionMode } from '@/lib/settings/persisted';
import { ensureToolDescriptions } from '@/lib/tools/descriptions';
import { handleWebmcpCall } from '@/lib/tools/dispatch';
import { listAllHandlers } from '@/lib/tools/registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/is-admin', () => ({ readIsAdminFromStorage: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock('@/lib/settings/persisted', () => ({ readDefaultPermissionMode: vi.fn() }));
vi.mock('@/lib/tools/descriptions', () => ({ ensureToolDescriptions: vi.fn() }));
vi.mock('@/lib/tools/dispatch', () => ({ handleWebmcpCall: vi.fn() }));
vi.mock('@/lib/tools/registry', () => ({ listAllHandlers: vi.fn() }));

const allowedSender = { url: 'https://demos.aimatrx.com/demos/tests/extension-bridge' };

function envelope(action: string, payload: unknown = {}) {
  return {
    channel: FRONTEND_RPC_CHANNEL,
    action,
    payload,
    requestId: `req-${action}`,
  };
}

describe('frontend bridge handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.chrome as typeof chrome).runtime = {
      getManifest: () => ({ version: '9.8.7' }),
    } as typeof chrome.runtime;
    vi.mocked(readIsAdminFromStorage).mockResolvedValue(false);
    vi.mocked(readDefaultPermissionMode).mockResolvedValue('ask');
    vi.mocked(ensureToolDescriptions).mockResolvedValue(new Map());
    vi.mocked(listAllHandlers).mockReturnValue([]);
  });

  it('keeps the contractual envelope discriminator strict', () => {
    expect(FrontendRpcEnvelopeSchema.safeParse(envelope('ping')).success).toBe(true);
    expect(
      FrontendRpcEnvelopeSchema.safeParse({ ...envelope('ping'), channel: 'wrong' }).success,
    ).toBe(false);
  });

  it('answers ping with the installed extension version and request id', async () => {
    const response = await handleFrontendRpc(envelope('ping'), allowedSender);
    expect(response).toMatchObject({
      ok: true,
      requestId: 'req-ping',
      result: { pong: true, version: '9.8.7' },
    });
  });

  it('rejects a sender outside the manifest/runtime origin allowlist', async () => {
    const response = await handleFrontendRpc(envelope('ping'), {
      url: 'https://attacker.example/rpc',
    });
    expect(response).toEqual({
      ok: false,
      error: 'origin not allowed',
      requestId: 'req-ping',
    });
  });

  it('advertises only read/action tools available to the current user', async () => {
    vi.mocked(listAllHandlers).mockReturnValue([
      { name: 'read_page', tier: 'read', admin_only: false },
      { name: 'resize_window', tier: 'action', admin_only: true },
      { name: 'get_secret', tier: 'privileged', admin_only: false },
    ] as ReturnType<typeof listAllHandlers>);
    vi.mocked(ensureToolDescriptions).mockResolvedValue(
      new Map([['read_page', 'Read the active page']]),
    );

    const response = await handleFrontendRpc(envelope('capabilities'), allowedSender);
    expect(response).toEqual({
      ok: true,
      requestId: 'req-capabilities',
      result: {
        version: '9.8.7',
        tools: [
          {
            name: 'read_page',
            tier: 'read',
            description: 'Read the active page',
            admin_only: false,
          },
        ],
      },
    });
  });

  it('routes callTool through the normal permission-gated dispatcher', async () => {
    vi.mocked(readDefaultPermissionMode).mockResolvedValue('act');
    vi.mocked(handleWebmcpCall).mockResolvedValue({
      ok: true,
      result: { title: 'Bridge test' },
    });

    const response = await handleFrontendRpc(
      envelope('callTool', { toolName: 'get_active_tab', args: {} }),
      allowedSender,
    );

    expect(handleWebmcpCall).toHaveBeenCalledWith(
      {
        callId: 'frontend-req-callTool',
        toolName: 'get_active_tab',
        args: {},
      },
      { permissionMode: 'act', initiator: 'frontend' },
    );
    expect(response).toEqual({
      ok: true,
      result: { title: 'Bridge test' },
      requestId: 'req-callTool',
    });
  });

  it('returns structured failures for invalid payloads and unknown actions', async () => {
    await expect(
      handleFrontendRpc(envelope('callTool', { args: {} }), allowedSender),
    ).resolves.toMatchObject({ ok: false, requestId: 'req-callTool' });
    await expect(handleFrontendRpc(envelope('futureAction'), allowedSender)).resolves.toEqual({
      ok: false,
      error: 'unknown action: futureAction',
      requestId: 'req-futureAction',
    });
  });
});
