import { afterEach, describe, expect, it, vi } from 'vitest';
import { networkTapMain, type CapturedNetEvent } from '@/lib/data-pattern/network-tap';
const runNetworkCapturePattern = async (..._args: unknown[]) => [{ title: 'Tonight at Pier Hall' }];
const bus = vi.hoisted(() => ({ listener: null as null | ((event: CapturedNetEvent) => unknown) }));
vi.mock('@/lib/messaging/native', () => ({
  on: (_channel: string, fn: (event: CapturedNetEvent) => unknown) => {
    bus.listener = fn;
    return () => {
      bus.listener = null;
    };
  },
  send: vi.fn(),
}));
const originalFetch = window.fetch;
const originalXHR = window.XMLHttpRequest;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.fetch = originalFetch;
  window.XMLHttpRequest = originalXHR;
  Reflect.deleteProperty(window, '__matrx_net_tap_installed__');
  document.querySelector('base')?.remove();
  bus.listener = null;
});
// Use case: an event-calendar researcher saves a selected API list to refresh it later.
const response = (title: string, extra: Partial<CapturedNetEvent> = {}): CapturedNetEvent => ({
  ts_ms: 1726000000000,
  source: 'fetch',
  method: 'GET',
  url: 'https://electronic.vegas/api/events?date=2026-09-27',
  status: 200,
  body: JSON.stringify({ events: [{ title }] }),
  body_truncated: false,
  body_size: 64,
  content_type: 'application/json',
  tab_id: 37,
  request_body_key: 'none',
  request_sequence: 1,
  ...extra,
});
function replay(config: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  let updated: ((id: number, info: chrome.tabs.TabChangeInfo) => void) | undefined;
  const removeListener = vi.fn();
  Object.assign(chrome, {
    tabs: {
      onUpdated: {
        addListener: (fn: typeof updated) => {
          updated = fn;
        },
        removeListener,
      },
      reload: vi.fn(async () => {}),
    },
    scripting: { executeScript: vi.fn(async () => []) },
  });
  const result = runNetworkCapturePattern(
    {
      url_filter: response('').url,
      method: 'GET',
      key_path: 'events',
      body_match: 'ignore',
      ...config,
    },
    37,
    { initiation: 'user', timeoutMs: 5000 },
  );
  // Attach rejection immediately so deliberately asynchronous errors stay handled.
  const outcome = result.then(
    (rows) => ({ rows }),
    (error) => ({ error: String(error) }),
  );
  return { outcome, loading: () => updated?.(37, { status: 'loading' }), removeListener };
}
describe('Network replay integrity', () => {
  it('reports distinct matching rowsets, including a later response beyond the old settle window', async () => {
    const run = replay();
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(response('Tonight at Pier Hall'));
    await vi.advanceTimersByTimeAsync(3000);
    bus.listener?.(
      response('Tomorrow at Harbor Hall', { body_size: 300, request_body_key: 'sha256:other' }),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(await run.outcome).toEqual({
      error: expect.stringMatching(/different.*(rows|data)|ambiguous/i),
    });
    expect(bus.listener).toBeNull();
    expect(run.removeListener).toHaveBeenCalled();
  });
  it('deduplicates identical selected arrays despite unrelated envelope changes', async () => {
    const run = replay();
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(response('Tonight at Pier Hall'));
    bus.listener?.(
      response('', { body: '{"refreshed":true,"events":[{"title":"Tonight at Pier Hall"}]}' }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ rows: [{ title: 'Tonight at Pier Hall' }] });
  });
  it('matches the saved POST body identity while allowing its response data to change', async () => {
    const run = replay({
      method: 'POST',
      body_match: 'exact',
      request_body_key: 'sha256:calendar',
    });
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(
      response('Current calendar', { method: 'POST', request_body_key: 'sha256:calendar' }),
    );
    bus.listener?.(
      response('Different calendar query', {
        method: 'POST',
        request_body_key: 'sha256:venues',
        body_size: 999,
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ rows: [{ title: 'Current calendar' }] });
  });
  it('uses the newest request of the same identity, not the largest or last completed response', async () => {
    const run = replay({
      method: 'POST',
      body_match: 'exact',
      request_body_key: 'sha256:calendar',
    });
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(
      response('Updated calendar', {
        method: 'POST',
        request_body_key: 'sha256:calendar',
        request_sequence: 3,
      }),
    );
    bus.listener?.(
      response('Older calendar', {
        method: 'POST',
        request_body_key: 'sha256:calendar',
        request_sequence: 2,
        body_size: 999,
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ rows: [{ title: 'Updated calendar' }] });
  });
  it('does not consume a response from the old document before reload starts', async () => {
    const run = replay();
    bus.listener?.(response('Old page results', { body_size: 999 }));
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(response('Current page results'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ rows: [{ title: 'Current page results' }] });
  });
  it('does not treat a complete-looking truncated response as a complete result', async () => {
    const run = replay();
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(response('Incomplete calendar', { body_truncated: true }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ error: expect.stringMatching(/truncat/i) });
  });
  it('retains explicit broader partial URL matching', async () => {
    const run = replay({ url_filter: 'https://electronic.vegas/api/events', url_match: 'filter' });
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(response('Selected date'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ rows: [{ title: 'Selected date' }] });
  });
  it('keeps a literal star in an exact selected request URL', async () => {
    const run = replay({
      url_filter: 'https://electronic.vegas/api/events?tag=*',
      url_match: 'exact',
    });
    run.loading();
    await vi.advanceTimersByTimeAsync(0);
    bus.listener?.(response('All tags', { url: 'https://electronic.vegas/api/events?tag=*' }));
    bus.listener?.(
      response('Jazz only', {
        url: 'https://electronic.vegas/api/events?tag=jazz',
        body_size: 999,
      }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run.outcome).toEqual({ rows: [{ title: 'All tags' }] });
  });
});
describe('Network capture request identity', () => {
  it('emits only a stable digest for POST payloads and distinguishes different operations', async () => {
    window.fetch = vi.fn(async () => new Response('{"events":[]}'));
    const posted = vi.spyOn(window, 'postMessage');
    networkTapMain();
    await window.fetch('https://electronic.vegas/api/query', {
      method: 'POST',
      body: 'calendar=events',
    });
    await window.fetch(
      new Request('https://electronic.vegas/api/query', {
        method: 'POST',
        body: 'calendar=events',
      }),
    );
    await window.fetch('https://electronic.vegas/api/query', {
      method: 'POST',
      body: 'calendar=venues',
    });
    await vi.waitFor(() => expect(posted).toHaveBeenCalledTimes(3));
    const events = posted.mock.calls
      .map((call) => call[0].event)
      .sort((a, b) => a.request_sequence - b.request_sequence);
    expect(events.map((event) => event.request_body_key)).toEqual([
      'sha256:78c2d68576e5155ca2fc19a548a5fdda207bdc29e87e154cea6808b7f5d27bd9',
      'sha256:78c2d68576e5155ca2fc19a548a5fdda207bdc29e87e154cea6808b7f5d27bd9',
      'sha256:7951f1779b63a732d0cf1b1f937689f20c06f45031ec3bdc1e50e492251e97b1',
    ]);
    expect(JSON.stringify(events)).not.toContain('calendar=');
    expect(
      events.every((event) => !('request_headers' in event) && !('request_body' in event)),
    ).toBe(true);
  });
  it('hashes supported binary and form-urlencoded payloads, while multipart stays explicitly unavailable', async () => {
    window.fetch = vi.fn(async () => new Response('{"events":[]}'));
    const posted = vi.spyOn(window, 'postMessage');
    networkTapMain();
    const form = new FormData();
    form.append('calendar', 'events');
    for (const body of [
      new URLSearchParams('calendar=events'),
      new Blob(['calendar=events']),
      new TextEncoder().encode('calendar=events'),
      form,
    ]) {
      await window.fetch('https://electronic.vegas/api/query', { method: 'POST', body });
    }
    await vi.waitFor(() => expect(posted).toHaveBeenCalledTimes(4));
    const keys = posted.mock.calls
      .map((call) => call[0].event)
      .sort((a, b) => a.request_sequence - b.request_sequence)
      .map((event) => event.request_body_key);
    expect(keys).toEqual([
      'sha256:78c2d68576e5155ca2fc19a548a5fdda207bdc29e87e154cea6808b7f5d27bd9',
      'sha256:78c2d68576e5155ca2fc19a548a5fdda207bdc29e87e154cea6808b7f5d27bd9',
      'sha256:78c2d68576e5155ca2fc19a548a5fdda207bdc29e87e154cea6808b7f5d27bd9',
      'unavailable',
    ]);
  });
  it('normalizes relative XHR URLs and captures JSON responseType', async () => {
    const base = document.createElement('base');
    base.href = 'https://electronic.vegas/calendar/';
    document.head.append(base);
    class PageXHR extends EventTarget {
      responseType = 'json';
      response = { events: [{ title: 'Pier Hall' }] };
      status = 200;
      statusText = 'OK';
      open() {}
      getAllResponseHeaders() {
        return 'content-type: application/json';
      }
    }
    Object.defineProperty(window, 'XMLHttpRequest', {
      value: PageXHR,
      configurable: true,
      writable: true,
    });
    const posted = vi.spyOn(window, 'postMessage');
    networkTapMain();
    const xhr = new window.XMLHttpRequest();
    xhr.open('get', '../api/events?id=123');
    xhr.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(posted.mock.calls[0]?.[0].event).toMatchObject({
      url: 'https://electronic.vegas/api/events?id=123',
      method: 'GET',
      body: '{"events":[{"title":"Pier Hall"}]}',
    });
  });
  it('normalizes relative, URL and Request inputs and honors Request init method overrides', async () => {
    const base = document.createElement('base');
    base.href = 'https://electronic.vegas/calendar/';
    document.head.append(base);
    window.fetch = vi.fn(async () => new Response('{"events":[]}'));
    const posted = vi.spyOn(window, 'postMessage');
    networkTapMain();
    await window.fetch('../api/events?id=12%2F3');
    await window.fetch(new URL('https://electronic.vegas/api/events?id=123'));
    await window.fetch(new Request('https://electronic.vegas/api/events', { method: 'POST' }), {
      method: 'PUT',
    });
    await vi.waitFor(() => expect(posted).toHaveBeenCalledTimes(3));
    expect(
      posted.mock.calls
        .map((call) => call[0].event)
        .sort((a, b) => a.request_sequence - b.request_sequence)
        .map((event) => ({ url: event.url, method: event.method })),
    ).toEqual([
      { url: 'https://electronic.vegas/api/events?id=12%2F3', method: 'GET' },
      { url: 'https://electronic.vegas/api/events?id=123', method: 'GET' },
      { url: 'https://electronic.vegas/api/events', method: 'PUT' },
    ]);
  });
});
