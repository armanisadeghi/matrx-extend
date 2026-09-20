import { mountGenerationTargetRegistry } from '@/lib/credentials/generation-targets';
import { defineContentScript } from 'wxt/utils/define-content-script';

/** Child-only credential assistance; deliberately excludes the heavy content bridge. */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], allFrames: true, runAt: 'document_idle',
  main() {
    if (window.top === window) return;
    mountGenerationTargetRegistry();
    void import('@/lib/credentials/inline-suggestions').then(({ mountInlineCredentialSuggestions }) => mountInlineCredentialSuggestions());
  },
});
