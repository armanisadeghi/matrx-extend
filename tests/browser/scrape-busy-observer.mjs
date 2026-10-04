/** Read-only DOM observation for a capture button across React replacements. */
export function armBusyExpression(title) {
  return `(() => {
    globalThis.__scrapeBusyObserver?.disconnect();
    const state = { observed:false, text:null, samples:0, matchingButtons:0,
      buttonReplacements:0, disabledSamples:0,
      disabledMutationRecords:0, observedAtMs:null,
      observationBasis:"current_owned_visible_dom" };
    globalThis.__scrapeBusy = state;
    let previousButton = null;
    const busyLabel = ${JSON.stringify(title.startsWith('Capture') ? 'Capturing' : 'Scrolling')};
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
          && rect.left < innerWidth && rect.top < innerHeight)) return false;
      if (node.checkVisibility && !node.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}))
        return false;
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (ancestor.hidden || ancestor.hasAttribute('inert') ||
            ancestor.getAttribute('aria-hidden') === 'true' || style.display === 'none' ||
            style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0')
          return false;
      }
      return true;
    };
    const sample = (records = []) => {
      const outer = [...document.querySelectorAll('button[role="tab"][title="Scrape"][data-state="active"]')];
      const pane = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
      const buttons = pane?.matches('[role="tabpanel"][data-state="active"]')
        ? [...pane.querySelectorAll('button')].filter(n =>
            (n.getAttribute('title') ?? n.getAttribute('data-matrx-title')) === ${JSON.stringify(title)}
            && visible(n))
        : [];
      state.samples++;
      state.matchingButtons = buttons.length;
      if (buttons.length === 1 && previousButton && buttons[0] !== previousButton)
        state.buttonReplacements++;
      const button = buttons.length === 1 ? buttons[0] : null;
      // Mutation records are diagnostics only: they cannot reconstruct historical
      // computed visibility, ownership, or a state that was actually displayed.
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'disabled'
            && (record.target === button || record.target === previousButton))
          state.disabledMutationRecords++;
      }
      if (button && button.disabled) {
        state.disabledSamples++;
        if (button.textContent.includes(busyLabel)) {
          state.observed = true;
          state.text = button.textContent.trim();
          state.observedAtMs = performance.now();
        }
      }
      previousButton = button;
    };
    globalThis.__scrapeBusyObserver = new MutationObserver(sample);
    globalThis.__scrapeBusyObserver.observe(document.documentElement,
      { attributes:true, childList:true, characterData:true,
        subtree:true });
    sample();
    if (state.matchingButtons !== 1) throw new Error('scrape_busy_button_not_unique');
  })()`;
}

export const readBusyExpression = `(() => {
  globalThis.__scrapeBusyObserver?.disconnect();
  return globalThis.__scrapeBusy ?? {observed:false,text:null,samples:0,
    matchingButtons:0,buttonReplacements:0,disabledSamples:0,
    disabledMutationRecords:0,observedAtMs:null,
    observationBasis:"current_owned_visible_dom"};
})()`;
