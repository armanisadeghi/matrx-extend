/**
 * `capture_study_set` — one-click capture of the study set on the current page
 * (a Quizlet set, or any page carrying term/definition pairs) into a native
 * AI Matrx flashcard deck. WP5's browser half of IC-11 (the import contract,
 * education-platform INTEGRATION_MAP).
 *
 * The whole point is that this is NOT a new way to create a deck. Extraction
 * happens here; persistence goes through the platform's ONE transactional
 * import door, the `edu_import_deck` RPC — the same writer the web app's
 * import path uses — so membership edges, org stamping, and dedupe rules can
 * never fork. This handler touches no `education.*` table directly.
 *
 * Two actions, two tiers:
 *
 *   `preview`  — read. Extracts and returns the cards it found (count + a
 *                sample), writing nothing. Always offered first so the user
 *                sees what a capture would land.
 *   `capture`  — action. Commits through the RPC and returns the new deck's
 *                id, name and card count. The deck opens at
 *                `/education/flashcards/<set_id>` on the web app.
 *
 * Extraction strategy, in order (all inside one injected function — it
 * crosses the chrome.scripting boundary and references nothing external):
 *   1. Framework state: parse `#__NEXT_DATA__` and deep-scan for Quizlet's
 *      term rows (`{word, definition}` / `{term, definition}` objects) —
 *      still present on some routes.
 *   2. Quizlet's rendered term list: `span.TermText` pairs (verified live
 *      2026-08-18 — the current set page carries terms only in the DOM).
 *   3. DOM: `<dl>` definition lists and 2-column tables.
 */

import { getAccessToken } from '@/lib/auth/flow';
import { getSupabase } from '@/lib/supabase/client';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

const CaptureStudySetArgs = z.object({
  /**
   * `preview` (default) extracts and reports what it found, writing nothing.
   * `capture` commits the deck through the platform's one import door.
   */
  action: z.enum(['preview', 'capture']).default('preview'),
  /**
   * Deck name override. Defaults to the page's own set title (or document
   * title) — pass this only when the user asked for a different name.
   */
  deck_name: z.string().min(1).max(200).optional(),
});
type CaptureStudySetArgs = z.infer<typeof CaptureStudySetArgs>;

interface ExtractedSet {
  ok: boolean;
  reason?: string;
  title?: string;
  source?: string;
  cards?: { front: string; back: string }[];
}

/**
 * Runs INSIDE the page. Self-contained by necessity — chrome.scripting
 * serializes this function; outer-scope identifiers do not exist over there.
 */
