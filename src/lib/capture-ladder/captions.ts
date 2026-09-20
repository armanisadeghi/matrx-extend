/**
 * Rung 3 and rung 4 for a YouTube caption track — the person's own browser
 * reading what YouTube refuses to give our servers.
 *
 * WHY THIS FILE EXISTS. YouTube hands a video's timed caption track to an
 * ordinary home browser and answers a datacenter address with "sign in to
 * confirm you're not a bot" — a perfectly well-formed 200 with no caption list
 * in it at all. Measured against `@huygensoptics` on 2026-09-19: three videos
 * held two English tracks each, and production saw none of them. Every address
 * AI Matrx owns was refused; this browser is not one of those addresses.
 *
 * WHY IT IS NOT `runner.ts`. The runner reads a PAGE: it scrolls, extracts an
 * article and posts text. Pointing that at a watch page would file the video's
 * description and sidebar as its transcript — confidently, and wrongly. What is
 * wanted here is one specific object YouTube's own player holds.
 *
 * HOW IT READS IT, and why this is the honest way:
 *
 *  1. Open the watch page in a background tab, exactly as a person would.
 *  2. From INSIDE that page, ask YouTube's own player endpoint what caption
 *     tracks the video has — the identical InnerTube question our servers ask,
 *     from an address YouTube answers.
 *  3. Download the track it names, still from inside the page, so the request
 *     is same-origin and carries the person's own session exactly as the
 *     player's would.
 *
 * (Step 2 is NOT "read `ytInitialPlayerResponse`". See the reader below: those
 * track URLs answer a plain fetch with an empty body, measured in a real
 * Chromium on real watch pages.)
 *
 * NOTHING IS INVENTED. If the player holds no caption list, this says so and
 * hands the row to the person (rung 4) rather than returning an empty track
 * that the server would record as "this video genuinely has none" — the exact
 * lie the whole caption ladder exists to stop.
 */

import { postCaptureResult, postNeedsDrive } from '@/lib/capture-ladder/api';
import {
  type Handoff,
  type RunnerOutcome,
  assertOutcomeReported,
  assertRungMatches,
  isLadderViolation,
} from '@/lib/capture-ladder/types';
import { log } from '@/lib/debug/log';
import { formatCount } from '@ai-matrx/kit/format';

const LOAD_TIMEOUT_MS = 45_000;

/** One timed line, in the shape `POST …/result` takes. */
export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

export interface CaptionTrackResult {
  ok: boolean;
  language: string;
  is_auto_generated: boolean;
  available_languages: string[];
  segments: CaptionLine[];
  /** A sentence when `ok` is false. Never a code — a person reads this. */
  note: string;
}

/** The two address shapes a YouTube video is named by. Narrow on purpose. */
export function youtubeVideoId(url: string): string | null {
  const watch = /[?&]v=([\w-]{11})\b/.exec(url);
  if (watch) return watch[1] ?? null;
  const short = /(?:youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})\b/.exec(url);
  return short ? (short[1] ?? null) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tabsAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.tabs?.create === 'function' &&
    typeof chrome.scripting?.executeScript === 'function'
  );
}

async function waitForLoad(tabId: number, timeoutMs = LOAD_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return true;
    } catch {
      return false;
    }
    await sleep(250);
  }
  return false;
}

/**
 * THE READER, as it runs inside the watch page.
 *
 * 🚨 IT ASKS INNERTUBE, IT DOES NOT READ THE WATCH PAGE'S OWN PLAYER OBJECT.
 * The obvious route is `ytInitialPlayerResponse.captions` — the caption list the
 * page already holds — and it is a trap. Measured in a real Chromium on real
 * watch pages, 2026-09-19: that list is correct, and every `baseUrl` on it
 * answers a plain fetch with **HTTP 200 and a zero-byte body**, credentialed or
 * not, `json3` or `srv3`. The watch page's track URLs are bound to the player
 * that was served them. Asking YouTube's own player endpoint from inside the
 * page — the same InnerTube question our servers ask, from an address YouTube
 * trusts — returns a `baseUrl` that serves the real 52KB track on the first try.
 *
 * So this is not "the extension's own scraper": it is the SAME question, asked
 * from the one place that gets an answer. That is the entire point of rung 3.
 *
 * Serialised into the tab by `chrome.scripting.executeScript`, so it may close
 * over NOTHING — every helper it needs is inside it. It returns a plain object
 * and never throws into the extension: a page that will not cooperate is an
 * answer with a sentence, not an exception three layers up.
 */
