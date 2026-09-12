import { handleWebmcpCall } from '@/lib/tools/dispatch';
import type { AnyToolHandler } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// SUT owns parsing and permission routing. Only registered execution and
// outbound receipt/message transports are doubled; the dispatcher stays real.
const deps = vi.hoisted(() => ({ lookup: vi.fn(), run: vi.fn(), broadcast: vi.fn() }));
vi.mock('@/lib/tools/registry', () => ({ lookup: deps.lookup, allToolNames: () => [] }));
vi.mock('@/lib/messaging/native', () => ({ broadcast: deps.broadcast, on: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn() }));

describe('external dispatcher effective permission tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.run.mockResolvedValue({ status: 'executed' });
    const argsSchema = z.object({ action: z.enum(['read', 'privileged', 'ask-user']) });
    const handler: AnyToolHandler = {
      name: 'test_dynamic_tier',
      tier: 'read',
      argsSchema,
      tierFor: (args) => argsSchema.parse(args).action,
      run: deps.run,
    };
    deps.lookup.mockReturnValue(handler);
  });

  it.each(['privileged', 'ask-user'] as const)(
    'refuses an argument-selected %s action before executing the handler',
    async (action) => {
      const result = await handleWebmcpCall(
        { callId: 'external-tier-test', toolName: 'test_dynamic_tier', args: { action } },
        { permissionMode: 'act', initiator: 'desktop' },
      );
      expect(result.ok).toBe(false);
      expect(deps.run).not.toHaveBeenCalled();
      expect(deps.broadcast).not.toHaveBeenCalled();
    },
  );

  it('executes a parsed read action once and returns its result', async () => {
    const result = await handleWebmcpCall(
      { callId: 'external-tier-test', toolName: 'test_dynamic_tier', args: { action: 'read' } },
      { permissionMode: 'act', initiator: 'desktop' },
    );
    expect(result).toEqual({ ok: true, result: { status: 'executed' } });
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run.mock.calls[0]?.[0]).toEqual({ action: 'read' });
  });
});
