/**
 * A channel that uses "nobody is listening" as its answer must not log that
 * as a failure. The agenda scanner asks whether the side panel is open once
 * a minute; a closed side panel painted a red ERROR in the debug feed every
 * time, for a state that is completely normal and fully handled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const debugLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
vi.mock('@/lib/debug/log', () => ({ log: debugLog }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  debugLog.warn.mockReset();
  debugLog.error.mockReset();
});

describe('send() when nobody is listening', () => {
  it('stays quiet when absence is the answer, and still reports it otherwise', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: async () => {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        },
      },
    });
    const { send } = await import('@/lib/messaging/native');

    await expect(send('agenda:run-now', {}, { absenceIsAnAnswer: true })).rejects.toThrow();
    expect(debugLog.error).not.toHaveBeenCalled();

    // A channel that did NOT opt in still surfaces the missing listener.
    await expect(send('tool:confirm-request', {})).rejects.toThrow();
    expect(debugLog.error).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on an undefined response when absence is the answer', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: async () => undefined } });
    const { send } = await import('@/lib/messaging/native');

    await expect(send('agenda:run-now', {}, { absenceIsAnAnswer: true })).resolves.toBeUndefined();
    expect(debugLog.warn).not.toHaveBeenCalled();

    await expect(send('tool:confirm-request', {})).resolves.toBeUndefined();
    expect(debugLog.warn).toHaveBeenCalledTimes(1);
  });
});
