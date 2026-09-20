/**
 * Rung 3 — the person's own logged-in Chrome, unattended (CONTRACT.md §1, §7.2).
 *
 * The person clicked "run these in my browser" and walked away. For each
 * claimed handoff this opens the page in a real background tab, lets it settle,
 * scrolls it the way a reader would, reads it with THE EXISTING capture
 * primitives, closes the tab, and reports — every single time.
 *
 * FOUR THINGS THIS FILE REFUSES TO DO:
 *
 *  1. **No new extractor.** `captureWithFallback()` and `getOuterHtml()` are
 *     the extension's capture primitives and they stay the only ones; a second
 *     reader here would be a second answer to "what does this page say".
 *  2. **No metronome.** A fixed `setInterval` scroll is a bot signature. Pacing
 *     is randomised in the 400–1200ms band with per-step jitter, because rung 3
 *     exists precisely for sites that refuse a server browser.
 *  3. **No silent skip.** Every pass ends at `POST …/result` or
 *     `POST …/needs-drive`, and `assertOutcomeReported()` refuses a pass that
 *     ends at neither.
 *  4. **No rung it is not on.** `assertRungMatches()` runs before the result
 *     post. A row on `human_drive` is a person's job; the unattended runner
 *     never captures it and never files it as its own work.
 *
 * Chrome APIs are feature-detected and reported, never thrown at the caller —
 * repo convention. A missing `chrome.tabs` becomes a needs-drive with a
 * sentence, not an exception that strands the row as `claimed`.
 */

import { claimHandoff, postCaptureResult, postNeedsDrive } from '@/lib/capture-ladder/api';
import { captureCaptions } from '@/lib/capture-ladder/captions';
import {
  type Handoff,
  MIN_CAPTURED_CHARS,
  type RunnerOutcome,
  assertOutcomeReported,
  assertRungMatches,
  isLadderViolation,
} from '@/lib/capture-ladder/types';
import { log } from '@/lib/debug/log';
import { getOuterHtml } from '@/lib/scrape/capture-html';
import { captureWithFallback } from '@/lib/scrape/capture-with-fallback';
import { settlePage } from '@/lib/scrape/page-ready';
import { formatCount } from "@ai-matrx/kit/format";

/** Human-like pacing band. Never a constant interval. */
const SCROLL_MIN_MS = 400;
const SCROLL_MAX_MS = 1200;
/** Extra per-step wobble so even the random band is not uniformly random. */
const SCROLL_JITTER_MS = 180;

const LOAD_TIMEOUT_MS = 45_000;
const SETTLE_QUIET_MS = 900;
const SETTLE_MAX_MS = 8_000;

export interface RunOptions {
  /** §6 `own_browser_scroll_passes`, resolved from the org's knobs. */
  scrollPasses: number;
  /** Per-item progress for the tray. */
  onProgress?: (handoffId: string, phase: RunPhase, detail?: string) => void;
  signal?: AbortSignal;
}

export type RunPhase =
  | 'claiming'
  | 'opening'
  | 'settling'
  | 'scrolling'
  | 'reading'
  | 'reporting'
  | 'done'
  | 'refused';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A pause inside the human band, wobbled. Exported so the pacing is testable. */
export function nextScrollPauseMs(random: () => number = Math.random): number {
  const base = SCROLL_MIN_MS + random() * (SCROLL_MAX_MS - SCROLL_MIN_MS);
  const jitter = (random() - 0.5) * 2 * SCROLL_JITTER_MS;
  return Math.max(200, Math.round(base + jitter));
}

function tabsAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.tabs?.create === 'function' &&
    typeof chrome.scripting?.executeScript === 'function'
  );
}

/** Wait for the tab to finish loading. Resolves `false` on timeout, never throws. */
async function waitForLoad(tabId: number, timeoutMs = LOAD_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return true;
    } catch {
      return false; // tab gone
    }
    await sleep(250);
  }
  return false;
}

/** One reader-sized scroll step. Returns false when the page cannot be scripted. */
async function scrollOneStep(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: 'smooth' });
      },
    });
    return true;
  } catch (err) {
    log.info('scrape', `capture-ladder scroll step failed on tab ${tabId}`, {
      message: (err as Error).message,
    });
    return false;
  }
}

async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The person may have closed it themselves. Nothing to repair.
  }
}

function textOf(soup: { article?: { content_markdown?: string | null } } | undefined): string {
  return soup?.article?.content_markdown ?? '';
}

/**
 * Run ONE `own_browser` handoff end to end. Always reports: the returned
 * outcome's `posted` is `result` or `needs_drive`, or the pass is refused by
 * `assertOutcomeReported()` and surfaced as a refusal the person can see.
 *
 * `handoff` must already be claimed (`runBatch` claims), or pass
 * `claimFirst: true`.
 */
