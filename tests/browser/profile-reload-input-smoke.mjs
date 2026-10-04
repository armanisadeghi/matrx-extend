/** Prove trusted input changed the owned guest sidepanel before reload. */
export async function observeGuestPaneTransition(
  panel,
  activatePanel,
  { wait = (ms) => new Promise((done) => setTimeout(done, ms)) } = {},
) {
  const sample = async () => {
    const response = await panel.send('Runtime.evaluate', {
      expression: `(() => {
        const tabs = [...document.querySelectorAll('button[role="tab"]')];
        const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
        const target = tabs.find((tab) => tab.getAttribute('title') === 'Scrape');
        const rect = target?.getBoundingClientRect();
        return { selected: selected.length === 1 ? selected[0].getAttribute('title') : null,
          scrape_count: tabs.filter((tab) => tab.getAttribute('title') === 'Scrape').length,
          point: rect && rect.width > 0 && rect.height > 0
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null };
      })()`,
      returnByValue: true,
    });
    if (response.exceptionDetails || !response.result?.value)
      throw new Error('guest_pane_sample_failed');
    return response.result.value;
  };
  const before = await sample();
  if (before.selected !== 'Chat' || before.scrape_count !== 1 || !before.point)
    throw new Error('guest_pane_input_precondition_failed');
  await activatePanel();
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...before.point,
    button: 'left',
    clickCount: 1,
  });
  await panel.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...before.point,
    button: 'left',
    clickCount: 1,
  });
  let after;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    after = await sample();
    if (after.selected === 'Scrape')
      return { before_selected: 'Chat', after_selected: 'Scrape', trusted_click: true };
    await wait(100);
  }
  throw new Error('guest_pane_transition_unobserved');
}
