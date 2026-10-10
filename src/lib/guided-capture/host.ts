/**
 * Guided capture — the service-worker half.
 *
 * Three jobs:
 *  1. `openGuidedTab` — called by the web app's "Take me there" (bridge action
 *     `captureHandoff.guide`): opens the target page in a new tab and remembers
 *     that tab belongs to a capture job.
 *  2. The port the page overlay talks over: "is this tab on a job?", then the
 *     capture itself.
 *  3. Filing the capture through the ONE door (`POST /capture/handoffs/{id}/result`,
 *     rung `human_drive`) — the same door the unattended runner and the side
 *     panel use. This file adds no second path.
 *
 * Registered synchronously from bootstrap, like the swipe-file host.
 */

import { postCaptureResult } from '@/lib/capture-ladder/api';
import { getHandoff } from '@/lib/capture-ladder/queue';
import {
  assertRungMatches,
  isLadderViolation,
  withLandingNotices,
} from '@/lib/capture-ladder/types';
import { log } from '@/lib/debug/log';
import {
  GUIDED_PORT,
  GUIDED_TABS_KEY,
  type GuidedCapturePayload,
  type GuidedClientMsg,
  type GuidedHostMsg,
  type GuidedTabJob,
} from '@/lib/guided-capture/protocol';
import { recipeForPlatform, recipeForUrl } from '@/lib/guided-capture/recipes';
import { getOne, setOne } from '@/lib/storage/chrome-local';

type TabMap = Record<string, GuidedTabJob>;

async function readTabs(): Promise<TabMap> {
  return (await getOne<TabMap>(GUIDED_TABS_KEY, 'session')) ?? {};
}

export async function jobForTab(tabId: number): Promise<GuidedTabJob | null> {
  return (await readTabs())[String(tabId)] ?? null;
}

async function rememberTab(tabId: number, job: GuidedTabJob): Promise<void> {
  const tabs = await readTabs();
  tabs[String(tabId)] = job;
  await setOne(GUIDED_TABS_KEY, tabs, 'session');
}

async function forgetTab(tabId: number): Promise<void> {
  const tabs = await readTabs();
  if (!(String(tabId) in tabs)) return;
  delete tabs[String(tabId)];
  await setOne(GUIDED_TABS_KEY, tabs, 'session');
}

export type OpenGuidedResult = { ok: true; tabId: number } | { ok: false; sentence: string };

/**
 * Open the job's page in front of the person and remember the tab.
 * Refuses (with a sentence) a row that is not a job a person can drive.
 */
export async function openGuidedTab(args: {
  handoffId: string;
  organizationId: string;
  openerTabId: number | null;
}): Promise<OpenGuidedResult> {
  const row = await getHandoff(args.handoffId).catch(() => null);
  if (!row) {
    return {
      ok: false,
      sentence:
        'That capture is no longer in your list, so there is nothing to open. Start it again from the app.',
    };
  }
  if (row.organization_id !== args.organizationId) {
    return {
      ok: false,
      sentence: 'That capture belongs to a different workspace than the one you are in.',
    };
  }
  if (row.status === 'captured') {
    return { ok: false, sentence: 'That page was already captured.' };
  }
  if (row.status === 'dismissed' || row.status === 'failed') {
    return { ok: false, sentence: 'That capture was closed. Start it again from the app.' };
  }
  if (row.rung !== 'human_drive') {
    return {
      ok: false,
      sentence:
        'That capture is set to run in the background, so there is nothing for you to do on the page.',
    };
  }
  const social = (row.metadata?.social ?? {}) as { platform?: unknown; target?: unknown };
  if (typeof chrome.tabs?.create !== 'function')
    return { ok: false, sentence: 'This browser cannot open a capture tab.' };
  const tab = await chrome.tabs.create({ url: row.url, active: true });
  if (typeof tab.id !== 'number') {
    return { ok: false, sentence: 'Your browser would not open the page. Try again.' };
  }
  await rememberTab(tab.id, {
    handoffId: row.id,
    organizationId: row.organization_id,
    url: row.url,
    title: row.title,
    platform: typeof social.platform === 'string' ? social.platform : null,
    target: typeof social.target === 'string' ? social.target : null,
    rowSteps: row.what_to_do ?? '',
    openerTabId: args.openerTabId,
  });
  return { ok: true, tabId: tab.id };
}

