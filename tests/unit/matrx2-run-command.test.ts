/** desktop_run_command runs a Matrx 2 operation when Matrx 2 is connected, else Matrx Local. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  client: null as null | { request: ReturnType<typeof vi.fn> },
  transport: 'none' as 'none' | 'http',
  rpc: vi.fn(),
}));

vi.mock('@/lib/desktop/matrx2/connection', () => ({ getMatrx2Client: () => m.client }));
vi.mock('@/lib/desktop/bridge', () => ({
  getDesktopState: () => ({ transport: m.transport }),
  desktopRpc: m.rpc,
}));

import { desktop_run_command } from '@/lib/tools/handlers/privileged';

const ctx = {} as never;

describe('desktop_run_command', () => {
  beforeEach(() => {
    m.client = null;
    m.transport = 'none';
    m.rpc.mockReset();
  });

  it('runs a Matrx 2 operation over the paired socket', async () => {
    m.client = { request: vi.fn(async () => ({ entries: [] })) };
    const out = await desktop_run_command.run({ command: 'fs.list', args: { path: '~' } }, ctx);
    expect(m.client.request).toHaveBeenCalledWith('fs.list', { path: '~' });
    expect(out).toEqual({ ok: true, data: { entries: [] }, via: 'matrx2' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('reports a Matrx 2 refusal in its own words', async () => {
    m.client = {
      request: vi.fn(async () => Promise.reject(new Error('Path is outside the allowed roots'))),
    };
    const out = await desktop_run_command.run({ command: 'fs.list', args: { path: '/' } }, ctx);
    expect(out).toEqual({
      ok: false,
      reason: 'Matrx 2: Path is outside the allowed roots',
      via: 'matrx2',
    });
  });

  it('a Matrx Local command still goes to Matrx Local', async () => {
    m.client = { request: vi.fn() };
    m.transport = 'http';
    m.rpc.mockResolvedValue({ ok: true, data: 'pong' });
    const out = await desktop_run_command.run({ command: 'ping' }, ctx);
    expect(m.client.request).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, data: 'pong' });
  });

  it('with neither app, says how to fix it', async () => {
    const out = await desktop_run_command.run({ command: 'fs.list' }, ctx);
    expect(out).toMatchObject({ ok: false, reason: expect.stringContaining('open Matrx 2') });
  });
});
