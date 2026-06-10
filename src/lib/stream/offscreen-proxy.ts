/**
 * SW-side orchestrator. Sidepanel sends STREAM_START to the SW, the SW
 * ensures the offscreen document exists and forwards via STREAM_RUN
 * (NOT STREAM_START — that channel is sidepanel-only, otherwise we'd echo
 * our own broadcast and recurse forever).
 */

import { getApiBaseUrl } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';
import { getOrCreateGuestSignature } from '@/lib/auth/guest-signature';
import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { markStreamActive, markStreamInactive } from '@/lib/stream/active-runs';

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  if (await offscreenExists()) {
    log.info('stream', 'offscreen already exists');
    return;
  }
  if (creating) return creating;
  log.info('stream', 'creating offscreen document');
  // USER_MEDIA is required for getUserMedia from the offscreen doc — voice
  // input (TASK-002) won't work without it. BLOBS is for the SSE / scrape
  // pipeline. Multiple reasons are allowed in a single offscreen doc.
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS', 'USER_MEDIA'] as chrome.offscreen.Reason[],
      justification:
        'Holds long-running fetch ReadableStreams for AI streams; also captures microphone audio for voice input (side-panel getUserMedia is unreliable in MV3).',
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
  /**
   * Tab the agent is pinned to for this run. Captured at message-send time
   * so tools don't drift onto whatever tab the user happens to focus during
   * execution. Null when the run isn't tied to a specific page (e.g. an
   * agenda task where the agent navigates itself).
   */
  assignedTabId?: number | null;
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
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers['X-Fingerprint-ID'] = await getOrCreateGuestSignature();
  }

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
  // Mark the run live BEFORE handing it to the offscreen doc so a SW reap +
  // rewake during the stream can't have boot close the document under it
  // (see closeStaleOffscreenOnBoot). Cleared on the terminal done chunk by
  // the dispatcher's STREAM_CHUNK listener, on explicit cancel below, and
  // by age-out.
  await markStreamActive(args.runId);

  // Use STREAM_RUN, not STREAM_START — distinct channel so this doesn't
  // recurse into the SW's own STREAM_START handler.
  await send(CHANNELS.STREAM_RUN, payload);
}

export async function cancelStream(runId: string): Promise<void> {
  log.info('stream', `cancel ${runId}`);
  await send(CHANNELS.STREAM_KILL, { runId });
  void markStreamInactive(runId);
}
