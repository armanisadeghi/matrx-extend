/** Native observations for the package Chat surface, scoped to its active tab pane. */
export function readPackageChatControls(pane) {
  const visible = (element) => {
    if (!element || element.closest('[inert]')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    );
  };
  const active = pane?.getAttribute('data-state') === 'active' && visible(pane);
  const sends = active
    ? [...pane.querySelectorAll('button[aria-label="Send message"]')].filter(visible)
    : [];
  let toolCardCount = 0;
  let toolOnlyArticleCount = 0;
  let assistantArticleCount = 0;
  const answers = active
    ? [
        ...pane.querySelectorAll(
          '[role="article"][aria-label="Assistant answer"], [role="article"][aria-label="Assistant answer, pinned"]',
        ),
      ]
        .filter(visible)
        .map((article) => {
          assistantArticleCount += 1;
          const text = [...article.querySelectorAll('[data-message-content]')]
            .map((body) => {
              // The real package wraps live/persisted tool UI in group/toolcard INSIDE the answer body.
              const copy = body.cloneNode(true);
              const originalNodes = [...body.querySelectorAll('*')];
              const copiedNodes = [...copy.querySelectorAll('*')];
              originalNodes.forEach((node, index) => {
                const style = getComputedStyle(node);
                const tool = node.classList.contains('group/toolcard');
                if (tool) toolCardCount += 1;
                if (
                  tool ||
                  node.matches('[data-testid="tool-line"], [hidden], [aria-hidden="true"]') ||
                  style.display === 'none' ||
                  style.visibility === 'hidden'
                )
                  copiedNodes[index]?.remove();
              });
              return (copy.innerText ?? copy.textContent ?? '').trim();
            })
            .filter(Boolean)
            .join('\n');
          if (!text && article.querySelector('[class~="group/toolcard"]'))
            toolOnlyArticleCount += 1;
          return text;
        })
        .filter((text) => text.trim().length > 0)
    : [];
  return {
    sendEnabled:
      sends.length === 1 && !sends[0].disabled && sends[0].getAttribute('aria-disabled') !== 'true',
    sendControlCount: sends.length,
    sendControlDisabled:
      sends.length === 1
        ? sends[0].disabled || sends[0].getAttribute('aria-disabled') === 'true'
        : null,
    streaming:
      active && [...pane.querySelectorAll('button[aria-label="Stop the run"]')].some(visible),
    replies: answers,
    assistantDom: { assistantArticleCount, toolCardCount, toolOnlyArticleCount },
  };
}

/** Position the last assistant body and require readable proof above the composer. */
export function prepareMemberAnswerScreenshot(expectedTerms) {
  const tab = [...document.querySelectorAll('button[role="tab"]')].find(
    (candidate) => candidate.title === 'Chat' && candidate.getAttribute('aria-selected') === 'true',
  );
  const pane = tab && document.getElementById(tab.getAttribute('aria-controls') ?? '');
  if (pane?.getAttribute('data-state') !== 'active')
    return { eligible: false, reason: 'chat_inactive' };
  const articles = [
    ...pane.querySelectorAll(
      '[role="article"][aria-label="Assistant answer"], [role="article"][aria-label="Assistant answer, pinned"]',
    ),
  ].filter((article) => !article.closest('[inert]'));
  const body = articles.at(-1)?.querySelector('[data-message-content]');
  if (!body) return { eligible: false, reason: 'answer_missing' };
  body.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const composer = pane.querySelector('textarea');
  const composerTop = composer?.getBoundingClientRect().top ?? 0;
  let painted = false;
  for (let element = body; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      (style.opacity !== '' && Number(style.opacity) === 0)
    )
      break;
    if (element === pane) {
      painted = true;
      break;
    }
  }
  const usableBottom = Math.min(document.documentElement.clientHeight, composerTop);
  const termVisible = (term) => {
    const walker = document.createTreeWalker(body, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(term) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + term.length);
      const rects = [...range.getClientRects()];
      if (rects.length === 0) continue;
      if (
        rects.every((rect) => {
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.left < 0 ||
            rect.right > document.documentElement.clientWidth ||
            rect.top < 0 ||
            rect.bottom > usableBottom
          )
            return false;
          const hit = document.elementFromPoint(
            (rect.left + rect.right) / 2,
            (rect.top + rect.bottom) / 2,
          );
          return hit !== null && (body === hit || body.contains(hit));
        })
      )
        return true;
    }
    return false;
  };
  return {
    eligible: painted && expectedTerms.length > 0 && expectedTerms.every(termVisible),
    reason: 'answer_not_readable_above_composer',
  };
}