/* c8 ignore start — runs in the page, not in this bundle's test environment */
function readCaptionsInPage(videoId: string, preferred: string[]): Promise<CaptionTrackResult> {
  const refuse = (note: string): CaptionTrackResult => ({
    ok: false,
    language: '',
    is_auto_generated: false,
    available_languages: [],
    segments: [],
    note,
  });

  return (async () => {
    // The public client constant the YouTube apps themselves carry. Not a
    // secret, not ours, and it spends none of our quota.
    const KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    let player: Record<string, unknown>;
    try {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!response.ok) {
        return refuse(
          `YouTube answered ${response.status} in your browser when asked what captions ` +
            'this video has. Try again in a moment.',
        );
      }
      player = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      return refuse(
        `YouTube could not be asked what captions this video has from your browser (${
          err instanceof Error ? err.message : String(err)
        }).`,
      );
    }

    const status = String(
      ((player.playabilityStatus as Record<string, unknown>) ?? {}).status ?? 'OK',
    ).toUpperCase();
    if (status !== 'OK' && status !== 'LIVE_STREAM_OFFLINE') {
      const reason = String(
        ((player.playabilityStatus as Record<string, unknown>) ?? {}).reason ?? '',
      );
      return refuse(
        `YouTube would not answer for this video in your browser either${
          reason ? ` — it said “${reason}”` : ''
        }. Open it yourself and sign in or confirm your age if it asks.`,
      );
    }
    const list = (
      ((player.captions as Record<string, unknown>) ?? {})
        .playerCaptionsTracklistRenderer as Record<string, unknown>
    )?.captionTracks;
    const tracks = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
    if (tracks.length === 0) {
      return refuse(
        'Your browser was answered in full and this video carries no caption track at ' +
          'all, so it really has none. A model can still watch it for you.',
      );
    }

    const available = Array.from(
      new Set(tracks.map((t) => String(t.languageCode ?? '')).filter(Boolean)),
    );
    const wanted = preferred.map((l) => l.toLowerCase());
    const pick =
      wanted
        .flatMap((lang) => [
          tracks.find(
            (t) => String(t.languageCode ?? '').toLowerCase() === lang && t.kind !== 'asr',
          ),
          tracks.find((t) => String(t.languageCode ?? '').toLowerCase() === lang),
        ])
        .find(Boolean) ??
      tracks.find((t) => t.kind !== 'asr') ??
      tracks[0];
    if (!pick) return refuse('No caption track on this video could be chosen.');

    // `fmt=srv3` is already on the baseUrl, so appending another is ignored and
    // the answer comes back as XML. Replace it.
    const base = String(pick.baseUrl ?? '');
    const url = base.includes('fmt=')
      ? base.replace(/fmt=[^&]*/, 'fmt=json3')
      : `${base}&fmt=json3`;
    let payload: { events?: Record<string, unknown>[] };
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (!response.ok || body.length === 0) {
        return refuse(
          'YouTube listed captions for this video but served an empty track to your ' +
            'browser. Try this video again in a moment.',
        );
      }
      payload = JSON.parse(body) as { events?: Record<string, unknown>[] };
    } catch (err) {
      return refuse(
        `The caption track could not be downloaded in your browser (${
          err instanceof Error ? err.message : String(err)
        }).`,
      );
    }

    const segments: CaptionLine[] = [];
    for (const event of payload.events ?? []) {
      const segs = Array.isArray(event.segs) ? (event.segs as Record<string, unknown>[]) : [];
      const text = segs
        .map((s) => String(s.utf8 ?? ''))
        .join('')
        .trim();
      if (!text || text === '\n') continue;
      const startMs = Number(event.tStartMs ?? 0) || 0;
      const durationMs = Number(event.dDurationMs ?? 0) || 0;
      segments.push({
        start: Math.round(startMs) / 1000,
        end: Math.round(startMs + durationMs) / 1000,
        text,
      });
    }
    if (segments.length === 0) {
      return refuse(
        'YouTube’s caption track for this video came back empty, so there is nothing ' +
          'to save from it.',
      );
    }
    return {
      ok: true,
      language: String(pick.languageCode ?? ''),
      is_auto_generated: pick.kind === 'asr',
      available_languages: available,
      segments,
      note: '',
    };
  })();
}
/* c8 ignore stop */

/**
 * Read one video's captions in this browser and report — ALWAYS.
 *
 * Same two teeth as `runner.ts`: the rung must match the row, and the pass ends
 * at `result` or `needs-drive` or it is refused as unfinished.
 *
 * `rung` is the row's own (`own_browser` unattended, `human_drive` when the
 * person opened it themselves), and it is never inferred from how this was
 * called — a rung-4 capture filed as rung 3 erases the fact that a person had
 * to step in.
 */
