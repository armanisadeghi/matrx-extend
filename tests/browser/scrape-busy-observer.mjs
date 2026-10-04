/** Read-only DOM observation for a capture button across React replacements. */
export function armBusyExpression(title) {
  return `(() => {
    globalThis.__scrapeBusyObserver?.disconnect();
    const state = { observed:false, text:null, samples:0, matchingButtons:0,
      buttonReplacements:0, disabledSamples:0,
      disabledMutationRecords:0, busyLabelMutationRecords:0,
      overlappingMutationState:false, ambiguousOwnershipBatches:0 };
    globalThis.__scrapeBusy = state;
    let previousButton = null;
    let previousDisabled = false;
    let previousBusyLabel = false;
    let previousBusyText = null;
    const busyLabel = ${JSON.stringify(title.startsWith('Capture') ? 'Capturing' : 'Scrolling')};
    const sample = (records = []) => {
      const outer = [...document.querySelectorAll('button[role="tab"][title="Scrape"][data-state="active"]')];
      const pane = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
      const buttons = pane?.matches('[role="tabpanel"][data-state="active"]')
        ? [...pane.querySelectorAll('button')].filter(n =>
            (n.getAttribute('title') ?? n.getAttribute('data-matrx-title')) === ${JSON.stringify(title)}
            && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0
            && getComputedStyle(n).display !== 'none'
            && getComputedStyle(n).visibility !== 'hidden' && !n.closest('[inert]'))
        : [];
      state.samples++;
      state.matchingButtons = buttons.length;
      if (buttons.length === 1 && previousButton && buttons[0] !== previousButton)
        state.buttonReplacements++;
      const button = buttons.length === 1 ? buttons[0] : null;
      if (button && button === previousButton) {
        const ownershipChanged = records.some(record => {
          if (record.type === 'childList')
            return [...record.addedNodes, ...record.removedNodes].some(n =>
              n === button || n.contains?.(button));
          if (record.type !== 'attributes') return false;
          if (!['style','class','hidden','inert','aria-hidden','data-state']
              .includes(record.attributeName)) return false;
          const target = record.target;
          return target === button || target === outer[0] ||
            target.contains?.(button) || button.contains(target);
        });
        if (ownershipChanged) state.ambiguousOwnershipBatches++;
        let disabled = previousDisabled;
        let busy = previousBusyLabel;
        let busyText = previousBusyText;
        let overlap = false;
        let overlapText = null;
        for (let index = 0; index < records.length; index++) {
          const record = records[index];
          if (record.target === button && record.type === 'attributes'
              && record.attributeName === 'disabled') {
            disabled = !disabled;
            state.disabledMutationRecords++;
          }
          if (record.type === 'childList' && button.contains(record.target)) {
            const removed = [...record.removedNodes].some(n => n.textContent?.includes(busyLabel));
            const added = [...record.addedNodes].some(n => n.textContent?.includes(busyLabel));
            if (removed || added) state.busyLabelMutationRecords++;
            if (removed) { busy = false; busyText = null; }
            if (added) {
              busy = true;
              busyText = [...record.addedNodes].map(n => n.textContent ?? '').join('').trim();
            }
          }
          if (record.type === 'characterData' && button.contains(record.target)) {
            const later = records.slice(index + 1).find(r =>
              r.type === 'characterData' && r.target === record.target);
            const text = (later?.oldValue ?? record.target.textContent ?? '').trim();
            if (busy !== text.includes(busyLabel)) state.busyLabelMutationRecords++;
            busy = text.includes(busyLabel);
            busyText = busy ? text : null;
          }
          if (disabled && busy) { overlap = true; overlapText = busyText; }
        }
        // A record-only verdict is valid only if the replayed transitions
        // reconcile with the current DOM; otherwise retain diagnostics.
        if (!ownershipChanged && overlap && disabled === button.disabled
            && busy === button.textContent.includes(busyLabel)) {
          state.observed = true;
          state.text = overlapText;
          state.overlappingMutationState = true;
        }
      }
      if (button && button.disabled) {
        state.disabledSamples++;
        if (button.textContent.includes(busyLabel)) {
          state.observed = true;
          state.text = button.textContent.trim();
        }
      }
      previousButton = button;
      previousDisabled = button?.disabled ?? false;
      previousBusyLabel = button?.textContent.includes(busyLabel) ?? false;
      previousBusyText = previousBusyLabel ? button.textContent.trim() : null;
    };
    globalThis.__scrapeBusyObserver = new MutationObserver(sample);
    globalThis.__scrapeBusyObserver.observe(document.documentElement,
      { attributes:true, childList:true, characterData:true,
        characterDataOldValue:true, subtree:true });
    sample();
    if (state.matchingButtons !== 1) throw new Error('scrape_busy_button_not_unique');
  })()`;
}

export const readBusyExpression = `(() => {
  globalThis.__scrapeBusyObserver?.disconnect();
  return globalThis.__scrapeBusy ?? {observed:false,text:null,samples:0,
    matchingButtons:0,buttonReplacements:0,disabledSamples:0,
    disabledMutationRecords:0,busyLabelMutationRecords:0,
    overlappingMutationState:false,ambiguousOwnershipBatches:0};
})()`;
