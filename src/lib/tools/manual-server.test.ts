import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getManualServerToolDefinition, runManualServerTool } from './manual-server';

const h = vi.hoisted(() => ({ get: vi.fn(), headers: vi.fn(), stream: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  apiGet: (...args: unknown[]) => h.get(...args),
  buildHeaders: (...args: unknown[]) => h.headers(...args),
  getApiBaseUrl: async () => 'https://server.invalid/api',
}));
vi.mock('@/lib/api/stream', () => ({ streamFetch: (...args: unknown[]) => h.stream(...args) }));

describe('manual server tool contract', () => {
  beforeEach(() => {
    h.get.mockReset();
    h.headers
      .mockReset()
      .mockResolvedValue({ Authorization: 'Bearer token', 'X-Organization-Id': 'org' });
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
