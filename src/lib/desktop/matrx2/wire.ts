/**
 * Production wiring for the Matrx 2 connection (./connection.ts): the permission-gated executor,
 * the person's access token and the extension's version. Called once from the background
 * bootstrap; every later step goes through `ensureMatrx2Connection()`.
 */

import { getAccessToken } from '@/lib/auth/flow';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { readDefaultPermissionMode } from '@/lib/settings/persisted';
import { handleWebmcpCall } from '@/lib/tools/dispatch';
import { configureMatrx2, onMatrx2Change } from './connection';

let wired = false;

export function wireMatrx2(): void {
  if (wired) return;
  wired = true;
  configureMatrx2({
    runTool: async (call, hooks) => {
      const mode = await readDefaultPermissionMode();
      return handleWebmcpCall(
        { callId: call.callId, toolName: call.toolName, args: call.args },
        {
          permissionMode: mode === 'act' ? 'act' : 'ask',
          initiator: 'desktop',
          onAwaitingConfirmation: hooks.onAwaitingConfirmation,
          onRunning: hooks.onRunning,
        },
      );
    },
    accessToken: () => getAccessToken(),
    extensionVersion: () => chrome.runtime.getManifest().version,
  });
  // Extension pages (Debug › Bridges, Settings) follow the connection live.
  onMatrx2Change((state) => {
    broadcast(CHANNELS.MATRX2_STATE, state);
  });
}
