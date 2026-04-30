/**
 * SW-side orchestrator. Sidepanel sends STREAM_START to the SW, the SW
 * ensures the offscreen document exists and forwards via STREAM_RUN
 * (NOT STREAM_START — that channel is sidepanel-only, otherwise we'd echo
 * our own broadcast and recurse forever).
 */

import { getApiBaseUrl } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  if (await offscreenExists()) {
    log.info('stream', 'offscreen already exists');
    return;
  }
  if (creating) return creating;
  log.info('stream', 'creating offscreen document');
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS' as chrome.offscreen.Reason],
      justification:
        'Holds long-running fetch ReadableStreams for AI agent and scrape responses; SW lifecycle terminates streams >30s.',
    })
    .then(() => {
      log.success('stream', 'offscreen document created');
    })
    .catch((err) => {
      if (/Only a single offscreen/i.test((err as Error).message)) {
        log.info('stream', 'offscreen race — already exists');
        return;
      }
      log.error('stream', 'offscreen creation failed', err);
      throw err;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function offscreenExists(): Promise<boolean> {
  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      });
      return contexts.length > 0;
    } catch {
      /* fall through */
    }
  }
  if ('hasDocument' in chrome.offscreen) {
    return await (chrome.offscreen as { hasDocument: () => Promise<boolean> }).hasDocument();
  }
  return false;
}

export interface StartStreamArgs {
  runId: string;
  endpoint: string;
  body?: unknown;
  parser: 'text-chunks' | 'rich-events';
  /** Optional agent name (for log attribution + UI on the offscreen → SW path). */
  agentName?: string | null;
  /** Permission mode for any client tools the agent runs in this stream. */
  permissionMode?: 'ask' | 'act';
}

/**
 * Payload actually sent to the offscreen — pre-resolved URL + headers so
 * offscreen never needs to call chrome.storage or rerun auth logic.
 */
export interface StreamRunPayload {
  runId: string;
  url: string;
  body?: unknown;
  parser: 'text-chunks' | 'rich-events';
  headers: Record<string, string>;
  agentName?: string | null;
  permissionMode?: 'ask' | 'act';
}

export async function startStream(args: StartStreamArgs): Promise<void> {
  log.info('stream', `start ${args.runId} → ${args.endpoint}`);
  // Resolve the URL + access token in the SW (where storage works reliably)
  // and ship the full request envelope to offscreen. Offscreen just executes.
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${args.endpoint}`;
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  await ensureOffscreen();

  const payload: StreamRunPayload = {
    runId: args.runId,
    url,
    body: args.body,
    parser: args.parser,
    headers,
    agentName: args.agentName ?? null,
    permissionMode: args.permissionMode,
  };
  // Use STREAM_RUN, not STREAM_START — distinct channel so this doesn't
  // recurse into the SW's own STREAM_START handler.
  await send(CHANNELS.STREAM_RUN, payload);
}

export async function cancelStream(runId: string): Promise<void> {
  log.info('stream', `cancel ${runId}`);
  await send(CHANNELS.STREAM_KILL, { runId });
}
