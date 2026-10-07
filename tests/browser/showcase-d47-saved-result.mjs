/** Read the saved Patterns result from its visible DOM group, not panel-wide rendered text. */
export function readD47SavedResult(doc, recipe, expectedRun = 'first') {
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
  // The driver saves the selected response at key_path=[] (no JsonTree selection).
  // rowsFromBody yields the root object; ResultPreview stringifies its events array.
  const expectedEvent = expectedRun === 'second' ? 'Silver Meridian' : 'Canyon Frequency';
  const expectedDocument = expectedRun === 'second' ? 'second' : 'current';
  const exactResult =
    tables.length === 1 &&
    headings.length === 2 &&
    headings[0].textContent.trim() === 'events' &&
    headings[1].textContent.trim() === 'document' &&
    rows.length === 1 &&
    cells.length === 2 &&
    cells[0].textContent.trim() === `[{"eventName":"${expectedEvent}"}]` &&
    cells[1].textContent.trim() === expectedDocument;
  const oldCell = cells.some((cell) =>
    ['Moonlit Transit', ...(expectedRun === 'second' ? ['Canyon Frequency'] : [])].some((name) =>
      cell.textContent.includes(`"eventName":"${name}"`),
    ),
  );
  const currentCell = cells.some((cell) =>
    cell.textContent.includes(`"eventName":"${expectedEvent}"`),
  );
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

/** Observe the exact saved row's live Run control, which PatternsTab clears in finally. */
export function readD47SavedRunState(doc, recipe) {
  const visible = (element) =>
    Boolean(element?.getClientRects().length) &&
    doc.defaultView.getComputedStyle(element).visibility === 'visible';
  const tab = [...doc.querySelectorAll('[role="tablist"] [role="tab"]')].find(
    (element) => element.textContent.trim() === 'Patterns',
  );
  const pane = tab ? doc.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
  const active =
    tab?.getAttribute('data-state') === 'active' &&
    pane?.getAttribute('data-state') === 'active' &&
    visible(pane);
  const rows = active
    ? [...pane.querySelectorAll('div.group')].filter((row) =>
        [...row.querySelectorAll('span.truncate.text-sm.font-medium')].some(
          (name) => name.textContent.trim() === recipe && visible(name),
        ),
      )
    : [];
  const buttons =
    rows.length === 1
      ? [...rows[0].querySelectorAll('button')].filter(
          (button) =>
            (button.getAttribute('title') ?? button.getAttribute('data-matrx-title')) ===
              'Run pattern' && visible(button),
        )
      : [];
  const button = buttons.length === 1 ? buttons[0] : null;
  const spinner = Boolean(button?.querySelector('.animate-spin'));
  const error =
    active &&
    [...pane.querySelectorAll('.text-destructive')].some(
      (element) => visible(element) && Boolean(element.textContent.trim()),
    );
  return {
    running: spinner,
    error_present: Boolean(error),
    observation_unavailable: !button || (button.disabled && !spinner),
  };
}

/** The saved replay's own terminal error and exact row, without panel-wide text. */
export function readD47StaleRefusal(doc, recipe) {
  const saved = readD47SavedResult(doc, recipe);
  const run = readD47SavedRunState(doc, recipe);
  const tab = [...doc.querySelectorAll('[role="tablist"] [role="tab"]')].find(
    (element) => element.textContent.trim() === 'Patterns',
  );
  const pane = tab ? doc.getElementById(tab.getAttribute('aria-controls') ?? '') : null;
  const visible = (element) =>
    Boolean(element?.getClientRects().length) &&
    doc.defaultView.getComputedStyle(element).visibility === 'visible';
  const errors =
    pane && tab.getAttribute('data-state') === 'active'
      ? [...pane.querySelectorAll('.text-destructive')]
          .filter(visible)
          .map((element) => element.textContent.trim())
      : [];
  return {
    ...saved,
    ...run,
    refusal:
      errors.length === 1 &&
      /No successful request matching/.test(errors[0]) &&
      /Run again and interact with the page/.test(errors[0]),
    error_count: errors.length,
  };
}

export function isD47StaleRefusal(value) {
  return (
    value?.refusal === true &&
    value.error_count === 1 &&
    value.running === false &&
    value.observation_unavailable === false &&
    value.current_row === false &&
    value.old_row === false &&
    value.header_status === 'absent' &&
    value.preview_status === 'absent'
  );
}
