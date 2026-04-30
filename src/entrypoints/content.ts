import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    // Lazy-load the heavy bridge so the runtime CS bootstrap stays tiny.
    const { mountContentBridge } = await import('@/lib/content/bridge');
    mountContentBridge(ctx);
  },
});
