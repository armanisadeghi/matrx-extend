/**
 * Delegated browser-tool calls that outlive the side panel (package chat `deviceTools.handOff`).
 *
 * Break this catches: a hand-off that runs a tool the panel already started (a second click on the
 * page), a result that is lost when delivery fails, or a duplicate hand-off posting twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type DeviceHandOffDeps,
  handOffDeviceCalls,
  resetDeviceHandoffForTests,
  runDeviceToolOnce,
} from './device-handoff';

const CALL = {
  conversationId: 'conv-1',
  requestId: 'req-1',
  callId: 'call-1',
  toolName: 'click_element',
  args: { ref: 'e12' },
};

function deps(over: Partial<DeviceHandOffDeps> = {}): DeviceHandOffDeps {
  return {
    run: vi.fn(async () => ({ ok: true, result: { clicked: true } })),
    deliver: vi.fn(async () => ({ delivered: true, continuation: null })),
    enqueue: vi.fn(async () => undefined),
    continueRun: vi.fn(),
    report: vi.fn(),
    ...over,
  };
}

beforeEach(() => resetDeviceHandoffForTests());

describe('device tool hand-off', () => {
  it('joins the run the panel already started instead of running the tool again', async () => {
    let finish: (v: { ok: boolean; result: unknown }) => void = () => {};
    const started = vi.fn(
      () => new Promise<{ ok: boolean; result: unknown }>((resolve) => (finish = resolve)),
    );
    const panelRun = runDeviceToolOnce(CALL, started);
    const d = deps({ run: started });
    const handed = handOffDeviceCalls([CALL], d);
    finish({ ok: true, result: { clicked: true } });
    await panelRun;
    const out = await handed;
    expect(started).toHaveBeenCalledTimes(1);
    expect(d.deliver).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ call_id: 'call-1', tool_name: 'click_element', output: { clicked: true }, is_error: false }),
    );
    expect(out.delivered).toEqual(['call-1']);
  });

  it('runs a call that never began, then delivers it', async () => {
    const d = deps();
    await handOffDeviceCalls([CALL], d);
    expect(d.run).toHaveBeenCalledTimes(1);
    expect(d.deliver).toHaveBeenCalledTimes(1);
  });

  it('delivers a failed tool as an error result, never drops it', async () => {
    const d = deps({ run: vi.fn(async () => ({ ok: false, error: 'tab was closed' })) });
    await handOffDeviceCalls([CALL], d);
    expect(d.deliver).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ is_error: true, error_message: 'tab was closed' }),
    );
  });

  it('queues the result for replay when delivery fails', async () => {
    const d = deps({
      deliver: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const out = await handOffDeviceCalls([CALL], d);
    expect(d.enqueue).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      result: expect.objectContaining({ call_id: 'call-1' }),
    });
    expect(out.queued).toEqual(['call-1']);
  });

  it('a duplicate hand-off for the same call posts once', async () => {
    const d = deps();
    await handOffDeviceCalls([CALL], d);
    const second = await handOffDeviceCalls([CALL], d);
    expect(d.deliver).toHaveBeenCalledTimes(1);
    expect(second.duplicates).toEqual(['call-1']);
  });

  it('signals the continuation the server asked for', async () => {
    const d = deps({
      deliver: vi.fn(async () => ({
        delivered: true,
        continuation: { conversationId: 'conv-1', userRequestId: 'req-1' },
      })),
    });
    await handOffDeviceCalls([CALL], d);
    expect(d.continueRun).toHaveBeenCalledWith({ conversationId: 'conv-1', userRequestId: 'req-1' });
  });
});
