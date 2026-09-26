/**
 * Whether the active page is a Source, as the chat context tells the model
 * (SOURCE-CONVERGENCE §1 rule 6). One status, three honest answers:
 *   - `source`            — its content landed; the model may cite it by id;
 *   - `not_yet_a_source`  — only a web address; Save (Scrape tab) makes it one;
 *   - `unknown`           — the lookup failed; never implied to be either.
 * Both context builders use this so the model never sees "captured" for a
 * page that is not a Source, nor silence for a lookup that failed.
 */
import { lookupCapturedByUrl } from '@/lib/supabase/queries';

export type PageSourceStatus =
  | { status: 'source'; source_id: string; title: string | null; saved_at: string }
  | { status: 'not_yet_a_source'; how_to_make_it_one: string }
  | { status: 'unknown'; reason: string };

export const NOT_YET_A_SOURCE_ACTION =
  'Not yet a Source: only the web address is known. The person can press Save in the Scrape tab to make it a Source.';

export async function pageSourceStatus(url: string): Promise<PageSourceStatus> {
  try {
    const lookup = await lookupCapturedByUrl(url);
    if (lookup.status === 'found') {
      return {
        status: 'source',
        source_id: lookup.page.id,
        title: lookup.page.title,
        saved_at: lookup.page.captured_at,
      };
    }
    if (lookup.status === 'none') {
      return { status: 'not_yet_a_source', how_to_make_it_one: NOT_YET_A_SOURCE_ACTION };
    }
    return {
      status: 'unknown',
      reason: `Could not check whether this page is a Source: ${lookup.reason}`,
    };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { status: 'unknown', reason: `Could not check whether this page is a Source: ${why}` };
  }
}

/** The same status as flat keys, for the v1 context shape. */
export function pageSourceFlat(s: PageSourceStatus): Record<string, unknown> {
  if (s.status === 'source') {
    return {
      page_source_status: 'source',
      page_source_id: s.source_id,
      page_source_title: s.title,
      page_source_saved_at: s.saved_at,
    };
  }
  if (s.status === 'not_yet_a_source') {
    return { page_source_status: 'not_yet_a_source', page_source_note: s.how_to_make_it_one };
  }
  return { page_source_status: 'unknown', page_source_note: s.reason };
}
