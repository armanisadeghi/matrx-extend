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
  const cells = previewVisible
    ? [...preview.querySelectorAll('tbody td')]
        .filter(visible)
        .map((cell) => cell.textContent.trim())
    : [];
  const currentCell = cells.includes('Canyon Frequency');
  const oldCell = cells.includes('Moonlit Transit');
  return {
    exact_recipe: exactRecipe,
    current_row: Boolean(exactRecipe && previewVisible && currentCell),
    old_row: Boolean(previewVisible && oldCell),
    header_status: !header ? 'absent' : exactRecipe ? 'exact' : 'mismatch',
    preview_status: !previewVisible
      ? 'absent'
      : currentCell && oldCell
        ? 'mixed'
        : currentCell
          ? 'current_only'
          : oldCell
            ? 'old_only'
            : 'other',
  };
}
