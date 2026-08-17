import { describe, expect, it } from 'vitest';

import { createTaskChannelTopic } from '@/state/lists';

describe('createTaskChannelTopic', () => {
  it('gives strict-mode remounts distinct realtime topics for the same conversation', () => {
    const conversationId = 'a0889640-3df7-46cc-8f90-cb558cbccb45';
    const first = createTaskChannelTopic(conversationId);
    const remount = createTaskChannelTopic(conversationId);

    expect(first).toMatch(new RegExp(`^chat-agent-task:${conversationId}:[0-9a-f-]{36}$`));
    expect(remount).toMatch(new RegExp(`^chat-agent-task:${conversationId}:[0-9a-f-]{36}$`));
    expect(remount).not.toBe(first);
  });
});