/** File one capture. Never throws; the answer is always a sentence or a result. */
export async function fileGuidedCapture(
  job: GuidedTabJob,
  payload: GuidedCapturePayload,
): Promise<GuidedHostMsg> {
  try {
    const row = await getHandoff(job.handoffId);
    if (!row) {
      return {
        t: 'failed',
        sentence: 'This capture is no longer in your list. Start it again from the app.',
      };
    }
    if (row.status === 'captured') {
      return { t: 'failed', sentence: 'This page was already captured.' };
    }
    if (row.organization_id !== job.organizationId)
      return {
        t: 'failed',
        sentence: 'This capture belongs to another organization. Start it again.',
      };
    const recipe = recipeForPlatform(job.platform) ?? recipeForUrl(job.url);
    if (
      job.target === 'post' &&
      (!recipe?.itemKey(job.url) || recipe.itemKey(payload.finalUrl) !== recipe.itemKey(job.url))
    )
      return { t: 'failed', sentence: 'Return to the saved post, then press Capture.' };
    assertRungMatches(row, 'human_drive');
    if (payload.text.trim().length < 40 && payload.itemCount === 0) {
      return {
        t: 'failed',
        sentence:
          'There is nothing on this page to capture yet. Scroll until posts show up, then press Capture again.',
      };
    }
    const posted = await postCaptureResult(
      job.handoffId,
      {
        ok: true,
        captured_by_rung: 'human_drive',
        chars: payload.text.length,
        title: payload.title || row.title,
        text: payload.text,
        html: payload.html,
        final_url: payload.finalUrl,
        images: payload.images,
        ...(payload.videos ? { videos: payload.videos } : {}),
        ...(payload.mediaNotes?.length ? { note: payload.mediaNotes.join(' ') } : {}),
      },
      undefined,
      job.organizationId,
    );
    if (!posted.ok) {
      return {
        t: 'failed',
        sentence: `Matrx could not save this capture (${posted.error}). Press Capture to try again.`,
      };
    }
    return {
      t: 'filed',
      chars: payload.text.length,
      items: payload.itemCount,
      notice: posted.data.notices.length
        ? withLandingNotices('', posted.data.notices).trim() || null
        : null,
    };
  } catch (err) {
    if (isLadderViolation(err)) return { t: 'failed', sentence: err.userMessage };
    log.error('scrape', 'guided capture failed', { message: (err as Error).message });
    return {
      t: 'failed',
      sentence: 'Something went wrong saving this capture. Press Capture to try again.',
    };
  }
}

export function registerGuidedCaptureHost(): void {
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    void forgetTab(tabId);
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== GUIDED_PORT) return;
    const tabId = port.sender?.tab?.id;
    const post = (m: GuidedHostMsg) => {
      try {
        port.postMessage(m);
      } catch {
        /* tab closed mid-capture; the filing itself already completed or failed */
      }
    };
    port.onMessage.addListener(async (msg: GuidedClientMsg) => {
      if (typeof tabId !== 'number') return post({ t: 'none' });
      const job = await jobForTab(tabId);
      if (!job) return post({ t: 'none' });
      if (msg.t === 'hello') {
        return post({
          t: 'job',
          job: {
            handoffId: job.handoffId,
            url: job.url,
            title: job.title,
            platform: job.platform,
            target: job.target,
            rowSteps: job.rowSteps,
          },
        });
      }
      if (msg.t === 'capture') return post(await fileGuidedCapture(job, msg.payload));
      if (msg.t === 'back') {
        if (job.openerTabId !== null) {
          const opener = await chrome.tabs.get(job.openerTabId).catch(() => null);
          if (opener?.id !== undefined) {
            await chrome.tabs.update(opener.id, { active: true }).catch(() => undefined);
            if (opener.windowId !== undefined)
              await chrome.windows
                .update(opener.windowId, { focused: true })
                .catch(() => undefined);
          }
        }
        return;
      }
      if (msg.t === 'finish') await forgetTab(tabId);
    });
  });
}
