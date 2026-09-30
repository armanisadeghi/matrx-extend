/**
 * A client-answered tool call must settle its own row the moment the server
 * accepts the answer — the server sends no completion event for a delegated
 * call. These tests drive the real timeline router and chat store.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routeToolTimelineEvent } from '@/hooks/use-tool-inbox';
import type { ApiResult } from '@/lib/api/client';
import type { ClientToolResultBody, ToolResultsResponse } from '@/lib/api/routes/tool-results';
import { useChatStore } from '@/state/chat';

import { type DeliverToolResultDeps, deliverToolResult } from './deliver-tool-result';

const CONV = 'conv-1';
const CALL = 'call-1';

function accepted(overrides: Partial<ToolResultsResponse> = {}): ApiResult<ToolResultsResponse> {
  return {
    ok: true,
    status: 200,
    data: {
      resolved: [CALL],
      already_resolved: [],
      not_found: [],
      continuation_needed: true,
      user_request_id: 'req-1',
      conversation_id: CONV,
      ...overrides,
    },
  } as ApiResult<ToolResultsResponse>;
}

/** Deps whose settle goes through the sidepanel's real router into the store. */
function deps(response: ApiResult<ToolResultsResponse>): DeliverToolResultDeps {
  return {
    post: vi.fn(async () => response),
    settle: (event) => routeToolTimelineEvent(event),
  };
}

function toolPart() {
  const message = useChatStore.getState().messages.find((m) => m.id === 'a1');
  const part = message?.parts?.find((p) => p.type === 'tool' && p.tool.callId === CALL);
  return part?.type === 'tool' ? part.tool : undefined;
}

const answer: ClientToolResultBody = {
  call_id: CALL,
  tool_name: 'read_page',
  output: { title: 'Pricing' },
  is_error: false,
  error_message: null,
};

beforeEach(() => {
  useChatStore.setState({
    selectedConversationId: CONV,
    messages: [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        conversationId: CONV,
        parts: [],
      },
    ],
  });
  // The row as the stream's `tool_delegated` left it.
  useChatStore
    .getState()
    .upsertToolPart('a1', CALL, { kind: 'client', toolName: 'read_page', phase: 'started' });
});

describe('deliverToolResult settles the row it answered', () => {
  it('moves a running row to completed when the server accepts the answer', async () => {
    const r = await deliverToolResult(CONV, answer, deps(accepted()));
    expect(r.delivered).toBe(true);
    expect(toolPart()?.phase).toBe('completed');
    expect(toolPart()?.result).toEqual({ title: 'Pricing' });
  });

  it('replaces a delivery error once a replay is accepted', async () => {
    // What postResult painted when the first POST exhausted its retries.
    routeToolTimelineEvent({
      callId: CALL,
      conversationId: CONV,
      toolName: 'read_page',
      phase: 'error',
      message: 'Network error reaching the AI server.',
    });
    expect(toolPart()?.phase).toBe('error');

    await deliverToolResult(CONV, answer, deps(accepted({ resolved: [], already_resolved: [] })));
    expect(toolPart()?.phase).toBe('completed');
  });

  it('settles an error answer as an error row with its message', async () => {
    await deliverToolResult(
      CONV,
      { ...answer, output: null, is_error: true, error_message: 'User denied this action' },
      deps(accepted()),
    );
    expect(toolPart()?.phase).toBe('error');
    expect(toolPart()?.message).toBe('User denied this action');
  });

  it('never marks a row done the server did not accept', async () => {
    const refused = {
      ok: false,
      status: 503,
      error: 'unavailable',
    } as ApiResult<ToolResultsResponse>;
    expect((await deliverToolResult(CONV, answer, deps(refused))).delivered).toBe(false);
    expect(toolPart()?.phase).toBe('started');

    const unknown = accepted({ resolved: [], not_found: [CALL] });
    expect((await deliverToolResult(CONV, answer, deps(unknown))).delivered).toBe(false);
    expect(toolPart()?.phase).toBe('started');
  });

  it('never downgrades a settled row when the same answer is settled twice', async () => {
    await deliverToolResult(CONV, answer, deps(accepted()));
    routeToolTimelineEvent({
      callId: CALL,
      conversationId: CONV,
      toolName: 'read_page',
      phase: 'started',
    });
    expect(toolPart()?.phase).toBe('completed');
  });
});

describe('the funnel is the only door to POST /tool_results', () => {
  it('no source file posts a tool result except the funnel', () => {
    const src = join(__dirname, '..', '..');
    const allowed = new Set(['lib/api/routes/tool-results.ts', 'lib/tools/deliver-tool-result.ts']);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        const rel = relative(src, path);
        if (allowed.has(rel)) continue;
        if (/\bpostToolResults\s*\(/.test(readFileSync(path, 'utf8'))) offenders.push(rel);
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
