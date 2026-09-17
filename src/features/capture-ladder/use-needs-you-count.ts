/**
 * The sidepanel badge: how many pages need this browser right now.
 *
 * Lives apart from `NeedsYourBrowserView` on purpose — the badge has to be
 * right whether or not the person has ever opened that tab, and the view is
 * lazy-loaded. Both read the same queue through the same subscription, so the
 * badge can never disagree with the list behind it.
 */

import { type NeedsYouUpdate, subscribeNeedsYou } from '@/lib/capture-ladder/queue';
import { useEffect, useState } from 'react';

export interface NeedsYouBadge {
  count: number;
  /** False when the socket is not carrying — the number is poll-fresh, not live. */
  live: boolean;
}

export function useNeedsYouCount(enabled: boolean): NeedsYouBadge {
  const [badge, setBadge] = useState<NeedsYouBadge>({ count: 0, live: false });

  useEffect(() => {
    if (!enabled) {
      setBadge({ count: 0, live: false });
      return undefined;
    }
    return subscribeNeedsYou((update: NeedsYouUpdate) => {
      setBadge({ count: update.count, live: update.health === 'live' });
    });
  }, [enabled]);

  return badge;
}
