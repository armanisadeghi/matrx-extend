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
