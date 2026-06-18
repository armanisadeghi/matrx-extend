/**
 * Enrich executor (RESEARCH_ENRICHMENT.md §3).
 *
 * Fulfils an `enrich` directive — the server asking for a SPECIFIC missing thing
 * using a browser capability it lacks — by REUSING the exact capture primitives
 * the scrape ladder already uses (settlePage / scrollToLoadLazy / getOuterHtml /
 * getCapturePageData) plus a goal-specific pre-step, then submitting the result
 * to the same /extension-content sink tagged with `enrich_goal`. No new capture
 * path; no agent-dispatcher round-trip.
 *
 * The capture-family goals (rendered_dom / authenticated / expand / comments /
 * structured) are fully supported through the existing content sink. The
 * artifact / specialized goals (screenshot, download, xhr_json, transcript) need
 * server capabilities that don't exist yet (the research asset-upload endpoint is
 * 501; CDP-network + transcript openers aren't wired to research) — those return
 * a structured `unsupported` outcome naming the gap, never a fake success.
 *
 * Dormant until the server emits `task_kind:'enrich'` items (no generator yet —
 * see the matrx-feedback contract). `planEnrich` is pure and unit-tested so the
 * mapping is verified ahead of the server lighting it up.
 */

import {
  type ExtensionContentResponse,
  type ExtensionScrapeItem,
  type SubmittableLevel,
  submitExtensionContent,
} from '@/lib/api/routes/research';
import { log } from '@/lib/debug/log';
import { ENRICH_GOAL_INFO, type EnrichGoal } from '@/lib/research/enrich-types';
import { getOuterHtml } from '@/lib/scrape/capture-html';
import { getCapturePageData } from '@/lib/scrape/capture-media';
import { scrollToLoadLazy, settlePage } from '@/lib/scrape/page-ready';

export interface EnrichPlan {
  /** Fulfillable through the current /extension-content sink? */
  supported: boolean;
  /** When unsupported, the missing server capability (shown to the user). */
  needs?: string;
  settle: boolean;
  scroll: boolean;
  /** Click load-more / accordion / consent obstacles (and the hint selector). */
  clickObstacles: boolean;
  level: SubmittableLevel;
}

/**
 * Pure goal → capture-plan mapping. The capture-family goals all reduce to
 * "prepare the DOM, then capture html + page data"; only the prep differs.
 */
export function planEnrich(goal: EnrichGoal): EnrichPlan {
  switch (goal) {
    case 'rendered_dom':
    case 'authenticated':
      return { supported: true, settle: true, scroll: true, clickObstacles: false, level: 2 };
    case 'structured':
      return { supported: true, settle: true, scroll: false, clickObstacles: false, level: 2 };
    case 'expand':
    case 'comments':
      return { supported: true, settle: true, scroll: true, clickObstacles: true, level: 2 };
    case 'screenshot':
      return {
        supported: false,
        needs: 'a research screenshot/asset upload endpoint (server /sources/upload is 501)',
        settle: false,
        scroll: false,
        clickObstacles: false,
        level: 1,
      };
    case 'download':
      return {
        supported: false,
        needs: 'a research file upload endpoint (server /sources/upload is 501)',
        settle: false,
        scroll: false,
        clickObstacles: false,
        level: 1,
      };
    case 'xhr_json':
      return {
        supported: false,
        needs: 'CDP network-capture wiring into the research submit path',
        settle: false,
        scroll: false,
        clickObstacles: false,
        level: 1,
      };
    case 'transcript':
      return {
        supported: false,
        needs: 'a site-specific transcript opener (e.g. YouTube) feeding the content sink',
        settle: false,
        scroll: false,
        clickObstacles: false,
        level: 1,
      };
  }
}

export type EnrichOutcome =
  | { ok: true; charCount: number; isGood: boolean; response: ExtensionContentResponse }
  | { ok: false; reason: string; unsupported?: boolean };

/**
 * Run the item's enrich directive against an already-open tab and submit the
 * result. The caller owns tab lifecycle (open / reuse / close), mirroring
 * captureAndSubmit.
 */
export async function runEnrich(item: ExtensionScrapeItem, tabId: number): Promise<EnrichOutcome> {
  const directive = item.enrich;
  if (!directive) return { ok: false, reason: 'Item has no enrich directive.' };
  const goal = directive.goal;
  const plan = planEnrich(goal);

  if (!plan.supported) {
    const label = ENRICH_GOAL_INFO[goal].label;
    log.warn('scrape', `enrich '${goal}' unsupported — needs ${plan.needs}`);
    return {
      ok: false,
      unsupported: true,
      reason: `${label} enrichment isn't available yet — it needs ${plan.needs}.`,
    };
  }

  log.info('scrape', `enrich '${goal}' on tab=${tabId}`, {
    source: item.source_id,
    hints: directive.hints ?? null,
  });

  if (plan.settle) await settlePage(tabId);
  if (plan.scroll) await scrollToLoadLazy(tabId);
  if (plan.clickObstacles) {
    const clicked = await clickObstacles(tabId, directive.hints?.selector ?? null);
    if (clicked > 0) {
      // Newly-revealed content (expanded threads / loaded-more) may itself lazy-load.
      await scrollToLoadLazy(tabId);
    }
  }

  let html: string;
  try {
    html = await getOuterHtml(tabId);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const page = await getCapturePageData(tabId);

  const res = await submitExtensionContent(
    item.topic_id,
    item.source_id,
    html,
    plan.level,
    page.images,
    {
      media: { videos: page.videos, audio: page.audio },
      structured: { metadata: page.metadata, jsonLd: page.jsonLd },
      enrichGoal: goal,
    },
  );
  if (!res.ok) return { ok: false, reason: res.error };
  return {
    ok: true,
    charCount: res.data.char_count,
    isGood: res.data.is_good_scrape,
    response: res.data,
  };
}

/**
 * Click the directive's hint selector (if given) plus a small set of common
 * "reveal more" controls (load-more, show-comments, accordions, read-more).
 * Returns how many elements were clicked. Runs in the page world — self-contained.
 */
async function clickObstacles(tabId: number, hintSelector: string | null): Promise<number> {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      args: [hintSelector],
      func: (selector: string | null) => {
        let clicked = 0;
        const click = (el: Element | null): void => {
          if (el instanceof HTMLElement) {
            el.click();
            clicked++;
          }
        };
        // The server's explicit hint takes priority — click every match.
        if (selector) {
          try {
            document.querySelectorAll(selector).forEach(click);
          } catch {
            /* invalid selector — ignore */
          }
        }
        // Generic reveal controls. Match on accessible text, capped so we never
        // runaway-click a whole page.
        const TEXT =
          /\b(load more|show more|view more|see more|show comments|view all|read more|expand|continue reading)\b/i;
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>('button, a[role="button"], [role="button"], a'),
        ).slice(0, 400);
        let generic = 0;
        for (const el of candidates) {
          if (generic >= 8) break;
          const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
          if (label && label.length < 40 && TEXT.test(label)) {
            click(el);
            generic++;
          }
        }
        // Open native <details> accordions.
        document.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach((d) => {
          d.open = true;
          clicked++;
        });
        return clicked;
      },
    });
    const n = (result?.[0]?.result as number | undefined) ?? 0;
    log.info('scrape', `enrich clickObstacles tab=${tabId} clicked ${n}`);
    return n;
  } catch (err) {
    log.warn('scrape', `enrich clickObstacles tab=${tabId} failed`, err);
    return 0;
  }
}
