import { mountSwipePill } from '@/lib/swipe-file/pill';
import { SWIPE_MATCH_PATTERNS } from '@/lib/swipe-file/urls';
import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * "Save to swipe file" pill for social posts and ads. Matches the social
 * hosts only; the pill itself stays hidden unless the URL is a saveable post
 * (see src/lib/swipe-file/urls.ts). Top frame only.
 */
export default defineContentScript({
  matches: SWIPE_MATCH_PATTERNS,
  runAt: 'document_idle',
  allFrames: false,
  main() {
    mountSwipePill();
  },
});
