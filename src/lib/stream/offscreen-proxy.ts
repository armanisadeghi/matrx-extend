/**
 * SW-side orchestrator that ensures the offscreen document exists, then
 * relays stream:start / stream:cancel to it and forwards stream:chunk back
 * to the side panel.
 *
 * Why offscreen: MV3 SWs are killed after ~30s idle. Long agent / scrape runs
 * easily exceed this. The offscreen document is a regular web page that
 * persists for the duration of its declared reason ('BLOBS') so the fetch
 * ReadableStream stays open across SW kills.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { sendMessage } from 'webext-bridge/background';

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  if (await offscreenExists()) return;
  if (creating) return creating;
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS' as chrome.offscreen.Reason],
      justification:
        'Holds long-running fetch ReadableStreams for AI agent and scrape responses; SW lifecycle terminates streams >30s.',
    })
    .catch((err) => {
      if (/Only a single offscreen/i.test((err as Error).message)) return;
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
}

export async function startStream(args: StartStreamArgs): Promise<void> {
  await ensureOffscreen();
  await sendMessage(CHANNELS.STREAM_START as never, args as never, 'window' as never);
}

export async function cancelStream(runId: string): Promise<void> {
  await sendMessage(CHANNELS.STREAM_CANCEL as never, { runId } as never, 'window' as never);
}
