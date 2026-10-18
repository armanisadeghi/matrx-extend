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
export function prepareMemberAnswerScreenshot(expectedTerms, phase = 'immediate') {
  const fingerprint = (value) => {
    if (!value) return null;
    let hash = 0xcbf29ce484222325n;
    for (const char of value) {
      hash ^= BigInt(char.codePointAt(0));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
  };
  const rectOf = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((key) => [key, Math.round(rect[key] ?? 0)]),
    );
  };
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
  const article = articles.at(-1);
  const body = article?.querySelector('[data-message-content]');
  if (!body) return { eligible: false, reason: 'answer_missing' };
  const scrollContainer = (() => {
    for (
      let element = body.parentElement;
      element && element !== pane;
      element = element.parentElement
    ) {
      const overflow = getComputedStyle(element).overflowY;
      if (
        (overflow === 'auto' || overflow === 'scroll') &&
        element.scrollHeight > element.clientHeight &&
        element.clientHeight > 0
      )
        return element;
    }
    return pane;
  })();
  if (phase === 'scroll_bottom') {
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'instant' });
  } else if (phase === 'immediate') {
    body.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  }
  const composer = pane.querySelector('textarea');
  const composerTop = composer?.getBoundingClientRect().top ?? 0;
  let painted = false;
  let rejectedAncestor = null;
  let ancestorDepth = 0;
  for (let element = body; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      (style.opacity !== '' && Number(style.opacity) === 0)
    ) {
      rejectedAncestor = {
        depth: ancestorDepth,
        tag: element.tagName,
        class_hash: fingerprint(typeof element.className === 'string' ? element.className : ''),
        opacity: Number(style.opacity),
        display: style.display,
        visibility: style.visibility,
      };
      break;
    }
    if (element === pane) {
      painted = true;
      break;
    }
    ancestorDepth += 1;
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
  const termVisibleFlags = expectedTerms.map(termVisible);
  const eligible = painted && expectedTerms.length > 0 && termVisibleFlags.every(Boolean);
  return {
    eligible,
    reason: eligible
      ? 'eligible'
      : !painted
        ? 'answer_unpainted'
        : expectedTerms.length === 0
          ? 'expected_terms_missing'
          : 'answer_not_readable_above_composer',
    painted,
    term_visible: termVisibleFlags,
    diagnostic: {
      article_id_hash: fingerprint(
        article.getAttribute('data-primary-message-id') ??
          article.getAttribute('data-message-ids') ??
          article.querySelector('[data-message-id]')?.getAttribute('data-message-id'),
      ),
      article_rect: rectOf(article),
      body_rect: rectOf(body),
      scroll: {
        top: Math.round(scrollContainer.scrollTop),
        client_height: Math.round(scrollContainer.clientHeight),
        scroll_height: Math.round(scrollContainer.scrollHeight),
      },
      composer_top: Math.round(composerTop),
      rejected_ancestor: rejectedAncestor,
    },
  };
}
