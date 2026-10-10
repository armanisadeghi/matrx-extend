/** Start the existing org-private guided capture for an already saved post. */
import { apiPost } from '@/lib/api/client';
import { type OpenGuidedResult, openGuidedTab } from '@/lib/guided-capture/host';
import { recipeForUrl } from '@/lib/guided-capture/recipes';
import { readSwipeReceipt } from '@/lib/swipe-file/receipt';
import { swipeTargetFromUrl } from '@/lib/swipe-file/urls';

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
    const result = await apiPost<{ job: { id: string } }>(
      '/social/gated-captures',
      {
        platform: receipt.platform,
        handle_or_url: target.url,
        target: 'post',
        path: 'guided',
        post_id: receipt.postId,
      },
      undefined,
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