export async function captureCaptions(
  handoff: Handoff,
  options: {
    rung: 'own_browser' | 'human_drive';
    languagePreference?: string[];
    /** Rung 4: the tab the person already has open. Rung 3 opens its own. */
    tabId?: number;
    signal?: AbortSignal;
  },
): Promise<RunnerOutcome> {
  const outcome: RunnerOutcome = {
    handoffId: handoff.id,
    claimed: true,
    posted: 'none',
    ok: false,
    chars: 0,
    note: '',
  };
  const preferred = options.languagePreference?.length ? options.languagePreference : ['en'];

  const handToPerson = async (reason: string, note: string): Promise<RunnerOutcome> => {
    if (options.rung === 'human_drive') {
      // There is nobody left to hand it to — rung 4 IS the person. Report the
      // failure as a result so the row stops looking busy and says why.
      const posted = await postCaptureResult(
        handoff.id,
        { ok: false, captured_by_rung: 'human_drive', note },
        options.signal,
      );
      outcome.posted = posted.ok ? 'result' : 'none';
      outcome.note = note;
      return outcome;
    }
    const res = await postNeedsDrive(handoff.id, { reason, note }, options.signal);
    outcome.posted = res.ok ? 'needs_drive' : 'none';
    outcome.note = res.ok
      ? note
      : `${note} (AI Matrx could not tell the server about it: ${res.error})`;
    return outcome;
  };

  let openedTabId: number | null = null;
  try {
    assertRungMatches(handoff, options.rung);

    const videoId = youtubeVideoId(handoff.url);
    if (!videoId) {
      return await handToPerson(
        'wrong_resource',
        'This is not a YouTube video address, so there are no captions to read from it.',
      );
    }
    if (!tabsAvailable()) {
      return await handToPerson(
        'wrong_resource',
        'This browser will not let AI Matrx open pages on its own, so this video needs ' +
          'you to open it and press “I am done, capture it”.',
      );
    }

    let tabId = options.tabId;
    if (typeof tabId !== 'number') {
      const tab = await chrome.tabs.create({ url: handoff.url, active: false });
      if (typeof tab.id !== 'number') {
        return await handToPerson(
          'wrong_resource',
          'The video would not open in a background tab, so it needs you to open it yourself.',
        );
      }
      tabId = tab.id;
      openedTabId = tab.id;
      const loaded = await waitForLoad(tabId);
      if (!loaded) {
        return await handToPerson(
          'bad_status',
          'This video’s page took too long to load. Open it, wait until it plays, then ' +
            'press “I am done, capture it”.',
        );
      }
    }

    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readCaptionsInPage,
      args: [videoId, preferred],
      world: 'MAIN', // `ytInitialPlayerResponse` is the PAGE's, not the isolated world's.
    });
    const track = injected?.result as CaptionTrackResult | undefined;
    if (!track) {
      return await handToPerson(
        'bad_status',
        'AI Matrx could not read this video’s page in your browser. Open it yourself and ' +
          'press “I am done, capture it”.',
      );
    }
    if (!track.ok) {
      return await handToPerson('cloudflare_block', track.note);
    }

    assertRungMatches(handoff, options.rung);
    const chars = track.segments.reduce((total, line) => total + line.text.length, 0);
    outcome.chars = chars;

    const posted = await postCaptureResult(
      handoff.id,
      {
        ok: true,
        captured_by_rung: options.rung,
        chars,
        title: handoff.title,
        caption_track: {
          language: track.language,
          is_auto_generated: track.is_auto_generated,
          available_languages: track.available_languages,
          segments: track.segments,
        },
        final_url: handoff.url,
      },
      options.signal,
    );
    if (!posted.ok) {
      return await handToPerson(
        'bad_status',
        `AI Matrx read this video’s captions but could not file them (${posted.error}). ` +
          'Try it again.',
      );
    }
    outcome.posted = 'result';
    outcome.ok = true;
    outcome.note = `Captions read and saved — ${formatCount(track.segments.length)} lines.`;
    return outcome;
  } catch (err) {
    if (isLadderViolation(err)) {
      outcome.note = err.userMessage;
      return outcome;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error('scrape', `caption capture failed for handoff ${handoff.id}`, { message });
    return await handToPerson(
      'bad_status',
      `Something went wrong reading this video’s captions (${message}). Open it and try ` +
        'again, or skip it.',
    );
  } finally {
    if (openedTabId !== null) {
      try {
        await chrome.tabs.remove(openedTabId);
      } catch {
        // The person may have closed it themselves. Nothing to repair.
      }
    }
    try {
      assertOutcomeReported(outcome);
    } catch (violation) {
      if (isLadderViolation(violation)) {
        outcome.note = outcome.note
          ? `${outcome.note} ${violation.userMessage}`
          : violation.userMessage;
        log.error('scrape', violation.message);
      }
    }
  }
}
