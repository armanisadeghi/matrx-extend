const EXPECTED_TABS = ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'];

export function scrapeLayoutFailure({ boundary, geometry }) {
  const { viewportWidth, document, resultTabs, triggers } = geometry ?? {};
  if (!Number.isFinite(viewportWidth) || !document || !resultTabs)
    return `${boundary}: scrape_layout_geometry_missing`;
  if (document.scrollWidth > document.clientWidth)
    return `${boundary}: scrape_document_overflow ${document.scrollWidth}/${document.clientWidth}`;
  if (document.scrollLeft !== 0 || document.left !== 0)
    return `${boundary}: scrape_document_shifted ${document.scrollLeft}/${document.left}`;
  if (resultTabs.left < 0 || resultTabs.right > viewportWidth)
    return `${boundary}: scrape_result_tabs_outside_viewport ${resultTabs.left}/${resultTabs.right}/${viewportWidth}`;
  if (!triggers) return `${boundary}: scrape_result_controls_missing`;
  if (
    triggers.length !== EXPECTED_TABS.length ||
    triggers.some((trigger, index) => trigger.label !== EXPECTED_TABS[index] || !trigger.rect)
  )
    return `${boundary}: scrape_result_controls_missing`;
  const inaccessible = triggers.find(
    ({ rect }) => rect.width <= 0 || rect.left < 0 || rect.right > viewportWidth,
  );
  if (inaccessible)
    return `${boundary}: scrape_result_control_outside_viewport ${inaccessible.label}`;
  return null;
}
