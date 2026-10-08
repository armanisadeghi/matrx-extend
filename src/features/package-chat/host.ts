/**
 * The extension's host for `@ai-matrx/chat` (W1/W2): the one Supabase client
 * (token-only — `accessToken` reads the bearer from chrome.storage), the
 * aidream server through the extension's ONE header path, the side panel's
 * organization, an in-memory address, and this browser's tools as the
 * `deviceTools` port (run by the service worker's dispatcher).
 */

import { STORAGE_KEYS } from '@/config/env';
import { SpeakerButton } from '@/features/chat/SpeakerButton';
import { buildHeaders, getApiBaseUrl } from '@/lib/api/client';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  getActiveOrganizationId,
  listMemberOrganizations,
  requireActiveOrganizationId,
} from '@/lib/org/active-org';
import { getSupabase } from '@/lib/supabase/client';
import type {
  ChatDeviceToolInvocation,
  ChatHost,
  ChatOrgPort,
  ChatOrganization,
} from '@ai-matrx/chat/host';
import { registerChatUi } from '@ai-matrx/chat/host/ui-slots';
import { memoryNavigation, restoreChatAddress } from './memory-navigation';
import { registerExtensionToolRenderers } from './tool-renderers';

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
  context: { conversationId: string; callId: string },
): Promise<ChatDeviceToolInvocation> {
  const answer = await send<
    { callId: string; toolName: string; args: unknown },
    { ok: boolean; result?: unknown; error?: string }
  >(CHANNELS.DEVICE_TOOL_INVOKE, { callId: context.callId, toolName, args });
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

/** Build the host once the backend address and organization are known. */
export async function createExtensionChatHost(): Promise<ChatHost> {
  registerExtensionToolRenderers();
  // Read-aloud in the package chat: the extension's Cartesia speaker behind media's ReadAloudButton.
  registerChatUi({ SpeakerButton });
  const [baseUrl, org] = await Promise.all([getApiBaseUrl(), Promise.resolve(createPanelOrg())]);
  await Promise.all([org.refresh(), restoreChatAddress()]);
  return {
    db: getSupabase(),
    accessToken: readBearer,
    sourceApp: 'matrx-extend',
    app: { sourceApp: 'matrx-extend', sourceFeature: 'browser_chat' },
    org,
    server: {
      baseUrl: () => baseUrl,
      headers: () => buildHeaders(),
    },
    navigation: memoryNavigation,
    deviceTools: { invoke: invokeDeviceTool },
  };
}
