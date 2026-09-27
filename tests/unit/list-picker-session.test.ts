import { mountListPicker, unmountListPicker } from '@/lib/data-pattern/list-picker';
import {
  cancelListPickerSession,
  startListPickerSession,
} from '@/lib/data-pattern/list-picker-session';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A music-calendar editor selects the event title from repeating venue cards.
const sendMessage = vi.fn(
  async (_message: { kind: string; payload: { session_id?: string } | null }) => ({ ack: true }),
);
beforeEach(() => {
  document.body.innerHTML = `<main><section class="events">
    <article class="event"><h2>Neon Nights at Area15</h2></article>
    <article class="event"><h2>Desert Pulse at Downtown Events</h2></article>
    <article class="event"><h2>Skyline Sessions at The Roof</h2></article>
  </section></main>`;
  Object.assign(chrome, { runtime: { sendMessage } });
  sendMessage.mockClear();
});
afterEach(() => {
  unmountListPicker();
  document.body.innerHTML = '';
});

function clickCard() {
  document
    .querySelector('article')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
function clickOverlay(id: string) {
  const shadow = document.getElementById('matrx-list-picker-host')?.shadowRoot;
  shadow
    ?.querySelector(id)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: false }));
}

describe('list picker producer session boundary', () => {
  it('carries the initiating identity in detection, result, and exit messages', () => {
    mountListPicker('calendar-session');
    clickCard();
    clickOverlay('#done');
    mountListPicker('replacement-session');
    clickOverlay('#cancel');
    expect(
      sendMessage.mock.calls.map(([message]) => [message.kind, message.payload?.session_id]),
    ).toEqual([
      ['data:list-picker-item-detected', 'calendar-session'],
      ['data:list-picker-result', 'calendar-session'],
      ['data:list-picker-exit', 'replacement-session'],
    ]);
  });

  it('ignores a cancellation targeted at a replaced session', () => {
    mountListPicker('calendar-session');
    mountListPicker('replacement-session');
    const pickerWindow = window as typeof window & {
      __matrxListPickerCancel?: (sessionId: string) => void;
    };
    pickerWindow.__matrxListPickerCancel?.('calendar-session');
    clickCard();
    expect(sendMessage.mock.calls.map(([message]) => message.kind)).toEqual([
      'data:list-picker-item-detected',
    ]);
    pickerWindow.__matrxListPickerCancel?.('replacement-session');
    expect(document.getElementById('matrx-list-picker-host')).toBeNull();
    expect(sendMessage.mock.calls.at(-1)?.[0].kind).toBe('data:list-picker-exit');
  });

  it('tears down the previous content context before installing a new one', async () => {
    mountListPicker('calendar-session');
    vi.resetModules();
    const replacement = await import('@/lib/data-pattern/list-picker');
    replacement.mountListPicker('replacement-session');
    try {
      clickCard();
      expect(
        sendMessage.mock.calls.filter(
          ([message]) => message.kind === 'data:list-picker-item-detected',
        ),
      ).toHaveLength(1);
    } finally {
      replacement.unmountListPicker();
    }
    const normalClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('article')?.dispatchEvent(normalClick);
    expect(normalClick.defaultPrevented).toBe(false);
  });

  it('orders a pending installation before cancellation and the replacement start', async () => {
    let releaseInstall: (() => void) | undefined;
    let installCount = 0;
    Object.assign(window, { __matrxListPickerStart: mountListPicker });
    Object.assign(chrome, {
      scripting: {
        executeScript: vi.fn(
          async (request: {
            files?: string[];
            func?: (...args: string[]) => void;
            args?: string[];
          }) => {
            if (request.files && ++installCount === 1) {
              await new Promise<void>((resolve) => {
                releaseInstall = resolve;
              });
            }
            request.func?.(...(request.args ?? []));
            return [];
          },
        ),
      },
    });
    const first = startListPickerSession(77, 'calendar-session');
    await vi.waitFor(() => expect(releaseInstall).toBeTypeOf('function'));
    const canceled = cancelListPickerSession(77, 'calendar-session');
    const second = startListPickerSession(77, 'replacement-session');
    releaseInstall?.();
    await Promise.all([first, canceled, second]);
    sendMessage.mockClear();
    clickCard();
    expect(
      sendMessage.mock.calls.map(([message]) => [message.kind, message.payload?.session_id]),
    ).toEqual([['data:list-picker-item-detected', 'replacement-session']]);
  });
});
