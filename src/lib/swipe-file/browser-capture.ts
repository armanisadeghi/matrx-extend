/** Start the existing org-private guided capture for an already saved post. */
import { runOpAs } from '@/lib/api/matrx-api';
import { type OpenGuidedResult, adoptGuidedTab, openGuidedTab } from '@/lib/guided-capture/host';
import { recipeForUrl } from '@/lib/guided-capture/recipes';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { readSwipeReceipt } from '@/lib/swipe-file/receipt';
import { swipeTargetFromUrl } from '@/lib/swipe-file/urls';
import { gatedCaptureDoor } from '@ai-matrx/api/marketing';

export async function startSwipeBrowserCapture(args: {
  postId: string;
  organizationId: string;
  url: string;
  openerTabId: number | null;
}): Promise<OpenGuidedResult> {
  try {
    const receipt = await readSwipeReceipt(args.postId);
    if (!receipt || receipt.organizationId !== args.organizationId)
      return { ok: false, sentence: 'Save this post again before capturing its slides.' };
    const target = swipeTargetFromUrl(args.url);
    const savedTarget = swipeTargetFromUrl(receipt.url);
    const recipe = recipeForUrl(target?.url);
    if (
      !savedTarget ||
      !target ||
      !recipe?.itemKey(target.url) ||
      recipe.itemKey(savedTarget.url) !== recipe.itemKey(target.url) ||
      target.platform !== receipt.platform
    )
      return { ok: false, sentence: 'Browser slide capture is unavailable for this post.' };
    const result = await runOpAs<{ job: { id: string } }>(
      (api, o) =>
        gatedCaptureDoor(
          api,
          {
            body: {
              platform: receipt.platform,
              handle_or_url: target.url,
              target: 'post',
              path: 'guided',
              post_id: receipt.postId,
            },
          },
          o,
        ),
      { organizationId: receipt.organizationId },
    );
    if (!result.ok) return { ok: false, sentence: result.error };
    if (!result.data?.job?.id)
      return { ok: false, sentence: 'The capture could not be opened. Try again.' };
    return await openGuidedTab({
      handoffId: result.data.job.id,
      organizationId: receipt.organizationId,
      openerTabId: args.openerTabId,
    });
  } catch (error) {
    return {
      ok: false,
      sentence: error instanceof Error ? error.message : 'Could not start browser capture.',
    };
  }
}

/**
 * "Capture more" on a profile or feed the person is already looking at: the same guided
 * capture job the web app creates, started from the Swipe card on THIS tab. Costs nothing
 * until they press Capture on the guide, and nothing is scrolled until they press Scroll for me.
 */
export async function startFeedCapture(args: {
  url: string;
  tabId: number;
}): Promise<OpenGuidedResult> {
  try {
    const recipe = recipeForUrl(args.url);
    if (!recipe || recipe.itemKey(args.url))
      return { ok: false, sentence: 'Open a profile or feed to capture more posts from it.' };
    const organizationId = await getActiveOrganizationId();
    if (!organizationId) return { ok: false, sentence: 'Sign in to Matrx to capture posts.' };
    const result = await runOpAs<{ job: { id: string } }>(
      (api, o) =>
        gatedCaptureDoor(
          api,
          {
            body: {
              platform: recipe.platform,
              handle_or_url: args.url,
              target: 'profile',
              path: 'guided',
            },
          },
          o,
        ),
      { organizationId },
    );
    if (!result.ok) return { ok: false, sentence: result.error };
    if (!result.data?.job?.id)
      return { ok: false, sentence: 'The capture could not be opened. Try again.' };
    return await adoptGuidedTab({
      handoffId: result.data.job.id,
      organizationId,
      tabId: args.tabId,
    });
  } catch (error) {
    return {
      ok: false,
      sentence: error instanceof Error ? error.message : 'Could not start capturing this page.',
    };
  }
}
