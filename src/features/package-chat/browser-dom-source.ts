/**
 * The browser itself as a package context source (`registry.contextSources`): every turn start
 * and resume the package chat declares the server's `browser-dom` capability with the SAME
 * `client.state["browser-dom"]` the extension's own chat builds (`buildBrowserDomState`), and
 * hands the package the tab the person sent from as the turn's device reference — so every
 * browser tool of that turn is pinned to it (`assignedTabId`), exactly as the old chat latches
 * it at STREAM_START. The ask/act mode on the wire is the package's per-agent choice.
 */

import { resolveActiveTab } from '@/lib/chat/active-tab';
import { buildBrowserDomState } from '@/lib/chat/build-browser-dom-state';
import { useActiveToolsStore } from '@/state/active-tools';
import { readDevicePermissionMode } from '@ai-matrx/chat/agents/redux/execution-system/utils/host-turn';
import type { ChatContextSource } from '@ai-matrx/chat/host';

/** What the package hands back to `deviceTools.invoke` for every call of the turn. */
export interface BrowserDeviceRef {
  tabId: number | null;
}

export function isBrowserDeviceRef(value: unknown): value is BrowserDeviceRef {
  return typeof value === 'object' && value !== null && 'tabId' in value;
}

export const browserDomContextSource: ChatContextSource = {
  id: 'matrx-extend:browser-dom',
  async contribute({ conversationId, agentId }) {
    const activeTab = await resolveActiveTab();
    const state = await buildBrowserDomState({
      surface: 'assistant',
      ...(agentId ? { agentId } : {}),
      loadedCategories: useActiveToolsStore.getState().getLoaded(conversationId),
      activeTab,
    });
    const deviceRef: BrowserDeviceRef = { tabId: state.current_tab_id ?? null };
    return {
      capabilities: {
        'browser-dom': {
          ...(state as unknown as Record<string, unknown>),
          permission_mode: readDevicePermissionMode(agentId),
        },
      },
      deviceRef,
    };
  },
};
