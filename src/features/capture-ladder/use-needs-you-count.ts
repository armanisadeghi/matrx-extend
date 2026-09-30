/**
 * The sidepanel badge: how many pages need this browser right now.
 *
 * Lives apart from `NeedsYourBrowserView` on purpose — the badge has to be
 * right whether or not the person has ever opened that tab, and the view is
 * lazy-loaded. Both read the same queue through the same subscription, so the
 * badge can never disagree with the list behind it.
 *
 * The count spans every organization the person can access.
 */

import { captureTabLabel } from '@/features/capture-ladder/queue-sentences';
import { type NeedsYouUpdate, subscribeNeedsYou } from '@/lib/capture-ladder/queue';
import { useEffect, useState } from 'react';

export interface NeedsYouBadge {
  /** Rows waiting across all the person's organizations — the number on the badge. */
  count: number;
  /** False when the socket is not carrying — the number is poll-fresh, not live. */
  live: boolean;
  /** The tab's accessible name / tooltip. */
  label: string;
}

const IDLE: NeedsYouBadge = {
  count: 0,
  live: false,
  label: captureTabLabel(0),
};

export function useNeedsYouCount(enabled: boolean): NeedsYouBadge {
  const [badge, setBadge] = useState<NeedsYouBadge>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setBadge(IDLE);
      return undefined;
    }
    return subscribeNeedsYou((update: NeedsYouUpdate) => {
      setBadge({
        count: update.count,
        live: update.health === 'live',
        label: captureTabLabel(update.count),
      });
    });
  }, [enabled]);

  return badge;
}
