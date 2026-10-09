import { mountGuidedOverlay } from '@/lib/guided-capture/overlay';
import { SWIPE_MATCH_PATTERNS } from '@/lib/swipe-file/urls';
import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * The guide shown on a page the web app sent the person to ("Take me there").
 * Runs on the social hosts but draws NOTHING unless the service worker says
 * this tab belongs to a capture job. Top frame only.
 */
export default defineContentScript({
  matches: SWIPE_MATCH_PATTERNS.filter((p) => !p.includes('youtube') && !p.includes('youtu.be')),
  runAt: 'document_idle',
  allFrames: false,
  main() {
    mountGuidedOverlay();
  },
});
