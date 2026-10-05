import { useChatStore } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useSettingsStore } from '@/state/settings';
import { afterEach, describe, expect, it } from 'vitest';

// The mode a run latches must equal what the header chip shows. Resume /
// rejoin / cold-resume runs call getPermissionMode(null); a hard 'ask' there
// forced approval cards after the first tool round with "Act" selected.
describe('permission mode resolver', () => {
  afterEach(() => {
    useChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    usePilotChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    useSettingsStore.setState({ defaultPermissionMode: 'ask' });
  });

  it("continuation runs (no agent id) use the selected agent's Act choice", () => {
    useChatStore.setState({ selectedAgentId: 'agent-1', permissionMode: { 'agent-1': 'act' } });
    expect(useChatStore.getState().getPermissionMode(null)).toBe('act');
  });

  it('falls back to the Settings default the chip displays', () => {
    useSettingsStore.setState({ defaultPermissionMode: 'act' });
    useChatStore.setState({ selectedAgentId: 'agent-1', permissionMode: {} });
    expect(useChatStore.getState().getPermissionMode('agent-1')).toBe('act');
    expect(useChatStore.getState().getPermissionMode(null)).toBe('act');
  });

  it('an explicit per-agent Ask still wins over an Act default', () => {
    useSettingsStore.setState({ defaultPermissionMode: 'act' });
    useChatStore.setState({ selectedAgentId: 'agent-1', permissionMode: { 'agent-1': 'ask' } });
    expect(useChatStore.getState().getPermissionMode(null)).toBe('ask');
  });

  it("pilot continuations honor the selected agent's Ask choice", () => {
    usePilotChatStore.setState({ selectedAgentId: 'p-1', permissionMode: { 'p-1': 'ask' } });
    expect(usePilotChatStore.getState().getPermissionMode(null)).toBe('ask');
  });
});
