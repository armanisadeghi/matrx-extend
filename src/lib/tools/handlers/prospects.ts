/**
 * `capture_prospect` — one-click prospect capture from whatever page the user
 * (or the agent) is already looking at. IC-10's browser half.
 *
 * The whole point of this tool is that it is NOT a new way to create a
 * prospect. It is the existing list-import path with one entry and a source
 * label saying where the user was standing, so a captured domain arrives in the
 * same triage surface, with the same Matrx Authority Score, the same review
 * vocabulary, the same fold to `crm.party` — and, critically, the same
 * blocklist check AT INGESTION. A domain the customer forbade must never enter
 * their list, and a capture door that skipped that check would be exactly the
 * side door the contract forbids.
 *
 * Two actions, two tiers:
 *
 *   `preview`  — read. Writes nothing. Returns the verdict (new · already a
 *                prospect · blocklisted · not a usable address), which site it
 *                would land in, and — the part a browser capture uniquely needs
 *                — **the prior relationship**: if this domain is already a party,
 *                how many messages have gone to them, which campaigns they are
 *                in, how many confirmed wins they have given us, and whether
 *                they are marked do-not-contact. Capturing a warm contact
 *                thinking it is cold is the mistake this prevents.
 *   `capture`   — action. Commits through the one import path.
 *
 * Deliberately NOT here:
 *   - **People.** A person on the page is WP3's `crm.contact_candidate` through
 *     the enrichment waterfall. This tool writes no person, address or contact
 *     point, and the agent must not be given a way to think it did.
 *   - **A domain normalizer.** The server normalizes with the party resolver's
 *     own function; a second spelling here would mint a second party for a
 *     company we already have.
 *   - **A site guess.** With more than one website in the workspace the server
 *     refuses to pick, and the preview hands back the real choices. A silent
 *     guess files prospects under the wrong site, which nobody notices until a
 *     campaign goes out.
 */

import { captureProspect, previewProspectCapture } from '@/lib/api/routes/prospects';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

const CaptureProspectArgs = z.object({
  /**
   * `preview` (default) reports what would happen and who we already know at
   * this domain, writing nothing. `capture` commits it.
   */
  action: z.enum(['preview', 'capture']).default('preview'),
  /**
   * The page to capture. Defaults to the page the agent is assigned to — pass
   * this only to capture a DIFFERENT address than the one on screen.
   */
  url: z.string().min(3).max(2048).optional(),
  /**
   * Which of the user's websites this prospect belongs to. Omit it first: with
   * one website the server uses it, and with several the preview returns the
   * real choices to offer the user.
   */
  site_id: z.string().uuid().optional(),
});
type CaptureProspectArgs = z.infer<typeof CaptureProspectArgs>;

/**
 * The address a page is really at. `tab.url` is Chrome's own record of the
 * committed navigation, not something the page can rewrite — a page that
 * spoofed `location` in its own DOM must not be able to aim a capture.
 */
async function pageIdentity(
  ctx: Parameters<ToolHandler<CaptureProspectArgs, unknown>['run']>[1],
): Promise<{ url: string | null; title: string | null }> {
  const tab = await getAssignedTab(ctx);
  return { url: tab?.url ?? null, title: tab?.title ?? null };
}

export const capture_prospect: ToolHandler<CaptureProspectArgs, unknown> = {
  name: 'capture_prospect',
  tier: 'action',
  // Preview writes nothing, so it must not demand an approval the user would
  // learn to click through. The commit always does.
  tierFor: (args): ToolTier => (args.action === 'capture' ? 'action' : 'read'),
  argsSchema: CaptureProspectArgs,
  run: async (args, ctx) => {
    const page = await pageIdentity(ctx);
    const url = args.url ?? page.url;
    if (!url) {
      return {
        ok: false,
        error: 'no_page',
        message:
          'There is no page open to capture. Open the website you want to add as a ' +
          'prospect, or pass its address as `url`.',
      };
    }

    const body = {
      url,
      ...(args.site_id !== undefined && { site_id: args.site_id }),
      // Only the assigned tab's OWN title describes the captured page; a title
      // from a different url would label the row with the wrong page.
      ...(args.url === undefined && page.title ? { page_title: page.title } : {}),
    };

    const result =
      args.action === 'capture'
        ? await captureProspect(body)
        : await previewProspectCapture(body);

    if (!result.ok) {
      if (result.status === 401) {
        return {
          ok: false,
          error: 'sign_in_required',
          message: 'Sign in to AI Matrx to save prospects.',
        };
      }
      if (result.status === 409) {
        // The server refuses to guess which website a prospect belongs to.
        return {
          ok: false,
          error: 'site_choice_required',
          message:
            'You have more than one website — ask which one this prospect belongs ' +
            'to, then call again with `site_id`.',
          detail: result.error,
        };
      }
      return { ok: false, error: 'capture_failed', message: result.error };
    }

    return { ok: true, action: args.action, ...result.data };
  },
};

export const prospect_handlers = [capture_prospect];
