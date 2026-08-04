/**
 * Unit tests for triggerColdResume (src/lib/chat/cold-resume.ts).
 *
 * Cold-resume re-surfaces a paused conversation's outstanding client-delegated
 * tool calls on reopen by handing each one to the SW via COLD_RESUME_CALL. These
 * cover the discovery → per-call hand-off mapping, the run context it supplies in
 * place of a live STREAM_START (active tab + permission mode), and the
 * one-bad-hand-off-can't-abort-the-rest contract. See docs/COLD_RESUME.md.
 */

import type { PendingCall } from '@/lib/api/routes/tool-results';
import { CHANNELS } from '@/lib/messaging/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getPendingCalls = vi.fn();
const send = vi.fn();
const resolveActiveTab = vi.fn();
const getPermissionMode = vi.fn();

vi.mock('@/lib/api/routes/tool-results', () => ({
  getPendingCalls: (...args: unknown[]) => getPendingCalls(...args),
}));
vi.mock('@/lib/messaging/native', () => ({
  send: (...args: unknown[]) => send(...args),
}));
vi.mock('@/lib/chat/active-tab', () => ({
  resolveActiveTab: (...args: unknown[]) => resolveActiveTab(...args),
}));
vi.mock('@/state/chat', () => ({
  useChatStore: { getState: () => ({ getPermissionMode }) },
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

// Imported after the mocks are registered.
import { triggerColdResume } from '@/lib/chat/cold-resume';

function pendingCall(overrides: Partial<PendingCall> = {}): PendingCall {
  return {
    id: 'row-1',
    call_id: 'call-1',
    conversation_id: 'conv-1',
    user_request_id: 'req-1',
    message_id: 'msg-1',
    tool_name: 'click_element',
    arguments: { ref: 'ref:3' },
    iteration: 0,
    created_at: null,
    expires_at: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('triggerColdResume', () => {
  it('returns 0 without an id and never touches the network', async () => {
    expect(await triggerColdResume('')).toBe(0);
    expect(getPendingCalls).not.toHaveBeenCalled();
  });

  it('returns 0 when there are no pending calls', async () => {
    getPendingCalls.mockResolvedValue({ ok: true, data: [] });
    expect(await triggerColdResume('conv-1')).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 0 and dispatches nothing when discovery fails', async () => {
    getPendingCalls.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    expect(await triggerColdResume('conv-1')).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('hands each pending call to the SW with the resolved tab + permission mode', async () => {
    getPendingCalls.mockResolvedValue({
      ok: true,
      data: [
        pendingCall({ call_id: 'call-1', tool_name: 'click_element', arguments: { ref: 'ref:3' } }),
        pendingCall({ call_id: 'call-2', tool_name: 'take_screenshot', arguments: {} }),
      ],
    });
    resolveActiveTab.mockResolvedValue({ id: 42 });
    getPermissionMode.mockReturnValue('act');
    send.mockResolvedValue({ ack: true });

    const dispatched = await triggerColdResume('conv-1');

    expect(dispatched).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, CHANNELS.COLD_RESUME_CALL, {
      conversationId: 'conv-1',
      userRequestId: 'req-1',
      callId: 'call-1',
      toolName: 'click_element',
      args: { ref: 'ref:3' },
      permissionMode: 'act',
      assignedTabId: 42,
    });
    expect(send).toHaveBeenNthCalledWith(
      2,
      CHANNELS.COLD_RESUME_CALL,
      expect.objectContaining({
        callId: 'call-2',
        toolName: 'take_screenshot',
        args: {},
        assignedTabId: 42,
      }),
    );
  });

  it('falls back to null tab + empty args defensively', async () => {
    getPendingCalls.mockResolvedValue({
      ok: true,
      data: [pendingCall({ arguments: undefined as unknown as Record<string, unknown> })],
    });
    resolveActiveTab.mockResolvedValue(undefined);
    getPermissionMode.mockReturnValue('ask');
    send.mockResolvedValue({ ack: true });

    await triggerColdResume('conv-1');

    expect(send).toHaveBeenCalledWith(
      CHANNELS.COLD_RESUME_CALL,
      expect.objectContaining({ assignedTabId: null, args: {} }),
    );
  });

  it('one failed hand-off does not abort the others', async () => {
    getPendingCalls.mockResolvedValue({
      ok: true,
      data: [
        pendingCall({ call_id: 'call-1' }),
        pendingCall({ call_id: 'call-2' }),
        pendingCall({ call_id: 'call-3' }),
      ],
    });
    resolveActiveTab.mockResolvedValue({ id: 7 });
    getPermissionMode.mockReturnValue('ask');
    send
      .mockResolvedValueOnce({ ack: true })
      .mockRejectedValueOnce(new Error('no listener'))
      .mockResolvedValueOnce({ ack: true });

    const dispatched = await triggerColdResume('conv-1');

    expect(dispatched).toBe(2);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
