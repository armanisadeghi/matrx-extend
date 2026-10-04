/** Read-only DOM observation for a capture button across React replacements. */
export function armBusyExpression(title) {
  return `(() => {
    globalThis.__scrapeBusyObserver?.disconnect();
    const state = { observed:false, text:null, samples:0, matchingButtons:0,
      buttonReplacements:0, disabledSamples:0 };
    globalThis.__scrapeBusy = state;
    let previousButton = null;
    const sample = () => {
      const outer = [...document.querySelectorAll('button[role="tab"][title="Scrape"][data-state="active"]')];
      const pane = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
      const buttons = pane?.matches('[role="tabpanel"][data-state="active"]')
        ? [...pane.querySelectorAll('button')].filter(n =>
            (n.getAttribute('title') ?? n.getAttribute('data-matrx-title')) === ${JSON.stringify(title)}
            && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0)
        : [];
      state.samples++;
      state.matchingButtons = buttons.length;
      if (buttons.length === 1 && previousButton && buttons[0] !== previousButton)
        state.buttonReplacements++;
      if (buttons.length === 1) previousButton = buttons[0];
      if (buttons.length === 1 && buttons[0].disabled) {
        state.disabledSamples++;
        state.observed = true;
        state.text = buttons[0].textContent.trim();
      }
    };
    globalThis.__scrapeBusyObserver = new MutationObserver(sample);
    globalThis.__scrapeBusyObserver.observe(document.documentElement,
      { attributes:true, childList:true, subtree:true });
    sample();
    if (state.matchingButtons !== 1) throw new Error('scrape_busy_button_not_unique');
  })()`;
}

export const readBusyExpression = `(() => {
  globalThis.__scrapeBusyObserver?.disconnect();
  return globalThis.__scrapeBusy ?? {observed:false,text:null,samples:0,
    matchingButtons:0,buttonReplacements:0,disabledSamples:0};
})()`;
