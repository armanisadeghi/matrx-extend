import { mountGenerationTargetRegistry } from '@/lib/credentials/generation-targets';
import { defineContentScript } from 'wxt/utils/define-content-script';

/** A deliberately tiny isolated-world identity registry for password generation. */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_start',
  main() {
    mountGenerationTargetRegistry();
  },
});
