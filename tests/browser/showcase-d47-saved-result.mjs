/** Read the saved Patterns result from its visible DOM group, not panel-wide rendered text. */
export function readD47SavedResult(doc, recipe) {
  const visible = (element) => {
    if (!element || element.getClientRects().length === 0) return false;
    const style = doc.defaultView.getComputedStyle(element);
    return style.display !== 'none' && style.visibility === 'visible';
  };
  const header = [...doc.querySelectorAll('div')].find(
    (element) =>
      element.childElementCount === 0 &&
      element.textContent.trim().startsWith('Last run:') &&
      visible(element),
  );
  const exactRecipe = Boolean(header && header.textContent.trim() === `Last run: ${recipe}`);
  const preview = header?.nextElementSibling;
  const previewVisible = visible(preview);
  const tables = previewVisible ? [...preview.querySelectorAll('table')].filter(visible) : [];
  const table = tables.length === 1 ? tables[0] : null;
  const headings = table ? [...table.querySelectorAll('thead th')].filter(visible) : [];
  const rows = table ? [...table.querySelectorAll('tbody tr')].filter(visible) : [];
  const cells = rows.flatMap((row) => [...row.querySelectorAll('td')].filter(visible));
  // The saved fixture extracts events[*].eventName: exactly one current event.
  const exactResult =
    tables.length === 1 &&
    headings.length === 1 &&
    headings[0].textContent.trim() === 'eventName' &&
    rows.length === 1 &&
    cells.length === 1 &&
    cells[0].textContent.trim() === 'Canyon Frequency';
  const oldCell = cells.some((cell) => cell.textContent.trim() === 'Moonlit Transit');
  const currentCell = cells.some((cell) => cell.textContent.trim() === 'Canyon Frequency');
  return {
    exact_recipe: exactRecipe,
    current_row: Boolean(exactRecipe && previewVisible && exactResult),
    old_row: Boolean(previewVisible && oldCell),
    header_status: !header ? 'absent' : exactRecipe ? 'exact' : 'mismatch',
    preview_status: !previewVisible
      ? 'absent'
      : currentCell && oldCell
        ? 'mixed'
        : exactResult
          ? 'current_only'
          : oldCell
            ? 'old_only'
            : 'other',
  };
}
