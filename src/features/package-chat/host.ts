/**
 * The extension's host for `@ai-matrx/chat` (W1/W2): the one Supabase client
 * (token-only — `accessToken` reads the bearer from chrome.storage), the
 * aidream server through the extension's ONE header path, the side panel's
 * organization, an in-memory address, and this browser's tools as the
 * `deviceTools` port (run by the service worker's dispatcher).
 */

import { STORAGE_KEYS } from '@/config/env';
import { buildHeaders, getApiBaseUrl } from '@/lib/api/client';
import { requestMicrophoneGrant } from '@/lib/audio/mic-grant';
import { DEFAULT_CHAT_MANDATE_KEY } from '@/lib/mandates';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  getActiveOrganizationId,
  listMemberOrganizations,
  requireActiveOrganizationId,
} from '@/lib/org/active-org';
import { getSupabase } from '@/lib/supabase/client';
import type { DeviceToolCallRef } from '@/lib/tools/device-handoff';
import type {
  ChatDeviceToolContext,
  ChatDeviceToolHandOff,
  ChatDeviceToolInvocation,
  ChatHost,
  ChatOrgPort,
  ChatOrganization,
} from '@ai-matrx/chat/host';
import { createMemoryNavigation, createWebPrefs } from '@ai-matrx/chat/host';
import { browserDomContextSource, isBrowserDeviceRef } from './browser-dom-source';
import { registerExtensionComposerExtensions } from './composer-extensions';
import { extensionPageContextSource } from './context-source';
import { extensionKnobs } from './knobs';
import { registerExtensionToolRenderers } from './tool-renderers';

/** The panel's last chat address survives a reopen (session storage); a side panel's own URL never moves. */
const ADDRESS_KEY = 'matrx-extend:chat-address';

async function readStoredAddress(): Promise<string | null> {
  try {
    const value = (await chrome.storage.session.get(ADDRESS_KEY))[ADDRESS_KEY];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function readBearer(): Promise<string | null> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
  const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** The side panel's active organization, mirrored for the package's synchronous reads. */
function createPanelOrg(): ChatOrgPort & { refresh(): Promise<void> } {
  let active: ChatOrganization | null = null;
  const listeners = new Set<() => void>();
  const refresh = async () => {
    const id = await getActiveOrganizationId().catch(() => null);
    if (!id) {
      active = null;
    } else if (active?.id !== id) {
      const orgs = await listMemberOrganizations().catch(() => []);
      active = { id, name: orgs.find((o) => o.id === id)?.name ?? null };
    } else {
      return;
    }
    for (const l of listeners) l();
  };
  chrome.storage.onChanged.addListener(() => void refresh());
  return {
    refresh,
    active: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async require() {
      const id = await requireActiveOrganizationId();
      await refresh();
      return id;
    },
  };
}

async function invokeDeviceTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ChatDeviceToolContext,
): Promise<ChatDeviceToolInvocation> {
  // The service worker runs it through the extension's real gate, pinned to the tab the person
  // sent from (the turn's device reference) with the agent's latched ask/act mode.
  const answer = await send<DeviceToolCallRef, { ok: boolean; result?: unknown; error?: string }>(
    CHANNELS.DEVICE_TOOL_INVOKE,
    {
      callId: context.callId,
      toolName,
      args,
      conversationId: context.conversationId,
      permissionMode: context.permissionMode,
      assignedTabId: isBrowserDeviceRef(context.deviceRef) ? context.deviceRef.tabId : null,
    },
  );
  if (!answer.ok && /not registered/.test(answer.error ?? '')) {
    return { handled: false, reason: answer.error ?? 'not a browser tool' };
  }
  if (!answer.ok) return { handled: true, ok: false, error: answer.error ?? 'tool failed' };
  const output =
    answer.result && typeof answer.result === 'object' && !Array.isArray(answer.result)
      ? (answer.result as Record<string, unknown>)
      : { result: answer.result ?? null };
  return { handled: true, ok: true, output };
}

/**
 * The panel is closing with delegated browser-tool calls still in flight: the service worker owns
 * them from here (finishes the run, delivers the result). Fire-and-forget — the page is going away.
 */
function handOffDeviceTools(calls: readonly ChatDeviceToolHandOff[]): void {
  void send(CHANNELS.DEVICE_TOOL_HANDOFF, { calls }).catch(() => undefined);
}

/** Build the host once the backend address and organization are known. */
export async function createExtensionChatHost(): Promise<ChatHost> {
  registerExtensionToolRenderers();
  registerExtensionComposerExtensions();
  const [baseUrl, org] = await Promise.all([getApiBaseUrl(), Promise.resolve(createPanelOrg())]);
  const [initial] = await Promise.all([readStoredAddress(), org.refresh()]);
  return {
    db: getSupabase(),
    accessToken: readBearer,
    sourceApp: 'matrx-extend',
    app: {
      sourceApp: 'matrx-extend',
      sourceFeature: 'browser_chat',
      // The mandate the extension's own chat runs: a new package chat resolves it, not the web's default.
      defaultChatMandateKey: DEFAULT_CHAT_MANDATE_KEY,
    },
    org,
    server: {
      baseUrl: () => baseUrl,
      headers: () => buildHeaders(),
    },
    navigation: createMemoryNavigation({
      initial,
      persist: (address) =>
        void chrome.storage?.session?.set({ [ADDRESS_KEY]: address }).catch(() => undefined),
      // An aimatrx.com page opens in a browser tab, never inside the panel.
      openExternal: (href) => void chrome.tabs.create({ url: href }),
    }),
    // Drafts and density in the page's own storage, plus the platform settings register (the composer's quick starts are a setting).
    prefs: { ...createWebPrefs(), knobs: extensionKnobs },
    deviceTools: { invoke: invokeDeviceTool, handOff: handOffDeviceTools },
    registry: { contextSources: [browserDomContextSource, extensionPageContextSource] },
    // Chrome cannot prompt inside a side panel: the grant is asked in the mic-grant popup.
    microphone: { requestPermission: () => requestMicrophoneGrant() },
  };
}
