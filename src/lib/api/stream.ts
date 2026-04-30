/**
 * Streaming client. Two parsers:
 *   - 'text-chunks': simple SSE with text deltas (matches /ai/chat/unified)
 *   - 'rich-events': SSE with typed JSON events (matches /ai/agent/execute, /scraper/*, /research/*)
 *
 * IMPORTANT: long-running streams MUST run inside the offscreen document
 * because the SW can be terminated mid-stream. The side panel proxies
 * stream:start → background → offscreen, and receives stream:chunk back.
 *
 * The functions in THIS module are pure stream consumers — they're called
 * from offscreen/main.ts. The orchestration lives in
 * src/lib/stream/offscreen-proxy.ts (SW side) and entrypoints/offscreen/main.ts.
 */

import { getApiBaseUrl } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'event'; event: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface StreamOptions {
  endpoint: string;
  body?: unknown;
  parser: 'text-chunks' | 'rich-events';
  signal?: AbortSignal;
  onEvent: (e: StreamEvent) => void;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function streamFetch(opts: StreamOptions): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${opts.endpoint}`;
  const headers = await buildHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    opts.onEvent({ type: 'error', message: `${res.status}: ${errText}` });
    opts.onEvent({ type: 'done' });
    return;
  }
  const reader = res.body?.getReader();
  if (!reader) {
    opts.onEvent({ type: 'error', message: 'No response body' });
    opts.onEvent({ type: 'done' });
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (opts.parser === 'text-chunks') {
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const content =
              (parsed.content as string | undefined) ??
              (parsed.text as string | undefined) ??
              (parsed.delta as string | undefined) ??
              '';
            if (content) opts.onEvent({ type: 'text', content });
          } catch {
            opts.onEvent({ type: 'text', content: data });
          }
        } else {
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            opts.onEvent({ type: 'event', event: parsed });
          } catch {
            opts.onEvent({ type: 'event', event: { raw: data } });
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Caller cancelled; treat as done without error.
    } else {
      opts.onEvent({ type: 'error', message: (err as Error).message });
    }
  } finally {
    opts.onEvent({ type: 'done' });
  }
}
