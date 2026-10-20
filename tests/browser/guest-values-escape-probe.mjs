/** Test-only DOM observer. Serializable into CDP; never invokes or wraps React handlers. */
export function installGuestValuesEscapeProbe(document) {
  const window = document.defaultView;
  const selector = '[role="dialog"][data-state="open"]';
  const findDialogs = () =>
    [...document.querySelectorAll(selector)].filter((node) =>
      node.querySelector('[aria-label="Open full view"]'),
    );
  const dialog = findDialogs()[0] ?? null;
  const records = [];
  const transitions = [];
  const limit = 32;
  let droppedRecords = 0;
  let droppedTransitions = 0;
  let stopped = false;
  // Only fixed vocabulary, never custom tag names, attributes, text, or HTML.
  const shape = (node) => {
    if (node === document) return 'document';
    if (node === window) return 'window';
    const tag = node?.nodeName?.toLowerCase();
    return ['button', 'div', 'span', 'input', 'textarea', 'body', 'html', 'svg', 'path'].includes(
      tag,
    )
      ? tag
      : node
        ? 'other'
        : 'none';
  };
  const inside = (node) => Boolean(node instanceof window.Node && dialog?.contains(node));
  const state = () => ({
    documentFocused: document.hasFocus(),
    activeShape: shape(document.activeElement),
    activeInsideDialog: inside(document.activeElement),
    originalDialogConnected: Boolean(dialog?.isConnected),
    originalDialogOpen: dialog?.getAttribute('data-state') === 'open',
    openValuesDialogCount: findDialogs().length,
    mountedTooltipCount: document.querySelectorAll('[role="tooltip"]').length,
    // Presence only: a React prop on this DOM node does not prove its handler ran.
    dialogReactKeyDownPropPresent: Boolean(
      dialog &&
        Object.keys(dialog)
          .filter((key) => key.startsWith('__reactProps$'))
          .some((key) => typeof dialog[key]?.onKeyDown === 'function'),
    ),
  });
  const preEscape = state();
  const probe = { keyDownCount: 0, trustedKeyDownCount: 0 };
  const listeners = [];
  for (const [name, node] of [
    ['window', window],
    ['document', document],
    ['dialog', dialog],
  ]) {
    if (!node) continue;
    for (const capture of [true, false]) {
      const listener = (event) => {
        if (event.key !== 'Escape') return;
        if (name === 'document' && capture) {
          probe.keyDownCount++;
          if (event.isTrusted) probe.trustedKeyDownCount++;
        }
        if (records.length >= limit) {
          droppedRecords++;
          return;
        }
        const path = event.composedPath();
        records.push({
          boundary: `${name}_${capture ? 'capture' : 'bubble'}`,
          eventPhase: event.eventPhase,
          trusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented,
          cancelBubble: event.cancelBubble,
          targetShape: shape(event.target),
          targetInsideDialog: inside(event.target),
          targetIsActiveElement: event.target === document.activeElement,
          pathIncludesDialog: path.includes(dialog),
          pathShapes: path.slice(0, 16).map(shape),
          pathTruncated: path.length > 16,
          ...state(),
        });
      };
      node.addEventListener('keydown', listener, capture);
      listeners.push(() => node.removeEventListener('keydown', listener, capture));
    }
  }
  const recordMutations = (mutations) => {
    for (const mutation of mutations) {
      const originalRemoved = [...mutation.removedNodes].some(
        (node) => node === dialog || (dialog && node.contains(dialog)),
      );
      const originalAdded = [...mutation.addedNodes].some(
        (node) => node === dialog || (dialog && node.contains(dialog)),
      );
      if (mutation.target !== dialog && !originalRemoved && !originalAdded) continue;
      if (transitions.length >= limit) {
        droppedTransitions++;
        continue;
      }
      transitions.push({
        type: mutation.type,
        oldStateWasOpen: mutation.type === 'attributes' ? mutation.oldValue === 'open' : null,
        originalRemoved,
        originalAdded,
        ...state(),
      });
    }
  };
  const observer = new window.MutationObserver(recordMutations);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-state'],
    attributeOldValue: true,
  });
  probe.snapshot = () => {
    recordMutations(observer.takeRecords());
    return {
      preEscape,
      records: [...records],
      transitions: [...transitions],
      droppedRecords,
      droppedTransitions,
      postEscape: state(),
    };
  };
  probe.stop = () => {
    if (stopped) return;
    stopped = true;
    recordMutations(observer.takeRecords());
    observer.disconnect();
    for (const remove of listeners) remove();
  };
  document.__guestValuesEscapeProbe = probe;
  return probe;
}

export const guestValuesEscapeProbeExpression = `(${installGuestValuesEscapeProbe.toString()})(document); void 0;`;
