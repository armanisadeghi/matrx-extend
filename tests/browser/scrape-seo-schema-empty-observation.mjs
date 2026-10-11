/** Return only fixed, bounded fields from the selected native result pane. */
export const tabStateExpression = (expectedLabel) => `(() => {
  const outer = [...document.querySelectorAll('button[role="tab"][title="Scrape"][data-state="active"]')];
  const panel = outer.length === 1 ? document.getElementById(outer[0].getAttribute('aria-controls')) : null;
  const tabs = [...(panel?.querySelectorAll('[role="tablist"] [role="tab"]') ?? [])];
  const selected = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true');
  const tab = selected.length === 1 ? selected[0] : null;
  const content = tab ? document.getElementById(tab.getAttribute('aria-controls')) : null;
  const visible = Boolean(content?.getAttribute('data-state') === 'active' && content.getBoundingClientRect().height > 0);
  if (!visible || tab?.firstChild?.textContent?.trim() !== ${JSON.stringify(expectedLabel)})
    return { visible, selected: tab?.firstChild?.textContent?.trim() ?? null };
  if (${JSON.stringify(expectedLabel)} === 'SEO') {
    const groupNames = ['Title & description','Social preview','International','Structured data','Headings','Links','Images','Readability','Performance'];
    const groups = [...content.querySelectorAll('span')].map(node => node.textContent?.trim())
      .filter(value => groupNames.includes(value));
    const rowValue = label => {
      const row = [...content.querySelectorAll('span')].find(node => node.textContent?.trim() === label)
        ?.closest('div.flex.items-baseline.justify-between.gap-3');
      const spans = [...(row?.querySelectorAll('span') ?? [])];
      return spans.length ? spans.at(-1).textContent?.trim() ?? null : null;
    };
    return { visible, selected: 'SEO', groups, titleValue: rowValue('Title'), descriptionValue: rowValue('Description') };
  }
  const pre = content.querySelector('pre');
  let data = null;
  try { data = JSON.parse(pre?.textContent ?? ''); } catch {}
  const metadata = data?.metadata;
  return {
    visible, selected: 'Schema', jsonValid: Boolean(data && metadata && typeof metadata === 'object'),
    metadataTitle: typeof metadata?.title === 'string' ? metadata.title : null,
    descriptionAbsent: metadata?.description === null,
    canonicalAbsent: metadata?.canonical === null,
    ogCount: metadata?.og && typeof metadata.og === 'object' ? Object.keys(metadata.og).length : null,
    twitterCount: metadata?.twitter && typeof metadata.twitter === 'object' ? Object.keys(metadata.twitter).length : null,
    schemaTypesCount: Array.isArray(metadata?.schemaTypes) ? metadata.schemaTypes.length : null,
    ldJsonCount: Array.isArray(data?.ld_json) ? data.ld_json.length : null,
  };
})()`;

export const captureStateExpression = (title) => `(() => {
          const outer = [...document.querySelectorAll('button[role="tab"]')].filter(node =>
            (node.title || node.dataset.matrxTitle) === 'Scrape' && node.dataset.state === 'active');
          const controls = outer.length === 1 ? outer[0].getAttribute('aria-controls') : null;
          const pane = controls ? document.getElementById(controls) : null;
          const lists = [...(pane?.querySelectorAll('[role="tablist"]') ?? [])]
            .filter(node => node.closest('[role="tabpanel"]') === pane);
          const tabs = lists.length === 1 ? [...lists[0].querySelectorAll('[role="tab"]')]
            .filter(node => node.closest('[role="tablist"]') === lists[0]) : [];
          const selected = tabs.filter(node => node.getAttribute('aria-selected') === 'true');
          const result = selected.length === 1 ? selected[0] : null;
          const resultPane = result ? document.getElementById(result.getAttribute('aria-controls') ?? '') : null;
          const resultStyle = resultPane ? getComputedStyle(resultPane) : null;
          const captureButtons = [...document.querySelectorAll('button[title],button[data-matrx-title]')]
            .filter(node => (node.title || node.dataset.matrxTitle) === 'Capture the page exactly as it is right now');
          return {
            capture_match_count: captureButtons.length,
            capture_inside_scrape: captureButtons.length === 1 && Boolean(pane?.contains(captureButtons[0])),
            chat_active: [...document.querySelectorAll('button[role="tab"]')].some(node =>
              (node.title || node.dataset.matrxTitle) === 'Chat' && node.dataset.state === 'active'),
            active_scrape_count: outer.length, scrape_controls_present: Boolean(controls),
            scrape_pane_found: Boolean(pane), scrape_pane_active: pane?.dataset.state === 'active',
            result_tablist_count: lists.length, selected_count: selected.length, article: result?.firstChild?.textContent?.trim() === 'Article',
            selected_inside_scrape: Boolean(pane && result && pane.contains(result)),
            result_controls_present: Boolean(result?.getAttribute('aria-controls')),
            result_pane_found: Boolean(resultPane), result_pane_active: resultPane?.dataset.state === 'active',
            result_pane_inside_scrape: Boolean(pane && resultPane && pane.contains(resultPane)),
            result_pane_visible: Boolean(resultPane && resultPane.getBoundingClientRect().height > 0 &&
              resultStyle?.display !== 'none' && resultStyle?.visibility === 'visible' && Number(resultStyle?.opacity || 1) > 0),
            title_matches: pane?.querySelector('.truncate.text-sm.font-medium')?.textContent?.trim() === ${JSON.stringify(title)},
          };
        })()`;

export const isCaptureReady = (state, before, events) =>
  Boolean(
    before?.result_tablist_count === 0 &&
      before.selected_count === 0 &&
      events?.capture_click === 1 &&
      events.trusted_capture_click === 1 &&
      events.last_target_is_capture === true &&
      events.last_target_inside_scrape === true &&
      state?.active_scrape_count === 1 &&
      state.scrape_pane_active &&
      state.result_tablist_count === 1 &&
      state.selected_count === 1 &&
      state.article &&
      state.selected_inside_scrape &&
      state.result_pane_inside_scrape &&
      state.result_pane_active &&
      state.result_pane_visible &&
      state.title_matches,
  );
