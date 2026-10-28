import { useChatStore } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { afterEach, describe, expect, it, vi } from 'vitest';

const knob = vi.hoisted(() => ({ mode: 'ask' as 'ask' | 'act' }));
vi.mock('@/lib/settings/act-without-asking', () => ({
  readActMode: () => knob.mode,
  writeActMode: async () => ({ ok: true }),
}));

// The mode a run latches must equal what the header chip shows. Resume /
// Assistant and Pilot resolve their displayed and latched mode from the same
// platform knob, including resume / rejoin / cold-resume runs.
describe('permission mode resolver', () => {
  afterEach(() => {
    knob.mode = 'ask';
    useChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    usePilotChatStore.setState({ selectedAgentId: null, permissionMode: {} });
  });

  it('an Act choice is shared across surfaces and continuations', () => {
    knob.mode = 'act';
    useChatStore.setState({ selectedAgentId: 'agent-1', permissionMode: { 'agent-1': 'act' } });
    usePilotChatStore.setState({ selectedAgentId: 'p-1', permissionMode: { 'p-1': 'ask' } });
    expect(useChatStore.getState().getPermissionMode(null)).toBe('act');
    expect(usePilotChatStore.getState().getPermissionMode(null)).toBe('act');
  });

  it('an Ask choice is shared across surfaces despite old per-agent values', () => {
    knob.mode = 'ask';
    useChatStore.setState({ selectedAgentId: 'agent-1', permissionMode: { 'agent-1': 'act' } });
    usePilotChatStore.setState({ selectedAgentId: 'p-1', permissionMode: { 'p-1': 'act' } });
    expect(useChatStore.getState().getPermissionMode('agent-1')).toBe('ask');
    expect(usePilotChatStore.getState().getPermissionMode(null)).toBe('ask');
  });
});
