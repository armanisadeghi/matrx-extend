/** Position and verify the actual answer before a native panel screenshot. */
export function prepareGuestAnswerScreenshot({ code, heading = null }) {
  const pane = [...document.querySelectorAll('button[role="tab"]')]
    .filter((tab) => tab.title === 'Chat' && tab.getAttribute('aria-selected') === 'true')
    .map((tab) => document.getElementById(tab.getAttribute('aria-controls') ?? ''))
    .find((candidate) => candidate?.getAttribute('data-state') === 'active');
  const visible = (element) => {
    if (!element || element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number.parseFloat(style.opacity) === 0
      )
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  if (!pane || !visible(pane)) return { eligible: false, reason: 'missing_answer' };
  const streaming = [
    ...pane.querySelectorAll(
      'button[aria-label="Stop the run"], button[title="Stop"], button[data-matrx-title="Stop"]',
    ),
  ].some(
    (button) =>
      visible(button) &&
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      (button.getAttribute('aria-label') === 'Stop the run' ||
        (!button.hasAttribute('aria-label') && button.querySelector('svg.lucide-square'))),
  );
  if (streaming) return { eligible: false, reason: 'answer_not_terminal' };
  const articles = [
    ...pane.querySelectorAll(
      '[role="article"][aria-label="Assistant answer"], [role="article"][aria-label="Assistant answer, pinned"]',
    ),
  ].filter(visible);
  // This function is serialized alone into the native page. Keep the .205
  // completed MessageRow primitive aligned with readPackageChatControls.
  // Copy reply is a completion marker inside an opacity-0 hover toolbar.
  // Require the row and prose to be painted, not the marker itself.
  const rows = articles.length
    ? articles
    : [
        ...new Set(
          [
            ...pane.querySelectorAll(
              'button[title="Copy reply"], button[data-matrx-title="Copy reply"]',
            ),
          ]
            .filter((button) => !button.closest('[class~="group/toolcard"]'))
            .map((button) => button.closest('div.group.space-y-2'))
            .filter(
              (row) =>
                row &&
                !row.closest('[class~="group/toolcard"]') &&
                visible(row) &&
                [...row.querySelectorAll(':scope > div.min-w-0.text-foreground')].some(visible),
            ),
        ),
      ];
  const article = rows.at(-1);
  if (!article) return { eligible: false, reason: 'missing_answer' };
  article.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = article.getBoundingClientRect();
  const style = getComputedStyle(article);
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const intersectWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  const intersectHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  const text = [
    ...article.querySelectorAll(
      articles.length ? '[data-message-content]' : ':scope > div.min-w-0.text-foreground',
    ),
  ]
    .filter(visible)
    .map((body) => {
      const copy = body.cloneNode(true);
      const originals = [...body.querySelectorAll('*')];
      const copies = [...copy.querySelectorAll('*')];
      originals.forEach((node, index) => {
        if (!visible(node) || node.matches('[class~="group/toolcard"], [data-testid="tool-line"]'))
          copies[index]?.remove();
      });
      return copy.innerText ?? copy.textContent ?? '';
    })
    .join('\n');
  return {
    eligible:
      rect.width > 0 &&
      rect.height > 0 &&
      intersectWidth > 0 &&
      intersectHeight > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      text.includes(code) &&
      (heading === null || text.includes(heading)),
    reason: 'answer_outside_viewport_or_fixture_missing',
  };
}
