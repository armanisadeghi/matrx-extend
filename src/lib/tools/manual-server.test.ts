import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getManualServerToolDefinition, runManualServerTool } from './manual-server';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  headers: vi.fn(),
  stream: vi.fn(),
  hold: vi.fn(),
  token: 'token' as string | null,
  organizationId: 'org' as string | null,
}));
vi.mock('@/lib/api/client', () => ({
  apiGet: (...args: unknown[]) => h.get(...args),
  buildHeaders: (...args: unknown[]) => h.headers(...args),
  getApiBaseUrl: async () => 'https://server.invalid/api',
  readSessionBearer: async () => h.token,
}));
vi.mock('@/lib/api/stream', () => ({ streamFetch: (...args: unknown[]) => h.stream(...args) }));
vi.mock('@/lib/auth/flow', () => ({ getAccessToken: async () => h.token }));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => h.organizationId }));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: (...args: unknown[]) => h.hold(...args),
}));

describe('manual server tool contract', () => {
  beforeEach(() => {
    h.get.mockReset();
    h.token = 'token';
    h.organizationId = 'org';
    h.hold.mockReset().mockImplementation(async () => h.organizationId);
    h.headers.mockReset().mockImplementation(async (_extra, actor) => ({
      Authorization: `Bearer ${actor.token}`,
      'X-Organization-Id': actor.organizationId,
    }));
    h.stream.mockReset();
  });

  it('reads only active registry tools and keeps the per-action variants whole', async () => {
    const parameters = {
      action: { enum: ['guide', 'form_propose'] },
      $variants: { form_propose: { fields: { required: true } } },
    };
    h.get.mockResolvedValue({ ok: true, data: { tools: [{ name: 'records', parameters }] } });
    await expect(getManualServerToolDefinition('records')).resolves.toMatchObject({ parameters });
    expect(h.get).toHaveBeenCalledWith('/tools/test/list');
    await expect(getManualServerToolDefinition('absent')).rejects.toThrow('unavailable');
  });

  it('sends the canonical envelope and returns the completed server receipt', async () => {
    h.stream.mockImplementation(async ({ url, headers, body, onEvent }) => {
      expect(url).toBe('https://server.invalid/api/tools/test/execute');
      expect(headers['X-Organization-Id']).toBe('org');
      expect(body).toEqual({
        tool_name: 'records',
        arguments: { action: 'form_propose', args: { title: 'Intake' } },
      });
      onEvent({
        type: 'event',
        eventName: 'completion',
        data: {
          operation: 'tool_execution',
          result: { full_result: { success: true, output: { form_id: 'f1' } } },
        },
      });
      onEvent({ type: 'done' });
    });
    await expect(
      runManualServerTool('records', { action: 'form_propose', args: { title: 'Intake' } }),
    ).resolves.toEqual({ success: true, output: { form_id: 'f1' } });
    expect(h.hold).toHaveBeenCalledTimes(1);
  });

  it('holds the exact submitted call until the person chooses an organization', async () => {
    h.organizationId = null;
    let choose: (organizationId: string) => void = () => {};
    h.hold.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          choose = resolve;
        }),
    );
    h.stream.mockImplementation(async ({ body, headers, onEvent }) => {
      expect(headers['X-Organization-Id']).toBe('chosen-org');
      expect(body.arguments).toEqual({ action: 'record_write', args: { values: { name: 'A' } } });
      onEvent({
        type: 'event',
        eventName: 'completion',
        data: { operation: 'tool_execution', result: { full_result: { success: true } } },
      });
    });
    const pending = runManualServerTool('records', {
      action: 'record_write',
      args: { values: { name: 'A' } },
    });
    await vi.waitFor(() => expect(h.hold).toHaveBeenCalledTimes(1));
    expect(h.stream).not.toHaveBeenCalled();
    h.organizationId = 'chosen-org';
    choose('chosen-org');
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the actor after an identity change before dispatch', async () => {
    h.headers.mockImplementationOnce(async (_extra, actor) => {
      h.token = 'fresh-token';
      return { Authorization: `Bearer ${actor.token}`, 'X-Organization-Id': actor.organizationId };
    });
    h.stream.mockImplementation(async ({ headers, onEvent }) => {
      expect(headers.Authorization).toBe('Bearer fresh-token');
      onEvent({
        type: 'event',
        eventName: 'completion',
        data: { operation: 'tool_execution', result: { full_result: { success: true } } },
      });
    });
    await expect(
      runManualServerTool('records', { action: 'guide', args: {} }),
    ).resolves.toMatchObject({ success: true });
    expect(h.headers).toHaveBeenCalledTimes(2);
  });

  it('surfaces a stream refusal and refuses a missing completion', async () => {
    h.stream.mockImplementationOnce(async ({ onEvent }) =>
      onEvent({ type: 'error', message: 'Denied' }),
    );
    await expect(runManualServerTool('records', { action: 'guide', args: {} })).rejects.toThrow(
      'Denied',
    );
    h.stream.mockImplementationOnce(async ({ onEvent }) => onEvent({ type: 'done' }));
    await expect(runManualServerTool('records', { action: 'guide', args: {} })).rejects.toThrow(
      'did not return',
    );
  });
});