function extractStudySetInPage(): ExtractedSet {
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

  // ── 1. Framework hydration state (Quizlet is Next.js) ──────────────────
  const cardsFromState = (): {
    title: string | null;
    cards: { front: string; back: string }[];
  } | null => {
    const node = document.getElementById('__NEXT_DATA__');
    if (!node?.textContent) return null;
    let root: unknown;
    try {
      root = JSON.parse(node.textContent);
    } catch {
      return null;
    }
    const cards: { front: string; back: string }[] = [];
    const seen = new Set<string>();
    let title: string | null = null;
    const visit = (v: unknown, depth: number): void => {
      if (!v || depth > 12) return;
      if (Array.isArray(v)) {
        for (const item of v) visit(item, depth + 1);
        return;
      }
      if (typeof v === 'string') {
        // Quizlet nests a JSON string (dehydrated store) inside pageProps.
        if (v.length > 200 && (v.includes('"definition"') || v.includes('"word"'))) {
          try {
            visit(JSON.parse(v), depth + 1);
          } catch {
            /* not JSON */
          }
        }
        return;
      }
      if (typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      const front =
        typeof o.word === 'string' ? o.word : typeof o.term === 'string' ? o.term : null;
      const back = typeof o.definition === 'string' ? o.definition : null;
      if (front && back && clean(front) && clean(back)) {
        const key = `${clean(front)} ${clean(back)}`;
        if (!seen.has(key)) {
          seen.add(key);
          cards.push({ front: clean(front), back: clean(back) });
        }
      }
      if (!title && typeof o.title === 'string' && typeof o.numTerms === 'number') {
        title = clean(o.title);
      }
      for (const child of Object.values(o)) visit(child, depth + 1);
    };
    visit(root, 0);
    return cards.length > 0 ? { title, cards } : null;
  };

  const state = cardsFromState();
  if (state) {
    return {
      ok: true,
      source: 'framework_state',
      title: state.title ?? document.title.replace(/\s*\|.*$/, '').trim(),
      cards: state.cards,
    };
  }

  // ── 2. Quizlet's rendered term list: TermText spans in (term, definition)
  // pairs. Verified live 2026-08-18: the current set page ships terms only in
  // the DOM (no framework blob), 2 spans per term row.
  const termSpans = Array.from(document.querySelectorAll('span.TermText'));
  if (termSpans.length >= 4 && termSpans.length % 2 === 0) {
    const pairCards: { front: string; back: string }[] = [];
    for (let i = 0; i + 1 < termSpans.length; i += 2) {
      const front = clean(termSpans[i]?.textContent ?? '');
      const back = clean(termSpans[i + 1]?.textContent ?? '');
      if (front && back) pairCards.push({ front, back });
    }
    if (pairCards.length >= 2) {
      return {
        ok: true,
        source: 'quizlet_dom',
        title: document.title
          .replace(/\s*(\|\s*Quizlet)?\s*$/i, '')
          .replace(/ Flashcards$/i, '')
          .trim(),
        cards: pairCards,
      };
    }
  }

  // ── 3. DOM: definition lists, then 2-column tables ─────────────────────
  const domCards: { front: string; back: string }[] = [];
  for (const dl of Array.from(document.querySelectorAll('dl'))) {
    const dts = Array.from(dl.querySelectorAll('dt'));
    for (const dt of dts) {
      const dd = dt.nextElementSibling;
      if (dd?.tagName === 'DD') {
        const front = clean(dt.textContent ?? '');
        const back = clean(dd.textContent ?? '');
        if (front && back) domCards.push({ front, back });
      }
    }
  }
  if (domCards.length === 0) {
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const twoCol = rows.filter((r) => r.querySelectorAll('td').length === 2);
      if (twoCol.length >= 3) {
        for (const r of twoCol) {
          const [a, b] = Array.from(r.querySelectorAll('td'));
          if (!a || !b) continue;
          const front = clean(a.textContent ?? '');
          const back = clean(b.textContent ?? '');
          if (front && back) domCards.push({ front, back });
        }
        break;
      }
    }
  }
  if (domCards.length > 0) {
    return {
      ok: true,
      source: 'dom',
      title: document.title.replace(/\s*\|.*$/, '').trim(),
      cards: domCards,
    };
  }

  return {
    ok: false,
    reason:
      'No study set found on this page — no framework term data, definition list, or two-column table.',
  };
}

export const capture_study_set: ToolHandler<CaptureStudySetArgs, unknown> = {
  name: 'capture_study_set',
  tier: 'action',
  // Preview writes nothing, so it must not demand an approval the user would
  // learn to click through. The commit always does.
  tierFor: (args): ToolTier => (args.action === 'capture' ? 'action' : 'read'),
  argsSchema: CaptureStudySetArgs,
  run: async (args, ctx) => {
    const tab = await getAssignedTab(ctx);
    if (!tab?.id || !tab.url) {
      return {
        ok: false,
        error: 'no_page',
        message: 'There is no page open to capture. Open the study set you want to import.',
      };
    }

    let extracted: ExtractedSet;
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractStudySetInPage,
      });
      extracted = (first?.result as ExtractedSet) ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, error: 'extraction_failed', message: (err as Error).message };
    }
    if (!extracted.ok || !extracted.cards?.length) {
      return { ok: false, error: 'nothing_found', message: extracted.reason ?? 'No cards found.' };
    }

    const deckName = args.deck_name ?? extracted.title ?? 'Captured study set';
    if (args.action === 'preview') {
      return {
        ok: true,
        action: 'preview',
        deck_name: deckName,
        card_count: extracted.cards.length,
        source: extracted.source,
        page_url: tab.url,
        sample: extracted.cards.slice(0, 5),
      };
    }

    // Owned data needs a real account — the guest fingerprint identity cannot
    // hold a deck.
    if (!(await getAccessToken())) {
      return {
        ok: false,
        error: 'sign_in_required',
        message: 'Sign in to AI Matrx to save this study set.',
      };
    }

    // The ONE import door (IC-11): transactional set + cards + membership
    // edges. Tab identity is Chrome's own committed URL, never page-supplied.
    const { data, error } = await getSupabase().rpc('edu_import_deck', {
      p_deck: {
        name: deckName,
        description: `Captured from ${tab.url}`,
        source: 'extension:capture_study_set',
        cards: extracted.cards,
      },
    });
    if (error) {
      return { ok: false, error: 'import_failed', message: error.message };
    }
    const result = data as { set_id: string; name: string; card_count: number };
    return {
      ok: true,
      action: 'capture',
      set_id: result.set_id,
      deck_name: result.name,
      card_count: result.card_count,
      open_url: `https://aimatrx.com/education/flashcards/${result.set_id}`,
    };
  },
};

export const education_handlers = [capture_study_set];