export async function runOne(
  handoff: Handoff,
  options: RunOptions & { claimFirst?: boolean },
): Promise<RunnerOutcome> {
  const report = (phase: RunPhase, detail?: string): void =>
    options.onProgress?.(handoff.id, phase, detail);

  // WHAT this row is for decides WHICH reader runs, and the row says so. A
  // watch page read by the article extractor would file the video's description
  // and sidebar as its transcript — confidently, and wrongly.
  const outcome: RunnerOutcome = {
    handoffId: handoff.id,
    // A pass that is handed an already-claimed row owns it from the first line.
    claimed: options.claimFirst !== true,
    posted: 'none',
    ok: false,
    chars: 0,
    note: '',
  };

  /** Hand back to the person, with the sentence they will read. */
  const handToPerson = async (reason: string, note: string): Promise<RunnerOutcome> => {
    report('reporting');
    const res = await postNeedsDrive(handoff.id, { reason, note }, options.signal);
    outcome.posted = res.ok ? 'needs_drive' : 'none';
    outcome.note = res.ok
      ? note
      : `${note} (AI Matrx could not tell the server about it: ${res.error})`;
    return outcome;
  };

  try {
    // THE LADDER LAW, first tooth. The unattended runner is rung 3 and only
    // rung 3; a `human_drive` row belongs to a person, and capturing it here
    // would file their work as ours and erase the fact that a person was asked.
    assertRungMatches(handoff, 'own_browser');

    if (!tabsAvailable()) {
      return await handToPerson(
        'wrong_resource',
        'This browser will not let AI Matrx open pages on its own, so this one needs you to ' +
          'open it and press "I am done, capture it".',
      );
    }

    if (options.claimFirst) {
      report('claiming');
      const claimed = await claimHandoff(handoff.id, { client: 'chrome-extension' }, options.signal);
      if (!claimed.ok) {
        outcome.posted = 'none';
        outcome.claimed = false;
        outcome.note =
          claimed.status === 409
            ? 'Another browser is already working on this page, so it was left alone.'
            : `AI Matrx could not take this page: ${claimed.error}`;
        // A refused claim is NOT a skipped rung — the row is untouched and
        // still waiting, so there is nothing to report to the server.
        report('refused', outcome.note);
        return outcome;
      }
      outcome.claimed = true;
    }

    // THE ROW SAYS WHAT TO READ. Dispatched AFTER the claim, so the caption
    // reader owns the row exactly as the page reader would, and BEFORE a tab is
    // opened, so only one reader ever touches the page.
    if (handoff.handoff_kind === 'youtube_captions') {
      report('reading');
      const read = await captureCaptions(handoff, {
        rung: 'own_browser',
        ...(options.signal ? { signal: options.signal } : {}),
      });
      report(read.ok ? 'done' : 'refused', read.note);
      return { ...read, claimed: outcome.claimed };
    }

    report('opening');
    const tab = await chrome.tabs.create({ url: handoff.url, active: false });
    const tabId = tab.id;
    if (typeof tabId !== 'number') {
      return await handToPerson(
        'wrong_resource',
        'The page would not open in a background tab, so it needs you to open it yourself.',
      );
    }

    try {
      const loaded = await waitForLoad(tabId);
      if (!loaded) {
        return await handToPerson(
          'bad_status',
          'This page took too long to load on its own. Open it, wait until it looks right, ' +
            'then press "I am done, capture it".',
        );
      }

      report('settling');
      await settlePage(tabId, { quietMs: SETTLE_QUIET_MS, maxMs: SETTLE_MAX_MS });

      report('scrolling');
      for (let pass = 0; pass < Math.max(0, options.scrollPasses); pass++) {
        if (options.signal?.aborted) break;
        const scrolled = await scrollOneStep(tabId);
        if (!scrolled) break;
        await sleep(nextScrollPauseMs());
      }
      await settlePage(tabId, { quietMs: SETTLE_QUIET_MS, maxMs: SETTLE_MAX_MS });

      report('reading');
      const current = await chrome.tabs.get(tabId).catch(() => null);
      const finalUrl = current?.url ?? handoff.url;
      const captured = await captureWithFallback(tabId, finalUrl);
      if (!captured.ok) {
        return await handToPerson(
          'wrong_resource',
          'AI Matrx could not read this page automatically. Open it, get it to the view you ' +
            'want saved, then press "I am done, capture it".',
        );
      }

      const text = textOf(captured.soup);
      const chars = text.length;
      outcome.chars = chars;

      if (chars < MIN_CAPTURED_CHARS) {
        return await handToPerson(
          'thin_content',
          'This page came back almost empty — usually that means it wants you signed in, or it ' +
            'only fills in after you interact with it. Open it, get the content on screen, then ' +
            'press "I am done, capture it".',
        );
      }

      const html = await getOuterHtml(tabId).catch(() => '');

      // THE LADDER LAW again, immediately before the one door. Belt and braces
      // on purpose: `handoff` may have been refreshed between the claim and
      // here, and the result post is irreversible.
      assertRungMatches(handoff, 'own_browser');

      report('reporting');
      const posted = await postCaptureResult(
        handoff.id,
        {
          ok: true,
          captured_by_rung: 'own_browser',
          chars,
          title: captured.soup?.article?.title ?? handoff.title,
          text,
          html,
          final_url: finalUrl,
        },
        options.signal,
      );

      if (!posted.ok) {
        return await handToPerson(
          'bad_status',
          `AI Matrx read this page but could not file it (${posted.error}). Try it again, or ` +
            'open it and capture it yourself.',
        );
      }

      outcome.posted = 'result';
      outcome.ok = true;
      outcome.note = `Read and saved — ${formatCount(chars)} characters.`;
      report('done', outcome.note);
      return outcome;
    } finally {
      await closeTab(tabId);
    }
  } catch (err) {
    if (isLadderViolation(err)) {
      outcome.note = err.userMessage;
      report('refused', err.userMessage);
      return outcome;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error('scrape', `capture-ladder run failed for handoff ${handoff.id}`, { message });
    return await handToPerson(
      'bad_status',
      `Something went wrong reading this page (${message}). Open it and capture it yourself, ` +
        'or skip it.',
    );
  } finally {
    // THE SECOND TOOTH. A pass that reported nothing leaves the row `claimed`
    // and the page silently dropped. Refuse to call that finished — and say so
    // on the item rather than in a console nobody has open.
    try {
      assertOutcomeReported(outcome);
    } catch (violation) {
      if (isLadderViolation(violation)) {
        outcome.note = outcome.note
          ? `${outcome.note} ${violation.userMessage}`
          : violation.userMessage;
        report('refused', outcome.note);
        log.error('scrape', violation.message);
      }
    }
  }
}

/**
 * Claim and run a batch, one page at a time. Sequential on purpose: this is
 * the person's own browser and their own bandwidth, and six tabs racing on a
 * site that already refused a server browser is how rung 3 gets a person
 * rate-limited out of their own account.
 */
export async function runBatch(
  handoffs: readonly Handoff[],
  options: RunOptions,
): Promise<RunnerOutcome[]> {
  const outcomes: RunnerOutcome[] = [];
  for (const handoff of handoffs) {
    if (options.signal?.aborted) break;
    outcomes.push(await runOne(handoff, { ...options, claimFirst: true }));
  }
  return outcomes;
}

/**
 * Rung 4's capture — the person drove, the page is in front of them, they
 * pressed "I am done, capture it". Reads the tab AS IT STANDS: no scrolling,
 * no navigation, no settling loop that could move what they arranged.
 */
export async function captureDrivenTab(
  handoff: Handoff,
  tabId: number,
  signal?: AbortSignal,
): Promise<RunnerOutcome> {
  const outcome: RunnerOutcome = {
    handoffId: handoff.id,
    // Rung 4 is the person's own click on a row already sitting at
    // `needs_drive`; there is no unattended claim to take.
    claimed: true,
    posted: 'none',
    ok: false,
    chars: 0,
    note: '',
  };
  try {
    assertRungMatches(handoff, 'human_drive');
    // Same dispatch as the unattended runner: the row's kind decides the reader.
    // The person drove to a watch page; what is wanted from it is the caption
    // track, read from the tab they already have open.
    if (handoff.handoff_kind === 'youtube_captions') {
      return await captureCaptions(handoff, {
        rung: 'human_drive',
        tabId,
        ...(signal ? { signal } : {}),
      });
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const finalUrl = tab?.url ?? handoff.url;
    const captured = await captureWithFallback(tabId, finalUrl);
    if (!captured.ok) {
      outcome.note =
        'AI Matrx could not read that tab. Make sure the page is still open and in front, ' +
        'then try again.';
      return outcome;
    }
    const text = textOf(captured.soup);
    outcome.chars = text.length;
    const html = await getOuterHtml(tabId).catch(() => '');
    const posted = await postCaptureResult(
      handoff.id,
      {
        ok: true,
        captured_by_rung: 'human_drive',
        chars: text.length,
        title: captured.soup?.article?.title ?? handoff.title,
        text,
        html,
        final_url: finalUrl,
      },
      signal,
    );
    if (!posted.ok) {
      outcome.note = `AI Matrx read the page but could not file it: ${posted.error}`;
      return outcome;
    }
    outcome.posted = 'result';
    outcome.ok = true;
    outcome.note = `Saved — ${formatCount(text.length)} characters.`;
    return outcome;
  } catch (err) {
    if (isLadderViolation(err)) {
      outcome.note = err.userMessage;
      return outcome;
    }
    outcome.note = `Something went wrong saving that page: ${
      err instanceof Error ? err.message : String(err)
    }`;
    return outcome;
  }
}
