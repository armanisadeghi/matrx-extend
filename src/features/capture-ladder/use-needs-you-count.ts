/**
 * The sidepanel badge: how many pages need this browser right now.
 *
 * Lives apart from `NeedsYourBrowserView` on purpose — the badge has to be
 * right whether or not the person has ever opened that tab, and the view is
 * lazy-loaded. Both read the same queue through the same subscription, so the
 * badge can never disagree with the list behind it.
 *
 * THE BADGE MUST NOT LIE BY OMISSION. `count` stays the ACTIONABLE number —
 * rows in the active organization, the only ones a click can act on — but the
 * tab's accessible name carries `elsewhereTotal` too, so a person with pages
 * waiting in another of their own workspaces is never shown a flat, silent
 * zero. The two numbers are never added together.
 */

import { captureTabLabel } from '@/features/capture-ladder/queue-sentences';
import { type NeedsYouUpdate, subscribeNeedsYou } from '@/lib/capture-ladder/queue';
import { useEffect, useState } from 'react';

export interface NeedsYouBadge {
  /** Rows in the ACTIVE organization — the number on the badge. */
  count: number;
  /** False when the socket is not carrying — the number is poll-fresh, not live. */
  live: boolean;
  /** Rows waiting in the person's OTHER organizations. Never added to `count`. */
  elsewhereTotal: number;
  /** The tab's accessible name / tooltip — says "…waiting in another workspace" when it is true. */
  label: string;
}

const IDLE: NeedsYouBadge = {
  count: 0,
  live: false,
  elsewhereTotal: 0,
  label: captureTabLabel(0, 0),
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
        elsewhereTotal: update.elsewhereTotal,
        label: captureTabLabel(update.count, update.elsewhereTotal),
      });
    });
  }, [enabled]);

  return badge;
}
