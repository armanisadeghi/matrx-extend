/** Position and verify the actual answer before a native panel screenshot. */
export function prepareGuestAnswerScreenshot({ code, heading = null, focus = code }) {
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
  const style = getComputedStyle(article);
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const semanticTextNodes = (body) => {
    const walker = document.createTreeWalker(body, 4);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let semantic = true;
      for (
        let parent = node.parentElement;
        parent && parent !== body;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          parent.matches(
            '[class~="group/toolcard"], [data-testid="tool-line"], button, [role="button"], [hidden], [inert], [aria-hidden="true"]',
          ) ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          Number.parseFloat(style.opacity) === 0
        ) {
          semantic = false;
          break;
        }
      }
      if (semantic) nodes.push(node);
    }
    return nodes;
  };
  const bodies = [
    ...article.querySelectorAll(
      articles.length ? '[data-message-content]' : ':scope > div.min-w-0.text-foreground',
    ),
  ].filter(visible);
  // The same semantic walk feeds both the answer-text and focused Range checks.
  // A display:contents wrapper has no box, but its direct text can still paint.
  const text = bodies
    .map((body) =>
      semanticTextNodes(body)
        .map((node) => node.textContent ?? '')
        .join(''),
    )
    .join('\n');
  // A long answer can intersect the panel while its requested line is far
  // below the screenshot. Locate the painted text itself, then scroll its
  // existing container until that line is inside the native panel viewport.
  let focusedRange = null;
  let focusedElement = null;
  for (const body of bodies) {
    const nodes = semanticTextNodes(body);
    const joined = nodes.map((node) => node.textContent ?? '').join('');
    const index = joined.indexOf(focus);
    if (index < 0) continue;
    let offset = 0;
    let start = null;
    let end = null;
    for (const node of nodes) {
      const length = node.textContent?.length ?? 0;
      if (!start && index < offset + length) start = [node, index - offset];
      if (index + focus.length <= offset + length) {
        end = [node, index + focus.length - offset];
        break;
      }
      offset += length;
    }
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    focusedRange = range;
    focusedElement = start[0].parentElement;
    focusedElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    if (focusedRange) break;
  }
  const rangeRect = () => focusedRange?.getBoundingClientRect?.() ?? null;
  const scrollAncestors = [];
  if (focusedRange) {
    for (
      let ancestor = focusedElement, depth = 0;
      ancestor;
      ancestor = ancestor.parentElement, depth++
    ) {
      const css = getComputedStyle(ancestor);
      const clip = ancestor.getBoundingClientRect();
      if (/(auto|scroll)/.test(css.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) {
        const line = rangeRect();
        if (line && (line.top < clip.top || line.bottom > clip.bottom)) {
          ancestor.scrollTop += (line.top + line.bottom - clip.top - clip.bottom) / 2;
        }
        scrollAncestors.push({ depth, top: ancestor.scrollTop, height: ancestor.clientHeight });
      }
      if (/(auto|scroll)/.test(css.overflowX) && ancestor.scrollWidth > ancestor.clientWidth) {
        const line = rangeRect();
        if (line && (line.left < clip.left || line.right > clip.right)) {
          ancestor.scrollLeft += (line.left + line.right - clip.left - clip.right) / 2;
        }
      }
    }
  }
  const line = rangeRect();
  const clippingAncestor = (element) => {
    for (let node = element, depth = 0; node; node = node.parentElement, depth++) {
      const css = getComputedStyle(node);
      const clip = node.getBoundingClientRect();
      if (
        (/(auto|scroll|hidden|clip)/.test(css.overflowY) &&
          (line.top < clip.top || line.bottom > clip.bottom)) ||
        (/(auto|scroll|hidden|clip)/.test(css.overflowX) &&
          (line.left < clip.left || line.right > clip.right))
      )
        return {
          depth,
          overflowX: css.overflowX,
          overflowY: css.overflowY,
          rect: { left: clip.left, right: clip.right, top: clip.top, bottom: clip.bottom },
        };
    }
    return null;
  };
  const clippedBy = line ? clippingAncestor(focusedElement) : null;
  const lineVisible =
    line &&
    line.width > 0 &&
    line.height > 0 &&
    line.left >= 0 &&
    line.right <= viewportWidth &&
    line.top >= 0 &&
    line.bottom <= viewportHeight &&
    !clippedBy;
  const rect = article.getBoundingClientRect();
  const intersectWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  const intersectHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  const checks = {
    articleIntersectsViewport:
      rect.width > 0 &&
      rect.height > 0 &&
      intersectWidth > 0 &&
      intersectHeight > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden',
    codeInAnswerText: text.includes(code),
    headingInAnswerText: heading === null || text.includes(heading),
    focusedTextFound: Boolean(focusedRange),
    focusedTextInViewport: Boolean(
      line &&
        line.width > 0 &&
        line.height > 0 &&
        line.left >= 0 &&
        line.right <= viewportWidth &&
        line.top >= 0 &&
        line.bottom <= viewportHeight,
    ),
    focusedTextUnclipped: !clippedBy,
  };
  return {
    eligible: Object.values(checks).every(Boolean) && lineVisible,
    reason: 'answer_outside_viewport_or_fixture_missing',
    diagnostic: {
      checks,
      viewport: { width: viewportWidth, height: viewportHeight },
      article: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      line: line
        ? { left: line.left, right: line.right, top: line.top, bottom: line.bottom }
        : null,
      clippedBy,
      scrollAncestors,
    },
  };
}
