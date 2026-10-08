/** Agenda in package mode: the run is ONE send through the package chat (intercepted here — never a live AI call). */
import { describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => ({
  markRunStarted: vi.fn(async () => undefined),
  finishRun: vi.fn(async () => undefined),
  updateTask: vi.fn(async () => undefined),
  claimRun: vi.fn(),
}));
vi.mock('@/lib/agenda/queries', () => q);
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/messaging/native', () => ({ send: vi.fn(), on: vi.fn() }));
vi.mock('@/lib/chat-target', () => ({
  isPackageChatMode: () => true,
  sendThroughPackageChat: vi.fn(),
}));

import { runThroughPackageChat } from '@/lib/agenda/runner';

const task = (over: object) =>
  ({
    id: 't1',
    title: 'Weekly',
    prompt: 'Run the review',
    agent_id: 'agent-7',
    trigger_type: 'heartbeat',
    persistent_conversation_id: null,
    ...over,
  }) as never;
const run = { id: 'r1' } as never;

describe('runThroughPackageChat', () => {
  it('sends the prompt to the task agent through the chat door and finishes the run', async () => {
    const sent = vi.fn(async () => ({ conversationId: 'conv-1' }));
    expect(await runThroughPackageChat(task({}), run, sent)).toBe(run);
    expect(sent).toHaveBeenCalledWith({
      text: 'Run the review',
      agentId: 'agent-7',
      conversationId: null,
    });
    expect(q.markRunStarted).toHaveBeenCalledWith('r1', 'conv-1');
    expect(q.updateTask).toHaveBeenCalledWith('t1', { persistent_conversation_id: 'conv-1' });
    expect(q.finishRun).toHaveBeenCalledWith('r1', 'success');
  });

  it('a mandate ref goes as a mandate key; a persistent conversation is continued', async () => {
    const sent = vi.fn(async () => ({ conversationId: 'conv-9' }));
    await runThroughPackageChat(
      task({ agent_id: 'mandate:extend.browser_chat', persistent_conversation_id: 'conv-9' }),
      run,
      sent,
    );
    expect(sent).toHaveBeenCalledWith({
      text: 'Run the review',
      mandateKey: 'extend.browser_chat',
      conversationId: 'conv-9',
    });
  });

  it('a failed send marks the run failed', async () => {
    q.finishRun.mockClear();
    const sent = vi.fn(async () => {
      throw new Error('chat not open');
    });
    expect(await runThroughPackageChat(task({}), run, sent)).toBeNull();
    expect(q.finishRun).toHaveBeenCalledWith('r1', 'failed', { error_message: 'chat not open' });
  });
});
